import { describe, expect, it } from "vitest";
import { CATCHING_UNICORNS_LESSON as lesson } from "../lib/lesson-runtime/catching-unicorns-lesson";
import { conversationStateQuestions, interpretConversationOutputs, learnerSourceOptions, mapConversationObservation, normalizeConversationOutputs, type ConversationStateOutputs } from "../lib/lesson-runtime/conversation-observer-contract";
import { classificationSource, createLessonRuntime, reduceLessonRuntime, runtimeSource, type LessonRuntimeEvent } from "../lib/lesson-runtime/lesson-runtime-reducer";
import { evidenceRecap } from "../lib/lesson-runtime/evidence-recap";
import recording from "./fixtures/catching-unicorns-source-boundaries-oct16.json";

function harness(nodeId: string) {
  const definition = { ...lesson, initialNodeId: nodeId };
  let state = createLessonRuntime("boundary-replay", { lesson: definition });
  const send = (event: Record<string, unknown>) => {
    state = reduceLessonRuntime(state, { ...event, atMs: state.nowMs + 1 } as LessonRuntimeEvent, definition).state;
  };
  return {
    get evidence() { return state.conceptEvidence; },
    observe(transcript: string, outputs: ConversationStateOutputs) {
      send({ type: "child.turn.started", source: runtimeSource(state) });
      send({ type: "transcript.updated", source: runtimeSource(state), speaker: "child", revision: state.transcriptRevision + 1 });
      send({ type: "child.turn.ended", source: runtimeSource(state) });
      const source = classificationSource(state)!;
      const decision = mapConversationObservation({ lesson, nodeId, transcript, transcriptRevision: source.transcriptRevision }, outputs);
      expect(decision.reason).not.toBe("invalid_outputs");
      if (!decision.proposal) return [];
      send({ type: "proposal.received", source, transcriptSnapshot: transcript, proposal: {
        ...decision.proposal, answerOutcome: "unclear", tutorState: "unknown",
      } });
      return decision.proposal!.conceptObservations!;
    },
  };
}

// Synthetic scores are controls only; recording checkpoints below are unmodified.
function controlled(transcript: string, observation = "demonstrated_independent", start = "message_1", end = start) {
  const questions = conversationStateQuestions(lesson, "engram", transcript);
  const answers = Object.fromEntries(Object.entries(questions).map(([id, q]) => {
    const choice = id === "concept_engram-biological" ? observation : id.startsWith("sourceEnd_") ? end
      : id.startsWith("source_") ? start : id === "objectiveState" ? "unclear_or_incomplete" : "other";
    return [id, { type: "choice", choice, confidence: 1,
      probabilities: Object.fromEntries(Object.keys(q.criteria).map(option => [option, option === choice ? 1 : 0])) }];
  }));
  return normalizeConversationOutputs({ answers }, lesson, "engram", transcript)!;
}
function uncertainEnd(outputs: ConversationStateOutputs, choice = "message_1"): ConversationStateOutputs {
  const start = outputs.sources!["source_engram-biological"];
  return { ...outputs, sources: { ...outputs.sources, "sourceEnd_engram-biological": {
    choice, confidence: 0.8,
    probabilities: Object.fromEntries(Object.keys(start.probabilities).map(key => [key, key === choice ? 0.8 : key === "none" ? 0.2 : 0])),
  } } };
}

const single = "Tutor: What is an engram?\nChild: An engram stores information inside your brain.\nTutor: Right.\nChild: Yep.";

