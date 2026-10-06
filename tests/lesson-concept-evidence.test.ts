import { describe, expect, it } from "vitest";
import { mapConversationObservation, conversationStateQuestions, type ConversationStateOutputs } from "../lib/lesson-runtime/conversation-observer-contract";
import { createLessonRuntime, classificationSource, reduceLessonRuntime, runtimeSource } from "../lib/lesson-runtime/lesson-runtime-reducer";
import { validateLessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import { TEST_CONCEPT_LESSON, CONCEPT_TRANSCRIPT_FIXTURES } from "./fixtures/concept-lesson";

const distribution = <T extends string>(choice: T, options: readonly T[]) => ({
  choice,
  confidence: 0.99,
  probabilities: Object.fromEntries(options.map(option => [option, option === choice ? 0.99 : 0.01 / (options.length - 1)])) as Record<T, number>,
});
const baseOutputs = (concept: "not_yet" | "partial" | "demonstrated_independent" | "demonstrated_prompted"): ConversationStateOutputs => ({
  objectiveState: distribution("completed", ["completed", "incorrect", "unclear_or_incomplete", "unresolved_help", "no_attempt"]),
  tutorState: distribution("confirmed_completion", ["confirmed_completion", "clarifying", "helping", "asking", "other"]),
  concepts: { concept_repetition: distribution(concept, ["not_yet", "partial", "demonstrated_independent", "demonstrated_prompted"]) },
});

function reducerHarness(lesson = TEST_CONCEPT_LESSON) {
  let state = createLessonRuntime("concept-session-1", { lesson, quietDrainMs: 100 });
  const send = (event: Record<string, unknown>) => {
    const result = reduceLessonRuntime(state, { ...event, atMs: event.atMs ?? state.nowMs + 1 } as never, lesson);
    state = result.state;
    return result;
  };
  const childSnapshot = (transcript: string) => {
    send({ type: "child.turn.started", source: runtimeSource(state) });
    send({ type: "transcript.updated", source: runtimeSource(state), revision: state.transcriptRevision + 1, speaker: "child" });
    send({ type: "child.turn.ended", source: runtimeSource(state) });
    return { source: classificationSource(state)!, transcript };
  };
  const proposal = (snapshot: { source: ReturnType<typeof classificationSource> & {}; transcript: string }, fields: Record<string, unknown>) =>
    send({
      type: "proposal.received",
      source: snapshot.source,
      transcriptSnapshot: snapshot.transcript,
      proposal: {
        nodeId: snapshot.source.nodeId,
        transcriptRevision: snapshot.source.transcriptRevision,
        childActivity: "unknown",
        answerOutcome: "correct",
        supportState: "none",
        tutorState: "unknown",
        ...(lesson.nodes[state.nodeId].concepts ? { conceptObservations: [] } : {}),
        ...fields,
      },
    });
  return { get state() { return state; }, send, childSnapshot, proposal };
}

describe("authored concept observation interpretation", () => {
  it("asks only about the current node and separates paraphrase, incomplete, prompted, and independent labels", () => {
    const questions = conversationStateQuestions(TEST_CONCEPT_LESSON, "concept-a");
    expect(Object.keys(questions)).toContain("concept_repetition");
    expect(Object.keys(questions)).not.toContain("concept_change");
    for (const [transcript, concept] of [
      [CONCEPT_TRANSCRIPT_FIXTURES.paraphrase, "demonstrated_independent"],
      [CONCEPT_TRANSCRIPT_FIXTURES.incomplete, "partial"],
      [CONCEPT_TRANSCRIPT_FIXTURES.prompted, "demonstrated_prompted"],
    ] as const) {
      const decision = mapConversationObservation({
        lesson: TEST_CONCEPT_LESSON,
        nodeId: "concept-a",
        transcriptRevision: 4,
        transcript,
      }, baseOutputs(concept));
      expect(decision.proposal?.conceptObservations).toEqual([{ criterionId: "repetition", observation: concept }]);
    }
  });

  it("keeps evidence classifier-owned proposals separate from reducer authority", () => {
    const learnerResult = mapConversationObservation({
      lesson: TEST_CONCEPT_LESSON,
      nodeId: "concept-a",
      transcriptRevision: 2,
      transcript: CONCEPT_TRANSCRIPT_FIXTURES.paraphrase,
    }, baseOutputs("demonstrated_independent"));
    expect(learnerResult.proposal?.conceptObservations?.[0].observation).toBe("demonstrated_independent");
    const runtime = reducerHarness();
    const snapshot = runtime.childSnapshot(CONCEPT_TRANSCRIPT_FIXTURES.paraphrase);
    const reduced = runtime.proposal(snapshot, { answerOutcome: "unclear", conceptObservations: learnerResult.proposal?.conceptObservations });
    expect(reduced.state.conceptEvidence["concept-a:repetition"].status).toBe("demonstrated");
    expect(reduced.state.answerAccepted).toBe(false);
    expect(reduced.effects).toContainEqual({ type: "concept.revealed", nodeId: "concept-a", criterionId: "repetition" });
  });

  it("accepts confident criteria independently when another criterion or the scene summary is ambiguous", () => {
    const lesson = validateLessonDefinition({ ...TEST_CONCEPT_LESSON, initialNodeId: "concept-b" });
    const outputs = {
      ...baseOutputs("demonstrated_independent"),
      objectiveState: {
        choice: "completed" as const,
        confidence: 0.5,
        probabilities: { completed: 0.5, incorrect: 0.2, unclear_or_incomplete: 0.1, unresolved_help: 0.1, no_attempt: 0.1 },
      },
      concepts: {
        concept_repetition: distribution("demonstrated_independent", ["not_yet", "partial", "demonstrated_independent", "demonstrated_prompted"]),
        concept_change: {
          choice: "partial" as const,
          confidence: 0.5,
          probabilities: { not_yet: 0.2, partial: 0.5, demonstrated_independent: 0.2, demonstrated_prompted: 0.1 },
        },
      },
    };
    const decision = mapConversationObservation({
      lesson,
      nodeId: "concept-b",
      transcriptRevision: 3,
      transcript: CONCEPT_TRANSCRIPT_FIXTURES.multipleCriteria,
    }, outputs);
    expect(decision.status).toBe("accepted");
    expect(decision.proposal).toMatchObject({ answerOutcome: "unclear", conceptObservations: [{ criterionId: "repetition", observation: "demonstrated_independent" }] });
  });
});

describe("deterministic concept evidence and progression", () => {
  it("keeps partial evidence hidden, then reveals criteria independently", () => {
    const runtime = reducerHarness();
    let snapshot = runtime.childSnapshot(CONCEPT_TRANSCRIPT_FIXTURES.incomplete);
    let result = runtime.proposal(snapshot, { answerOutcome: "unclear", conceptObservations: [{ criterionId: "repetition", observation: "partial" }] });
    expect(result.state.conceptEvidence["concept-a:repetition"].status).toBe("partial");
    expect(result.effects).toEqual([]);
    expect(result.state.phase).toBe("active");

    snapshot = runtime.childSnapshot(CONCEPT_TRANSCRIPT_FIXTURES.selfCorrection);
    result = runtime.proposal(snapshot, { conceptObservations: [{ criterionId: "repetition", observation: "demonstrated_independent" }] });
    expect(result.effects).toContainEqual({ type: "concept.revealed", nodeId: "concept-a", criterionId: "repetition" });
    expect(result.state.conceptEvidence["concept-a:repetition"]).toMatchObject({ status: "demonstrated", understanding: "independent" });
    expect(result.state.phase).toBe("active"); // Reveal alone never bypasses completion media gates.
  });

  it("records prompted understanding and exact transcript source references", () => {
    const runtime = reducerHarness();
    const snapshot = runtime.childSnapshot(CONCEPT_TRANSCRIPT_FIXTURES.prompted);
    runtime.proposal(snapshot, { answerOutcome: "unclear", supportState: "needs_help", conceptObservations: [{ criterionId: "repetition", observation: "demonstrated_prompted" }] });
    expect(runtime.state.conceptEvidence["concept-a:repetition"]).toMatchObject({
      status: "demonstrated",
      understanding: "prompted",
      source: {
        runtimeId: "concept-session-1",
        nodeId: "concept-a",
        visitId: 1,
        childTurnId: snapshot.source.childTurnId,
        transcriptRevision: snapshot.source.transcriptRevision,
        childTranscript: "The circle keeps coming back.",
      },
      promptingHistory: [{
        source: {
          runtimeId: "concept-session-1",
          nodeId: "concept-a",
          visitId: 1,
          childTurnId: snapshot.source.childTurnId,
          transcriptRevision: snapshot.source.transcriptRevision,
          childMessageIndex: 3,
          childTranscript: "The circle keeps coming back.",
        },
        prompted: true,
      }],
    });
  });

  it("resolves multiple criteria independently from the same transcript snapshot", () => {
    const lesson = validateLessonDefinition({ ...TEST_CONCEPT_LESSON, initialNodeId: "concept-b" });
    const runtime = reducerHarness(lesson);
    const snapshot = runtime.childSnapshot(CONCEPT_TRANSCRIPT_FIXTURES.multipleCriteria);
    const result = runtime.proposal(snapshot, {
      conceptObservations: [
        { criterionId: "repetition", observation: "demonstrated_independent" },
        { criterionId: "change", observation: "partial" },
      ],
    });
    expect(result.state.conceptEvidence["concept-b:repetition"].status).toBe("demonstrated");
    expect(result.state.conceptEvidence["concept-b:change"].status).toBe("partial");
    expect(result.effects).toEqual([{ type: "concept.revealed", nodeId: "concept-b", criterionId: "repetition" }]);
  });

  it("rejects an independent label when the child simply echoes the tutor's supplied answer", () => {
    const runtime = reducerHarness();
    const snapshot = runtime.childSnapshot(CONCEPT_TRANSCRIPT_FIXTURES.tutorAnswerLeakage);
    runtime.proposal(snapshot, { conceptObservations: [{ criterionId: "repetition", observation: "demonstrated_independent" }] });
    expect(runtime.state.conceptEvidence["concept-a:repetition"]).toMatchObject({ status: "partial", understanding: null });
  });

  it("does not mistake question vocabulary or repeated tokens for copied answer content", () => {
    for (const transcript of [
      "Tutor: Which shape repeats, circle or triangle?\nChild: Circle repeats.",
      "Tutor: The circle repeats.\nChild: Circle circle repeats triangle.",
      "Tutor: Circle is a common shape.\nTutor: What happens in the pattern?\nChild: Circle repeats.",
    ]) {
      const runtime = reducerHarness();
      const snapshot = runtime.childSnapshot(transcript);
      runtime.proposal(snapshot, { conceptObservations: [{ criterionId: "repetition", observation: "demonstrated_independent" }] });
      expect(runtime.state.conceptEvidence["concept-a:repetition"], transcript).toMatchObject({
        status: "demonstrated",
        understanding: "independent",
      });
    }
  });

  it("retains prompted understanding when the child repeats tutor-supplied content", () => {
    const runtime = reducerHarness();
    const snapshot = runtime.childSnapshot("Tutor: The circle repeats each time.\nChild: The circle repeats each time.");
    runtime.proposal(snapshot, { conceptObservations: [{ criterionId: "repetition", observation: "demonstrated_prompted" }] });
    expect(runtime.state.conceptEvidence["concept-a:repetition"]).toMatchObject({ status: "demonstrated", understanding: "prompted" });
  });

  it("ignores stale revisions, un-authored criteria, and malformed duplicate observations", () => {
    const runtime = reducerHarness();
    const old = runtime.childSnapshot(CONCEPT_TRANSCRIPT_FIXTURES.paraphrase);
    runtime.send({ type: "transcript.updated", source: runtimeSource(runtime.state), revision: runtime.state.transcriptRevision + 1, speaker: "child" });
    const current = classificationSource(runtime.state)!;
    const stale = runtime.proposal(old, { conceptObservations: [{ criterionId: "repetition", observation: "demonstrated_independent" }] });
    expect(stale.state.conceptEvidence).toEqual({});
    runtime.proposal({ source: current, transcript: CONCEPT_TRANSCRIPT_FIXTURES.paraphrase }, {
      conceptObservations: [
        { criterionId: "other", observation: "demonstrated_independent" },
        { criterionId: "repetition", observation: "demonstrated_independent" },
      ],
    });
    expect(runtime.state.conceptEvidence).toEqual({});
    const accepted = runtime.state;
    runtime.send({ type: "proposal.received", source: current, transcriptSnapshot: CONCEPT_TRANSCRIPT_FIXTURES.paraphrase, proposal: {
      nodeId: current.nodeId,
      transcriptRevision: current.transcriptRevision,
      childActivity: "unknown",
      answerOutcome: "correct",
      supportState: "none",
      tutorState: "unknown",
      conceptObservations: [
        { criterionId: "repetition", observation: "demonstrated_independent" },
        { criterionId: "repetition", observation: "partial" },
      ],
    } });
    expect(runtime.state).toBe(accepted);
    runtime.send({ type: "proposal.received", source: current, proposal: null });
    expect(runtime.state).toBe(accepted);
  });

  it("carries only lesson-authorized demonstrated concepts and starts new sessions empty", () => {
    const runtime = reducerHarness();
    const snapshot = runtime.childSnapshot(CONCEPT_TRANSCRIPT_FIXTURES.paraphrase);
    runtime.proposal(snapshot, { conceptObservations: [{ criterionId: "repetition", observation: "demonstrated_independent" }] });
    runtime.send({ type: "transcript.updated", source: runtimeSource(runtime.state), revision: runtime.state.transcriptRevision + 1, speaker: "tutor" });
    const tutorSource = classificationSource(runtime.state)!;
    runtime.send({ type: "proposal.received", source: tutorSource, transcriptSnapshot: `${CONCEPT_TRANSCRIPT_FIXTURES.paraphrase}\nTutor: Yes, that is the repeating shape.`, proposal: {
      nodeId: tutorSource.nodeId, transcriptRevision: tutorSource.transcriptRevision, childActivity: "unknown", answerOutcome: "correct", supportState: "none", tutorState: "acknowledging",
      conceptObservations: [],
    } });
    runtime.send({ type: "output.activity", source: runtimeSource(runtime.state), state: "active" });
    runtime.send({ type: "output.activity", source: runtimeSource(runtime.state), state: "quiet" });
    runtime.send({ type: "clock.tick", source: runtimeSource(runtime.state), atMs: runtime.state.nowMs + 100 });
    expect(runtime.state.phase).toBe("rendering");
    expect(runtime.state.conceptEvidence["concept-b:repetition"]).toMatchObject({ status: "demonstrated", understanding: "independent" });
    runtime.send({ type: "render.confirmed", runtimeId: runtime.state.runtimeId, identity: runtime.state.pendingRender!.identity });
    const afterRender = runtime.state;
    runtime.send({ type: "proposal.received", source: snapshot.source, transcriptSnapshot: snapshot.transcript, proposal: {
      nodeId: snapshot.source.nodeId,
      transcriptRevision: snapshot.source.transcriptRevision,
      childActivity: "unknown",
      answerOutcome: "correct",
      supportState: "none",
      tutorState: "unknown",
      conceptObservations: [{ criterionId: "repetition", observation: "partial" }],
    } });
    expect(runtime.state).toBe(afterRender);
    const fresh = createLessonRuntime("concept-session-2", { lesson: TEST_CONCEPT_LESSON });
    expect(fresh.conceptEvidence).toEqual({});
  });

  it("allows an authored unresolved exit while preserving unresolved status", () => {
    const lesson = validateLessonDefinition({
      ...TEST_CONCEPT_LESSON,
      nodes: {
        ...TEST_CONCEPT_LESSON.nodes,
        "concept-a": { ...TEST_CONCEPT_LESSON.nodes["concept-a"], completionPolicy: "allow_unresolved" },
      },
    });
    const runtime = reducerHarness(lesson);
    const snapshot = runtime.childSnapshot(CONCEPT_TRANSCRIPT_FIXTURES.incomplete);
    runtime.proposal(snapshot, { conceptObservations: [{ criterionId: "repetition", observation: "partial" }] });
    runtime.send({ type: "transcript.updated", source: runtimeSource(runtime.state), revision: runtime.state.transcriptRevision + 1, speaker: "tutor" });
    const source = classificationSource(runtime.state)!;
    runtime.send({ type: "proposal.received", source, transcriptSnapshot: `${CONCEPT_TRANSCRIPT_FIXTURES.incomplete}\nTutor: I heard your explanation.`, proposal: {
      nodeId: source.nodeId, transcriptRevision: source.transcriptRevision, childActivity: "unknown", answerOutcome: "correct", supportState: "none", tutorState: "acknowledging",
      conceptObservations: [],
    } });
    runtime.send({ type: "output.activity", source: runtimeSource(runtime.state), state: "active" });
    runtime.send({ type: "output.activity", source: runtimeSource(runtime.state), state: "quiet" });
    runtime.send({ type: "clock.tick", source: runtimeSource(runtime.state), atMs: runtime.state.nowMs + 100 });
    expect(runtime.state.phase).toBe("rendering");
    expect(runtime.state.conceptEvidence["concept-a:repetition"].status).toBe("partial");
  });

  it("does not let prompted evidence satisfy an authored independent-completion policy", () => {
    const lesson = validateLessonDefinition({
      ...TEST_CONCEPT_LESSON,
      nodes: {
        ...TEST_CONCEPT_LESSON.nodes,
        "concept-a": { ...TEST_CONCEPT_LESSON.nodes["concept-a"], completionPolicy: "all_independent" },
      },
    });
    const runtime = reducerHarness(lesson);
    const snapshot = runtime.childSnapshot(CONCEPT_TRANSCRIPT_FIXTURES.prompted);
    runtime.proposal(snapshot, { conceptObservations: [{ criterionId: "repetition", observation: "demonstrated_prompted" }] });
    runtime.send({ type: "transcript.updated", source: runtimeSource(runtime.state), revision: runtime.state.transcriptRevision + 1, speaker: "tutor" });
    const source = classificationSource(runtime.state)!;
    runtime.send({ type: "proposal.received", source, transcriptSnapshot: `${CONCEPT_TRANSCRIPT_FIXTURES.prompted}\nTutor: Yes, that describes the pattern.`, proposal: {
      nodeId: source.nodeId, transcriptRevision: source.transcriptRevision, childActivity: "unknown", answerOutcome: "correct", supportState: "none", tutorState: "acknowledging",
      conceptObservations: [],
    } });
    runtime.send({ type: "output.activity", source: runtimeSource(runtime.state), state: "active" });
    runtime.send({ type: "output.activity", source: runtimeSource(runtime.state), state: "quiet" });
    runtime.send({ type: "clock.tick", source: runtimeSource(runtime.state), atMs: runtime.state.nowMs + 100 });
    expect(runtime.state.phase).toBe("active");
    expect(runtime.state.conceptEvidence["concept-a:repetition"]).toMatchObject({ status: "demonstrated", understanding: "prompted" });
  });
});
