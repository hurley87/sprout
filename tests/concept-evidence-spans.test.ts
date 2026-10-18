import { describe, expect, it } from "vitest";
import {
  conversationStateQuestions,
  learnerSourceOptions,
  mapConversationObservation,
  normalizeConversationOutputs,
  type ConversationStateOutputs,
} from "../lib/lesson-runtime/conversation-observer-contract";
import { parseConversationStateProposal, type ProposedConceptObservation } from "../lib/lesson-runtime/conversation-state-classifier";
import { CATCHING_UNICORNS_LESSON as lesson } from "../lib/lesson-runtime/catching-unicorns-lesson";
import { transcriptMessages } from "../lib/lesson-runtime/tutor-observation";
import oct16 from "./fixtures/catching-unicorns-concept-evidence-oct16.json";
import { createReducerHarness, prepareLearnerClassification } from "./helpers/runtime-harness";
import { classifierProposal } from "./helpers/runtime-classifier";

function harness(nodeId = "exographics") {
  const definition = { ...lesson, initialNodeId: nodeId };
  const h = createReducerHarness("span-replay", { lesson: definition });
  const { send } = h;
  return {
    get evidence() { return h.state.conceptEvidence; },
    observe(transcript: string, observations: readonly ProposedConceptObservation[]) {
      const source = prepareLearnerClassification(h, h.state.transcriptRevision + 1);
      return send({ type: "proposal.received", source, transcriptSnapshot: transcript, proposal: classifierProposal(source, {
        answerOutcome: "unclear", tutorState: "unknown", conceptObservations: observations,
      }) });
    },
  };
}

// Controlled semantic judgments test wire validation and persistence, not live
// model accuracy. The October 16 transcript itself is recorded, not reconstructed.
function outputs(transcript: string, source: string, observation = "demonstrated_independent", criterionId = "cultural-agreement") {
  const questions = conversationStateQuestions(lesson, "exographics", transcript);
  const answers = Object.fromEntries(Object.entries(questions).map(([id, question]) => {
    const bounds = /^span_(\d+)_(\d+)$/.exec(source);
    const selected = id === `source_${criterionId}` ? bounds ? `message_${bounds[1]}` : source
      : id === `sourceEnd_${criterionId}` ? bounds ? `message_${bounds[2]}` : source
      : id === `concept_${criterionId}` ? observation
      : id.startsWith("source") ? "none" : id.startsWith("concept_") ? "not_yet"
      : id === "objectiveState" ? "unclear_or_incomplete" : "other";
    return [id, { type: "choice", choice: selected, confidence: 1,
      probabilities: Object.fromEntries(Object.keys(question.criteria).map(option => [option, option === selected ? 1 : 0])),
    }];
  }));
  return normalizeConversationOutputs({ answers }, lesson, "exographics", transcript)!;
}
function mapped(transcript: string, source: string, observation?: string, criterionId?: string) {
  return mapConversationObservation({ lesson, nodeId: "exographics", transcriptRevision: 1, transcript },
    outputs(transcript, source, observation, criterionId)).proposal!.conceptObservations!;
}
const initial = "Tutor: How do symbols work?\nChild: We have a shared understanding of what the numbers";
const complete = " mean. They represent abstract concepts.";