describe("source boundaries with one provable learner source", () => {
  it.each([["engram", 22, "engram-biological", 0.96, 0.88], ["exogram", 34, "exogram-non-biological", 0.98, 0.85]] as const)(
    "persists exact recorded %s scores at revision %s", (nodeId, revision, id, demonstrated, end) => {
      const checkpoint = recording.checkpoints.find(c => c.nodeId === nodeId && c.transcriptRevision === revision)!;
      const outputs = checkpoint.outputs as unknown as ConversationStateOutputs;
      expect(outputs.concepts![`concept_${id}`].probabilities.demonstrated_independent).toBe(demonstrated);
      expect(outputs.sources![`source_${id}`].probabilities.message_1).toBe(0.99);
      expect(outputs.sources![`sourceEnd_${id}`].probabilities.message_1).toBe(end);
      // Without transcript proof, historical score-only interpretation stays strict.
      expect(interpretConversationOutputs(outputs, lesson, nodeId).conceptObservations)
        .toContainEqual({ criterionId: id, observation: "demonstrated_independent", childMessageIndex: null });
      const h = harness(nodeId);
      h.observe(checkpoint.transcript, outputs);
      expect(h.evidence[`${nodeId}:${id}`]).toMatchObject({ status: "demonstrated", understanding: "independent",
        source: { childMessageIndex: 1 }, promptingHistory: [{ prompted: false }] });
    },
  );

  it("omits the redundant live question, accepts old uncertain ends, and retains the single-message reference shape", () => {
    expect(conversationStateQuestions(lesson, "engram", single)["sourceEnd_engram-biological"]).toBeUndefined();
    const outputs = controlled(single);
    expect(outputs.sources!["sourceEnd_engram-biological"]).toBeUndefined();
    const h = harness("engram");
    h.observe(single, uncertainEnd(outputs));
    expect(h.evidence["engram:engram-biological"]).toMatchObject({ status: "demonstrated", understanding: "independent" });
    expect(h.evidence["engram:engram-biological"].source).not.toHaveProperty("childMessageEndIndex");
    expect(h.evidence["engram:engram-biological"].source).not.toHaveProperty("messages");
    const accepted = h.evidence["engram:engram-biological"];
    const later = single + "\nTutor: Anything else?\nChild: Maybe something else.";
    h.observe(later, uncertainEnd(controlled(later), "message_5"));
    h.observe(single, controlled(single, "partial"));
    expect(h.evidence["engram:engram-biological"]).toEqual(accepted);
  });

  it("still requires a confident non-none start and a demonstrated concept", () => {
    const out = uncertainEnd(controlled(single));
    out.sources = { ...out.sources, "source_engram-biological": { choice: "message_1", confidence: 0.8,
      probabilities: { none: 0.2, message_1: 0.8 } } };
    const h = harness("engram");
    h.observe(single, out);
    expect(h.evidence).toEqual({});
    h.observe(single, uncertainEnd(controlled(single, "demonstrated_independent", "none")));
    expect(h.evidence).toEqual({});
    h.observe(single, uncertainEnd(controlled(single, "partial")));
    expect(h.evidence["engram:engram-biological"].status).toBe("partial");
  });

  it("round-trips a sole short fragment without treating it as standalone mastery", () => {
    const transcript = "Tutor: Explain.\nChild: I can";
    const h = harness("engram");
    h.observe(transcript, controlled(transcript, "partial"));
    expect(h.evidence).toEqual({});
  });

  it("does not infer a single source from end scores or hide short learner continuations", () => {
    const transcript = "Tutor: Explain.\nChild: An engram is something that\nTutor: Mm-hmm.\nChild: I can";
    const out = uncertainEnd(controlled(transcript, "demonstrated_independent", "message_1", "message_3"));
    const h = harness("engram");
    h.observe(transcript, out);
    expect(h.evidence).toEqual({});
    const sources = { ...out.sources };
    delete sources["sourceEnd_engram-biological"];
    const answers = Object.fromEntries(Object.entries({ objectiveState: out.objectiveState, tutorState: out.tutorState,
      ...out.concepts, ...sources }).map(([id, answer]) => [id, { type: "choice", ...answer }]));
    expect(normalizeConversationOutputs({ answers }, lesson, "engram", transcript)).toBeNull();
  });

  it.each(["partial", "demonstrated_prompted", "demonstrated_independent"])("does not promote copied or partial evidence: %s", observation => {
    const transcript = "Tutor: An engram stores information inside your brain.\nChild: An engram stores information inside your brain.";
    const h = harness("engram");
    h.observe(transcript, uncertainEnd(controlled(transcript, observation)));
    expect(h.evidence["engram:engram-biological"]).toMatchObject({ status: "partial", understanding: null });
  });

  it("preserves prompted and unresolved attribution independently of the boundary", () => {
    const h = harness("engram");
    h.observe(single, uncertainEnd(controlled(single, "demonstrated_prompted")));
    expect(h.evidence["engram:engram-biological"]).toMatchObject({ status: "demonstrated", understanding: "prompted", promptingHistory: [{ prompted: true }] });
    const out = uncertainEnd(controlled(single));
    out.concepts = { "concept_engram-biological": { choice: "demonstrated_independent", confidence: 0.5,
      probabilities: { not_yet: 0, partial: 0.01, demonstrated_independent: 0.5, demonstrated_prompted: 0.49 } } };
    const unresolved = harness("engram");
    unresolved.observe(single, out);
    expect(unresolved.evidence["engram:engram-biological"].understanding).toBeNull();
    expect(evidenceRecap(lesson, { conceptEvidence: unresolved.evidence })).toContain("prompting unclear");
  });

  it("replays compatible recorded outputs, rejects obsolete acknowledgment options, and categorizes persisted evidence in the recap", () => {
    const evidence: ReturnType<typeof harness>["evidence"] = {};
    let obsoleteOptions = 0;
    for (const nodeId of ["engram", "exogram", "compare", "exographics"]) {
      const h = harness(nodeId);
      for (const c of recording.checkpoints.filter(c => c.nodeId === nodeId)) {
        const outputs = c.outputs as unknown as ConversationStateOutputs;
        if (c.transcript.endsWith("Child: Sounds\nChild: good")) {
          // Keep historical scores intact. Their distributions still offer the
          // now-excluded message_5; strict live validation must reject them.
          expect(Object.keys(learnerSourceOptions(c.transcript))).toEqual(["none", "message_1", "message_3"]);
          expect(Object.values(outputs.sources!).every(answer => "message_5" in answer.probabilities)).toBe(true);
          expect(mapConversationObservation({ lesson, nodeId, transcript: c.transcript, transcriptRevision: c.transcriptRevision }, outputs))
            .toMatchObject({ reason: "invalid_outputs", proposal: null });
          obsoleteOptions++;
        } else h.observe(c.transcript, outputs);
      }
      Object.assign(evidence, h.evidence);
    }
    expect(obsoleteOptions).toBe(2);
    expect(evidence["engram:engram-biological"].understanding).toBe("independent");
    expect(evidence["exogram:exogram-non-biological"].understanding).toBe("independent");
    // These recorded criteria have insufficient concept or start scores even
    // when only one source exists; later snapshots have multiple candidates.
    expect(evidence["exographics:beyond-prose"]?.status).not.toBe("demonstrated");
    expect(evidence["exographics:abstract-concepts"]?.status).not.toBe("demonstrated");
    const recap = evidenceRecap(lesson, { conceptEvidence: evidence });
    expect(recap).toContain("You independently explained engrams, exograms");
    expect(recap).not.toMatch(/unresolved or skipped: engrams/i);
  });
});
