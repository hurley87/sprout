import { afterEach, describe, expect, it, vi } from "vitest";
import { CATCHING_UNICORNS_LESSON as lesson } from "../lib/lesson-runtime/catching-unicorns-lesson";
import {
  conversationStateQuestions,
  learnerSourceOptions,
  mapConversationObservation,
  normalizeConversationOutputs,
  type ConversationStateOutputs,
} from "../lib/lesson-runtime/conversation-observer-contract";
import { parseConversationStateProposal } from "../lib/lesson-runtime/conversation-state-classifier";
import {
  classificationSource,
  createLessonRuntime,
  meetsAuthoredCompletionPolicy,
  reduceLessonRuntime,
  runtimeSource,
  type LessonRuntimeEvent,
} from "../lib/lesson-runtime/lesson-runtime-reducer";
import { answerRecoveryInstruction } from "../lib/lesson-runtime/live-context";
import { transcriptMessages } from "../lib/lesson-runtime/tutor-observation";
import { parseLiveClassificationDiagnostic } from "../lib/lesson-runtime/live-classification-diagnostic";
import {
  CLASSIFIER_VERSION,
  CONVERSATION_CLASSIFICATION_THRESHOLDS,
} from "../lib/lesson-runtime/conversation-observer-contract";
import { classifyConversationStateWithDiagnostics } from "../lib/lesson-runtime/jev-conversation-state-classifier";
import { JEV_MODEL } from "../lib/jev";
import { TEST_CONCEPT_LESSON } from "./fixtures/concept-lesson";
import { sourceOutputs } from "./fixtures/concept-source-outputs";
import replay from "./fixtures/catching-unicorns-provenance-replay.json";