describe("complete learner evidence provenance", () => {
  it.each([
    ["one message", "Tutor: How do symbols work?\nChild: We agree on what the written symbols mean."],
    ["consecutive learner fragments", initial + "\nChild:" + complete],
  ])("keeps %s as a single complete source", (_name, transcript) => {
    const h = harness();
    h.observe(transcript, mapped(transcript, "message_1"));
    const source = h.evidence["exographics:cultural-agreement"].source!;
    expect(source.childTranscript).toBe(transcriptMessages(transcript)![1].text.trim());
    expect(source.messages).toBeUndefined();
    expect(Object.keys(learnerSourceOptions(transcript))).toEqual(["none", "message_1"]);
  });

  it("records all learner fragments and a neutral acknowledgment without relabelling tutor words", () => {
    const transcript = initial + "\nTutor: Mm-hmm.\nChild:" + complete;
    const h = harness();
    const observations = mapped(transcript, "span_1_3");
    expect(observations).toContainEqual({ criterionId: "cultural-agreement", observation: "demonstrated_independent",
      childMessageIndex: 1, childMessageEndIndex: 3 });
    h.observe(transcript, observations);
    const record = h.evidence["exographics:cultural-agreement"];
    expect(record).toMatchObject({ status: "demonstrated", understanding: "independent", source: {
      childMessageIndex: 1, childMessageEndIndex: 3, childTurnId: null,
      messages: transcriptMessages(transcript)!.slice(1).map((message, offset) => ({ messageIndex: 1 + offset, ...message })),
    } });
    expect(record.source!.messages!.filter(m => m.speaker === "Child").map(m => m.text)).toEqual([
      "We have a shared understanding of what the numbers", complete.trim(),
    ]);
    expect(record.source!.childTranscript).not.toContain("Mm-hmm");
    expect(record.promptingHistory[0].prompted).toBe(false);
  });

  it("considers substantive tutor help between fragments and preserves prompted application", () => {
    const transcript = "Tutor: How do symbols work?\nChild: These numbers stand for things.\nTutor: People agree on the meanings. Explain how that helps.\nChild: If we share the meaning of 2, I can write 2 apples and you know how many to bring.";
    const h = harness();
    h.observe(transcript, mapped(transcript, "span_1_3", "demonstrated_prompted"));
    expect(h.evidence["exographics:cultural-agreement"]).toMatchObject({ status: "demonstrated", understanding: "prompted",
      promptingHistory: [{ source: expect.any(Object), prompted: true }],
    });
    const conflicted = harness();
    conflicted.observe(transcript, mapped(transcript, "span_1_3", "demonstrated_independent"));
    expect(conflicted.evidence["exographics:cultural-agreement"]).toMatchObject({ status: "partial", understanding: null });
    expect(conflicted.evidence["exographics:cultural-agreement"].promptingHistory[0].prompted).toBeNull();
  });

  it("does not manufacture a span for a partial introduction followed by an unrelated answer", () => {
    const transcript = initial + "\nTutor: What did you eat?\nChild: Eggs and toast.";
    const h = harness();
    // An incomplete explanation has partial evidence at its actual source. A
    // confident demonstration with unresolved location must not guess a range.
    h.observe(transcript, mapped(transcript, "message_1", "partial"));
    expect(h.evidence["exographics:cultural-agreement"]).toMatchObject({ status: "partial", source: { childMessageIndex: 1 } });
    h.observe(transcript, mapped(transcript, "none"));
    expect(h.evidence["exographics:cultural-agreement"].source!.messages).toBeUndefined();
    expect(h.evidence["exographics:cultural-agreement"].status).toBe("partial");
    expect(conversationStateQuestions(lesson, "exographics", transcript)["source_cultural-agreement"].instructions)
      .toContain("do not combine unrelated answers");
  });

  it("retains the accepted complete span through repeated classification and later assent", () => {
    const transcript = initial + "\nTutor: Mm-hmm.\nChild:" + complete;
    const h = harness();
    h.observe(transcript, mapped(transcript, "span_1_3"));
    const original = h.evidence["exographics:cultural-agreement"];
    const later = transcript + "\nTutor: Yes.\nChild: That's right.";
    h.observe(later, mapped(later, "span_1_3"));
    expect(h.evidence["exographics:cultural-agreement"]).toEqual(original);
    h.observe(later, mapped(later, "message_3"));
    expect(h.evidence["exographics:cultural-agreement"]).toEqual(original);
    h.observe(later, mapped(later, "message_1"));
    expect(h.evidence["exographics:cultural-agreement"]).toEqual(original);
    h.observe(later, [{ criterionId: "cultural-agreement", observation: "partial_uncertain", childMessageIndex: 1, childMessageEndIndex: 3 }]);
    expect(h.evidence["exographics:cultural-agreement"]).toEqual(original);
  });

  it("records October 16 cultural agreement across messages 5–7 and abstraction in message 7", () => {
    const transcript = oct16.checkpoints.at(-1)!.transcript;
    const h = harness();
    h.observe(transcript, [
      ...mapped(transcript, "span_5_7").filter(o => o.criterionId === "cultural-agreement"),
      ...mapped(transcript, "message_7", "demonstrated_independent", "abstract-concepts").filter(o => o.criterionId === "abstract-concepts"),
    ]);
    const agreement = h.evidence["exographics:cultural-agreement"];
    expect(agreement).toMatchObject({ status: "demonstrated", understanding: "independent" });
    expect(agreement.source!.messages).toEqual(transcriptMessages(transcript)!.slice(5, 8)
      .map((message, offset) => ({ messageIndex: 5 + offset, ...message })));
    expect(agreement.source!.messages![2].text).toContain("mean. They represent abstract concepts");
    expect(h.evidence["exographics:abstract-concepts"]).toMatchObject({ status: "demonstrated", understanding: "independent",
      source: { childMessageIndex: 7, childTranscript: expect.stringContaining("They represent abstract concepts") },
    });
  });


  it("extends a partial anchor into one complete explanation without counting a new attempt", () => {
    const h = harness();
    h.observe(initial, mapped(initial, "message_1", "partial"));
    const transcript = initial + "\nTutor: Mm-hmm.\nChild:" + complete;
    h.observe(transcript, mapped(transcript, "span_1_3"));
    expect(h.evidence["exographics:cultural-agreement"]).toMatchObject({ status: "demonstrated",
      source: { childMessageEndIndex: 3 }, promptingHistory: [{ source: { childMessageEndIndex: 3 }, prompted: false }],
    });
  });

  it("allows one coherent span to support multiple independent criteria", () => {
    const transcript = initial + "\nTutor: Mm-hmm.\nChild:" + complete;
    const h = harness();
    h.observe(transcript, ["cultural-agreement", "abstract-concepts"].flatMap(id =>
      mapped(transcript, "span_1_3", "demonstrated_independent", id).filter(o => o.criterionId === id),
    ));
    expect(h.evidence["exographics:cultural-agreement"].source).toEqual(h.evidence["exographics:abstract-concepts"].source);
  });

  it("fails closed on uncertain span location and rejects malformed or tutor endpoints", () => {
    const transcript = initial + "\nTutor: Mm-hmm.\nChild:" + complete;
    const out = outputs(transcript, "span_1_3");
    out.sources = { ...out.sources, "source_cultural-agreement": {
      choice: "message_1", confidence: 0.6, probabilities: Object.fromEntries(Object.keys(learnerSourceOptions(transcript))
        .map(key => [key, key === "message_1" ? 0.6 : key === "message_3" ? 0.4 : 0])),
    } };
    const observations = mapConversationObservation({ lesson, nodeId: "exographics", transcriptRevision: 1, transcript }, out).proposal!.conceptObservations!;
    const h = harness(); h.observe(transcript, observations);
    expect(h.evidence["exographics:cultural-agreement"]).toBeUndefined();
    const uncertainEnd = outputs(transcript, "span_1_3");
    uncertainEnd.sources = { ...uncertainEnd.sources, "sourceEnd_cultural-agreement": {
      choice: "message_3", confidence: 0.6, probabilities: Object.fromEntries(Object.keys(learnerSourceOptions(transcript))
        .map(key => [key, key === "message_3" ? 0.6 : key === "message_1" ? 0.4 : 0])),
    } };
    const uncertain = harness();
    uncertain.observe(transcript, mapConversationObservation({ lesson, nodeId: "exographics", transcriptRevision: 1, transcript }, uncertainEnd).proposal!.conceptObservations!);
    expect(uncertain.evidence["exographics:cultural-agreement"]).toBeUndefined();
    for (const end of [0, 1, 2, 99, 1.5, null]) {
      const invalid = harness();
      invalid.observe(transcript, [{ criterionId: "cultural-agreement", observation: "demonstrated_independent", childMessageIndex: 1,
        childMessageEndIndex: end as number }]);
      expect(invalid.evidence).toEqual({});
    }
    expect(parseConversationStateProposal({ nodeId: "exographics", transcriptRevision: 1, childActivity: "unknown", answerOutcome: "unclear",
      supportState: "none", tutorState: "unknown", conceptObservations: [{ criterionId: "cultural-agreement", observation: "partial", childMessageEndIndex: 3 }] })).toBeNull();
  });

  it("supports explanations longer than a pair without omitting intervening messages", () => {
    const fragments = ["People interpret", "the marks as symbols", "with meanings", "that they have agreed on", "so the written marks", "convey the same idea to everyone."];
    const transcript = "Tutor: Explain.\n" + fragments.map(fragment => `Child: ${fragment}`).join("\nTutor: Mm-hmm.\n");
    const h = harness();
    h.observe(transcript, mapped(transcript, "span_1_11"));
    const record = h.evidence["exographics:cultural-agreement"];
    expect(record.status).toBe("demonstrated");
    expect(record.source!.messages!.filter(message => message.speaker === "Child").map(message => message.text)).toEqual(fragments);
    expect(record.source!.messages).toHaveLength(11);
  });

  it("does not award a span made entirely of copied tutor answer content", () => {
    const transcript = "Tutor: People agree on the meanings. This makes a shared language.\nChild: People agree on the meanings.\nTutor: Mm-hmm.\nChild: This makes a shared language.";
    const h = harness();
    h.observe(transcript, mapped(transcript, "span_1_3", "demonstrated_prompted"));
    expect(h.evidence["exographics:cultural-agreement"]).toMatchObject({ status: "partial", understanding: null });
  });

  it("keeps historical single-message score exports replayable without relaxing live request validation", () => {
    const c = oct16.checkpoints.at(-1)!;
    expect(mapConversationObservation({ ...c, lesson }, c.replayOutputs as unknown as ConversationStateOutputs).status).toBe("accepted");
    const answers = Object.fromEntries(Object.entries({ objectiveState: c.replayOutputs.objectiveState, tutorState: c.replayOutputs.tutorState,
      ...c.replayOutputs.concepts, ...c.replayOutputs.sources }).map(([id, answer]) => [id, { type: "choice", ...answer }]));
    expect(normalizeConversationOutputs({ answers }, lesson, c.nodeId, c.transcript)).toBeNull();
  });
});