function harness(nodeId: string, definition = { ...lesson, initialNodeId: nodeId }) {
  let state = createLessonRuntime("provenance-replay", { lesson: definition, quietDrainMs: 50 });
  const send = (event: Record<string, unknown>) => {
    const result = reduceLessonRuntime(state, { ...event, atMs: state.nowMs + 1 } as LessonRuntimeEvent, definition);
    state = result.state;
    return result;
  };
  const observe = (transcript: string, conceptObservations: readonly unknown[]) => {
    send({ type: "child.turn.started", source: runtimeSource(state) });
    send({
      type: "transcript.updated",
      source: runtimeSource(state),
      revision: state.transcriptRevision + 1,
      speaker: "child",
    });
    send({ type: "child.turn.ended", source: runtimeSource(state) });
    const source = classificationSource(state)!;
    return send({
      type: "proposal.received",
      source,
      transcriptSnapshot: transcript,
      proposal: {
        ...{ nodeId: state.nodeId, transcriptRevision: state.transcriptRevision },
        childActivity: "unknown",
        answerOutcome: "unclear",
        supportState: "none",
        tutorState: "unknown",
        conceptObservations,
      },
    });
  };
  return {
    get state() {
      return state;
    },
    observe,
    send,
    definition,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("supporting learner utterance provenance", () => {
  it("retains the external-memory explanation through assent and cumulative reclassification", () => {
    const h = harness("exogram");
    const first = replay.checkpoints[0];
    h.observe(first.transcript, [
      { criterionId: "exogram-non-biological", observation: "demonstrated_unattributed", childMessageIndex: 1 },
    ]);
    const initialSource = h.state.conceptEvidence["exogram:exogram-non-biological"].source;
    const later = replay.checkpoints[1];
    const outputs = {
      ...later.outputs,
      sources: sourceOutputs(later.transcript, { "engram-biological": null, "exogram-non-biological": 1 }),
    } as unknown as ConversationStateOutputs;
    const decision = mapConversationObservation({ ...later, lesson }, outputs);
    expect(decision.proposal?.conceptObservations).toContainEqual({
      criterionId: "exogram-non-biological",
      observation: "demonstrated_independent",
      childMessageIndex: 1,
    });
    h.observe(later.transcript, decision.proposal!.conceptObservations!);
    const accepted = h.state.conceptEvidence["exogram:exogram-non-biological"];
    expect(accepted).toMatchObject({ status: "demonstrated", understanding: "independent", source: initialSource });
    expect(accepted.source?.childTranscript).toContain("Lives outside of the mind");
    expect(accepted.promptingHistory).toHaveLength(1);
    expect(accepted.promptingHistory[0].prompted).toBe(false);
    h.observe(later.transcript + "\nTutor: Correct.\nChild: Yep.", decision.proposal!.conceptObservations!);
    expect(h.state.conceptEvidence["exogram:exogram-non-biological"]).toEqual(accepted);
  });

  it("attributes cultural agreement to shared understanding, before the quantities/music answer", () => {
    const checkpoint = replay.checkpoints[2];
    const messages = transcriptMessages(checkpoint.transcript)!;
    const index = messages.findIndex(
      message => message.speaker === "Child" && /understand|agree|shared/i.test(message.text),
    );
    expect(index).toBe(3);
    const h = harness("exographics");
    h.observe(checkpoint.transcript, [
      { criterionId: "cultural-agreement", observation: "demonstrated_unattributed", childMessageIndex: index },
      { criterionId: "abstract-concepts", observation: "demonstrated_independent", childMessageIndex: 5 },
    ]);
    const evidence = h.state.conceptEvidence["exographics:cultural-agreement"];
    expect(evidence.source?.childTranscript).toBe(messages[index].text.trim());
    expect(evidence.source?.childTranscript).not.toMatch(/quantities|pitch/);
    expect(evidence.source?.childTurnId).toBeNull();
    expect(evidence.promptingHistory[0].prompted).toBeNull();
  });

  it.each([
    "Yes",
    "Yep",
    "That's right",
    "[inhale] [exhale]",
    "Um. Well...",
    "I",
    "I can",
    "[clear throat\n] [lip smack]",
  ])("rejects assent/filler as new concept evidence: %s", text => {
    const h = harness("exogram");
    const result = h.observe(`Tutor: An exogram is external memory.\nChild: ${text}`, [
      { criterionId: "exogram-non-biological", observation: "demonstrated_independent", childMessageIndex: 1 },
    ]);
    expect(h.state.conceptEvidence).toEqual({});
    expect(result.effects).toEqual([]);
  });

  it("rejects tutor/out-of-range references and refuses to guess in ambiguous legacy snapshots", () => {
    for (const childMessageIndex of [0, 8, null, undefined]) {
      const h = harness("exogram");
      h.observe("Tutor: Explain.\nChild: It is outside the brain.\nTutor: Anything else?\nChild: Music uses pitch.", [
        {
          criterionId: "exogram-non-biological",
          observation: "demonstrated_independent",
          ...(childMessageIndex === undefined ? {} : { childMessageIndex }),
        },
      ]);
      expect(h.state.conceptEvidence).toEqual({});
    }
  });

  it("does not record no-attempt observations as independent prompting history", () => {
    const h = harness("exogram");
    h.observe("Tutor: Explain.\nChild: Yes.", [{ criterionId: "exogram-non-biological", observation: "not_yet" }]);
    expect(h.state.conceptEvidence["exogram:exogram-non-biological"]).toMatchObject({
      source: null,
      promptingHistory: [],
      status: "not_yet",
    });
  });

  it("measures echoing against tutor words before the selected source, preserving later confirmation", () => {
    const h = harness("exogram");
    const transcript =
      "Tutor: Explain.\nChild: Memory stored outside the brain.\nTutor: Memory stored outside the brain.\nChild: Yes.";
    h.observe(transcript, [
      { criterionId: "exogram-non-biological", observation: "demonstrated_independent", childMessageIndex: 1 },
    ]);
    expect(h.state.conceptEvidence["exogram:exogram-non-biological"].understanding).toBe("independent");
    const prompted = harness("exogram");
    prompted.observe("Tutor: Memory stored outside the brain.\nChild: Memory stored outside the brain.", [
      { criterionId: "exogram-non-biological", observation: "demonstrated_prompted", childMessageIndex: 1 },
    ]);
    expect(prompted.state.conceptEvidence["exogram:exogram-non-biological"].promptingHistory[0].prompted).toBe(true);
  });
});

describe("tentative progress remains a hold", () => {
  it("retains recorded literacy/education partial scores for private acknowledgment while all four criteria remain incomplete", () => {
    const checkpoint = replay.checkpoints[3];
    const h = harness(checkpoint.nodeId);
    const outputs = {
      ...checkpoint.outputs,
      sources: sourceOutputs(checkpoint.transcript, {
        "widespread-literacy": 5,
        "education-system": 5,
        "idea-discoverers": null,
        "social-coordination": null,
      }),
    } as unknown as ConversationStateOutputs;
    const decision = mapConversationObservation({ ...checkpoint, lesson }, outputs);
    expect(decision.outcome).toBe("hold_scene");
    const result = h.observe(checkpoint.transcript, decision.proposal!.conceptObservations!);
    for (const id of ["widespread-literacy", "education-system"])
      expect(h.state.conceptEvidence[`${checkpoint.nodeId}:${id}`]).toMatchObject({
        status: "partial",
        tentative: true,
        understanding: null,
        source: { childMessageIndex: 5 },
      });
    expect(result.effects).toEqual([]);
    expect(meetsAuthoredCompletionPolicy(h.state, h.definition)).toBe(false);
    expect(lesson.nodes[checkpoint.nodeId].concepts).toHaveLength(4);
    const instruction = answerRecoveryInstruction(h.definition, h.state);
    expect(instruction).toContain("Private learner progress (not demonstration)");
    expect(instruction).toContain("If you want to read, you have to be literate");
    expect(instruction).toContain("using tentative language");
    expect(instruction).toContain("completion is not authorized");
    expect(instruction).toContain("Keep targets private; never supply answers");
    const diagnostic = {
      classifierVersion: CLASSIFIER_VERSION,
      decision: decision.status,
      outcome: decision.outcome,
      outputs: decision.outputs,
      labelCompletionEligible: false,
      thresholds: CONVERSATION_CLASSIFICATION_THRESHOLDS,
      nodeId: checkpoint.nodeId,
      transcriptRevision: checkpoint.transcriptRevision,
      elapsedMs: 1,
    };
    expect(parseLiveClassificationDiagnostic(diagnostic, lesson, checkpoint.nodeId)).toEqual(diagnostic);
    // Even a fully confident generic completion/acknowledgment cannot satisfy
    // the authored four-criterion gate using tentative progress.
    h.send({
      type: "transcript.updated",
      source: runtimeSource(h.state),
      revision: h.state.transcriptRevision + 1,
      speaker: "tutor",
    });
    const source = classificationSource(h.state)!;
    h.send({
      type: "proposal.received",
      source,
      transcriptSnapshot: checkpoint.transcript + "\nTutor: Yes, complete.",
      proposal: {
        nodeId: checkpoint.nodeId,
        transcriptRevision: source.transcriptRevision,
        childActivity: "unknown",
        answerOutcome: "correct",
        supportState: "none",
        tutorState: "acknowledging",
        conceptObservations: [],
      },
    });
    h.send({ type: "output.activity", source: runtimeSource(h.state), state: "active" });
    h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
    h.send({ type: "clock.tick", source: runtimeSource(h.state), atMs: h.state.nowMs + 100 });
    expect(h.state).toMatchObject({
      nodeId: checkpoint.nodeId,
      phase: "active",
      transitionReady: false,
      lessonComplete: false,
    });
  });

  it("deduplicates tentative observations and cannot erase established mastery", () => {
    const h = harness("exogram");
    const transcript = "Tutor: Explain.\nChild: Memory lives outside the brain.";
    const partial = [{ criterionId: "exogram-non-biological", observation: "partial_uncertain", childMessageIndex: 1 }];
    h.observe(transcript, partial);
    h.observe(transcript + "\nTutor: Tell me more.", partial);
    expect(h.state.conceptEvidence["exogram:exogram-non-biological"].promptingHistory).toHaveLength(1);
    h.observe(transcript, [
      { criterionId: "exogram-non-biological", observation: "demonstrated_independent", childMessageIndex: 1 },
    ]);
    h.observe(transcript, partial);
    expect(h.state.conceptEvidence["exogram:exogram-non-biological"]).toMatchObject({
      status: "demonstrated",
      understanding: "independent",
    });
  });

  it("treats fragments of one utterance as one history entry, including appended filler", () => {
    const h = harness("exogram");
    const partial = [{ criterionId: "exogram-non-biological", observation: "partial_uncertain", childMessageIndex: 1 }];
    h.observe("Tutor: Explain.\nChild: Something outside...", partial);
    h.observe("Tutor: Explain.\nChild: Something outside the brain, written on paper.", [
      { criterionId: "exogram-non-biological", observation: "demonstrated_independent", childMessageIndex: 1 },
    ]);
    const record = h.state.conceptEvidence["exogram:exogram-non-biological"];
    expect(record.promptingHistory).toHaveLength(1);
    expect(record.source?.childTranscript).toContain("written on paper");
    h.observe("Tutor: Explain.\nChild: Something outside the brain, written on paper. Um. [sniff]", partial);
    expect(h.state.conceptEvidence["exogram:exogram-non-biological"]).toEqual(record);
  });
});

describe("source Choice contract", () => {
  it("requests criterion-specific locators in the same provider call and round-trips them", async () => {
    const transcript = "Tutor: What repeats?\nChild: The circle comes back.\nTutor: Correct.\nChild: Yes.";
    const input = { lesson: TEST_CONCEPT_LESSON, nodeId: "concept-a", transcriptRevision: 3, transcript };
    const questions = conversationStateQuestions(input.lesson, input.nodeId, transcript);
    expect(questions.source_repetition.criteria).toEqual(learnerSourceOptions(transcript));
    expect(Object.keys(questions.source_repetition.criteria)).toEqual(["none", "message_1"]);
    const choice = (selected: string, options: string[]) => ({
      choice: selected,
      confidence: 1,
      probabilities: Object.fromEntries(options.map(option => [option, option === selected ? 1 : 0])),
    });
    const outputs: ConversationStateOutputs = {
      objectiveState: choice(
        "completed",
        Object.keys(questions.objectiveState.criteria),
      ) as ConversationStateOutputs["objectiveState"],
      tutorState: choice(
        "confirmed_completion",
        Object.keys(questions.tutorState.criteria),
      ) as ConversationStateOutputs["tutorState"],
      concepts: {
        concept_repetition: choice(
          "demonstrated_independent",
          Object.keys(questions.concept_repetition.criteria),
        ) as NonNullable<ConversationStateOutputs["concepts"]>[string],
      },
      sources: sourceOutputs(transcript, { repetition: 1 }),
    };
    const answers = Object.fromEntries(
      [
        ...Object.entries({ objectiveState: outputs.objectiveState, tutorState: outputs.tutorState }),
        ...Object.entries(outputs.concepts!),
        ...Object.entries(outputs.sources!),
      ].map(([key, value]) => [key, { type: "choice", ...value }]),
    );
    const fetch = vi.fn(async () => Response.json({ model: JEV_MODEL, answers }));
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
    const decision = await classifyConversationStateWithDiagnostics(input, new AbortController().signal);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(decision.proposal?.conceptObservations).toEqual([
      { criterionId: "repetition", observation: "demonstrated_independent", childMessageIndex: 1 },
    ]);
    expect(parseConversationStateProposal(decision.proposal)).toEqual(decision.proposal);
    expect(
      normalizeConversationOutputs(
        { answers: { ...answers, source_repetition: { ...answers.source_repetition, choice: "message_0" } } },
        input.lesson,
        input.nodeId,
        transcript,
      ),
    ).toBeNull();
    const uncertain = {
      ...outputs,
      sources: {
        source_repetition: { choice: "message_1", confidence: 0.6, probabilities: { none: 0.4, message_1: 0.6 } },
      },
    };
    expect(
      mapConversationObservation(input, uncertain).proposal?.conceptObservations?.[0].childMessageIndex,
    ).toBeNull();
    const unresolved = harness("concept-a", TEST_CONCEPT_LESSON);
    unresolved.observe(transcript, mapConversationObservation(input, uncertain).proposal!.conceptObservations!);
    expect(unresolved.state.conceptEvidence).toEqual({});
    const tied = {
      ...outputs,
      concepts: {
        concept_repetition: {
          choice: "partial" as const,
          confidence: 0.25,
          probabilities: { not_yet: 0.25, partial: 0.25, demonstrated_independent: 0.25, demonstrated_prompted: 0.25 },
        },
      },
    };
    expect(mapConversationObservation(input, tied).proposal?.conceptObservations).toEqual([]);
  });

  it("rejects invalid locator payloads and external metadata", () => {
    const base = {
      nodeId: "exogram",
      transcriptRevision: 1,
      childActivity: "unknown",
      answerOutcome: "unclear",
      supportState: "none",
      tutorState: "unknown",
    };
    for (const extra of [
      { childMessageIndex: -1 },
      { childMessageIndex: 1.5 },
      { childMessageIndex: "1" },
      { source: "Tutor" },
    ])
      expect(
        parseConversationStateProposal({
          ...base,
          conceptObservations: [{ criterionId: "exogram-non-biological", observation: "partial", ...extra }],
        }),
      ).toBeNull();
  });
});
