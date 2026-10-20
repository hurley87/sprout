import { expect, it } from "vitest";
import fillerTrace from "./fixtures/butterfly-filler-confirmation.json";
import { parseLiveClassificationDiagnostic } from "../lib/lesson-runtime/live-classification-diagnostic";
import { DiagnosticJournal } from "../lib/lesson-runtime/diagnostic-journal";
import { COUNTING_LESSON } from "../lib/lesson-runtime/counting-lesson";
import { LEGACY_COUNTING_LESSON } from "./helpers/counting-runtime";
import { TEST_CONCEPT_LESSON, CONCEPT_TRANSCRIPT_FIXTURES } from "./fixtures/concept-lesson";
import type { LessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import type { ConversationStateProposal } from "../lib/lesson-runtime/conversation-state-classifier";
import {
  createLessonRuntime,
  reduceLessonRuntime,
  runtimeSource,
  classificationSource,
  type LessonRuntimeEvent,
  type ClassificationSource,
} from "../lib/lesson-runtime/lesson-runtime-reducer";
import {
  trackDelivery,
  trackingOrigin,
  currentEvidenceEligibility,
  trackClassification,
  trackReduction,
  type EvidenceTracking,
  type FeedbackTracking,
} from "../lib/lesson-runtime/evidence-tracking";

type WithoutTime<T> = T extends unknown ? Omit<T, "atMs"> : never;
function harness(lesson: LessonDefinition = LEGACY_COUNTING_LESSON) {
  let state = createLessonRuntime("tracking-test", { lesson, quietDrainMs: 100 });
  const journal = new DiagnosticJournal(state.runtimeId, () => state.nowMs, state.nodeId);
  const history = () => journal.observe(undefined, () => state).events;
  const evidence = () =>
    history()
      .filter(event => event.type === "tracking.evidence")
      .map(event => event.detail as EvidenceTracking);
  function send(input: WithoutTime<LessonRuntimeEvent>, atMs = state.nowMs + 1) {
    const before = state;
    const event = { ...input, atMs } as LessonRuntimeEvent;
    const result = reduceLessonRuntime(before, event, lesson);
    state = result.state;
    const source = {
      nodeId: before.nodeId,
      transcriptRevision: before.transcriptRevision,
      ...("source" in event ? event.source : runtimeSource(before)),
    };
    journal.trackReduction({ before, event, result, origin: trackingOrigin(source, lesson, 7), lesson });
    return result;
  }
  function transcript(speaker: "child" | "tutor", text: string) {
    send({
      type: "transcript.updated",
      source: runtimeSource(state),
      revision: state.transcriptRevision + 1,
      speaker,
      transcriptSnapshot: text,
    });
  }
  function child(text = "Child: One.") {
    send({ type: "child.turn.started", source: runtimeSource(state) });
    transcript("child", text);
    send({ type: "child.turn.ended", source: runtimeSource(state) });
  }
  function proposal(
    transcriptSnapshot = "Child: One.",
    fields: Partial<ConversationStateProposal> = {},
    source = classificationSource(state)!,
  ) {
    return send({
      type: "proposal.received",
      source,
      transcriptSnapshot,
      proposal: {
        nodeId: source.nodeId,
        transcriptRevision: source.transcriptRevision,
        answerOutcome: "correct",
        supportState: "none",
        childActivity: "unknown",
        tutorState: "unknown",
        ...fields,
      },
    });
  }
  return {
    get state() {
      return state;
    },
    journal,
    history,
    evidence,
    send,
    child,
    transcript,
    proposal,
  };
}

it("retains original acceptance and exact support through tutor suspension, revalidation and a new child correction", () => {
  const h = harness();
  h.child();
  h.proposal();
  const accepted = structuredClone(h.evidence()[0]);
  const originalSource = classificationSource(h.state)!;
  h.transcript("tutor", "Child: One.\nTutor: Yes, one duck.");
  expect(h.evidence()[1]).toMatchObject({
    change: "authority_suspended",
    reason: "tutor_revision_revalidation",
    origin: { source: originalSource, transportSourceId: 7 },
    prior: { offset: 0 },
  });
  expect(h.evidence()[0]).toEqual(accepted);
  expect(currentEvidenceEligibility(h.state, LEGACY_COUNTING_LESSON)).toMatchObject({
    semanticCompletionEvidence: false,
    transitionReady: false,
  });
  h.proposal("Child: One.\nTutor: Yes, one duck.", { tutorState: "acknowledging" });
  expect(h.evidence()[2]).toMatchObject({
    prior: { offset: 0 },
    accepted: { answerAccepted: true, acceptedAnswerRevision: originalSource.transcriptRevision },
  });
  h.child("Child: One.\nTutor: Yes, one duck.\nChild: No, three.");
  expect(h.evidence()[3]).toMatchObject({
    change: "superseded",
    reason: "child.turn.started",
    origin: { source: { childTurnId: originalSource.childTurnId } },
  });
  h.proposal("Child: One.\nTutor: Yes, one duck.\nChild: No, three.", { answerOutcome: "incorrect" });
  expect(h.evidence().at(-1)).toMatchObject({
    consumption: "consumed",
    accepted: { answerAccepted: false },
    prior: null,
  });
  expect(h.evidence()[0]).toEqual(accepted);
});

it("records acceptance before finish immediately clears destination flags", () => {
  const h = harness();
  h.child();
  const transcript = "Child: One.\nTutor: Yes, one duck.";
  h.transcript("tutor", transcript);
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "active" });
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
  h.send({ type: "clock.tick", source: runtimeSource(h.state) }, h.state.nowMs + 100);
  const source = classificationSource(h.state)!;
  const result = h.proposal(transcript, { tutorState: "acknowledging" });
  expect(result.effects).toContainEqual(expect.objectContaining({ type: "render.requested" }));
  expect(h.state).toMatchObject({ phase: "rendering", answerAccepted: false, consumedRevision: null });
  expect(h.evidence()[0]).toMatchObject({
    origin: { source, sceneId: "hello-duck" },
    support: { transcript },
    consumption: "consumed",
    accepted: { answerAccepted: true, acknowledgmentObserved: true, acceptedAnswerRevision: source.transcriptRevision },
  });
  expect(h.evidence()[1]).toMatchObject({
    change: "superseded",
    reason: "node_visit_changed",
    prior: { offset: 0 },
    origin: { source },
  });
  expect(h.state.pendingRender?.origin).toEqual(source);
});

it("keeps duplicate, late and source-mismatched proposals ignored and correlated to their own sources", () => {
  const h = harness();
  h.child();
  const source = classificationSource(h.state)!;
  h.proposal();
  const before = h.state;
  h.proposal();
  expect(h.state).toBe(before);
  expect(h.evidence().at(-1)).toMatchObject({
    consumption: "ignored",
    reason: "revision_already_consumed",
    accepted: null,
  });
  const feedback = trackClassification({
    journalRuntimeId: "tracking-test",
    origin: trackingOrigin(source, COUNTING_LESSON),
    transcript: "Child: One.",
    proposal: h.evidence()[0].proposal,
    mapping: null,
    lesson: COUNTING_LESSON,
    history: h.history(),
  }).at(-1) as FeedbackTracking;
  expect(feedback.evidence).toEqual({ runtimeId: source.runtimeId, offset: 1 });
  h.transcript("tutor", "Child: One.\nTutor: One!");
  h.proposal("Child: One.", {}, source);
  expect(h.evidence().at(-1)).toMatchObject({
    origin: { source },
    consumption: "ignored",
    reason: "classification_source_mismatch",
    accepted: null,
  });
  for (const fields of [{ runtimeId: "other" }, { visitId: 900 }, { childTurnId: 900 }]) {
    const mismatched: ClassificationSource = { ...source, ...fields };
    h.proposal("Child: One.", {}, mismatched);
    expect(h.evidence().at(-1)).toMatchObject({
      origin: { source: mismatched },
      consumption: "ignored",
      reason: "inactive_or_source_mismatch",
      accepted: null,
    });
  }
  expect(h.state.answerAccepted).toBe(false);
});

it.each(["demonstrated_independent", "demonstrated_prompted"] as const)(
  "preserves concept %s source, criteria and exact request snapshot",
  observation => {
    const h = harness(TEST_CONCEPT_LESSON);
    const text =
      observation === "demonstrated_independent"
        ? CONCEPT_TRANSCRIPT_FIXTURES.paraphrase
        : CONCEPT_TRANSCRIPT_FIXTURES.prompted;
    h.child(text);
    h.proposal(text, { conceptObservations: [{ criterionId: "repetition", observation }] });
    const record = h.state.conceptEvidence["concept-a:repetition"];
    expect(record.status).toBe("demonstrated");
    expect(record.understanding).toBe(observation === "demonstrated_independent" ? "independent" : "prompted");
    const accepted = h.evidence()[0];
    expect(accepted.accepted?.conceptEvidence["concept-a:repetition"]).toEqual(record);
    expect(accepted.support).toMatchObject({
      transcript: text,
      authored: { concepts: TEST_CONCEPT_LESSON.nodes["concept-a"].concepts, completionPolicy: "all_demonstrated" },
    });
    h.transcript("tutor", `${text}\nTutor: Tell me more.`);
    expect(h.evidence()[0]).toEqual(accepted);
    expect(h.state.conceptEvidence["concept-a:repetition"]).toEqual(record);
  },
);

it("reports unknown feedback categories, absent mapping, and not-dispatched abstention independently", () => {
  const h = harness();
  h.child();
  const source = classificationSource(h.state)!;
  const details = trackClassification({
    journalRuntimeId: "tracking-test",
    origin: trackingOrigin(source, COUNTING_LESSON),
    transcript: "Tutor: Try again.\nChild: One.\nTutor: Correct!",
    proposal: null,
    mapping: null,
    lesson: COUNTING_LESSON,
    history: h.history(),
  });
  expect(details[0]).toMatchObject({ kind: "evidence", consumption: "not_dispatched", accepted: null });
  expect(details[1]).toMatchObject({
    kind: "feedback",
    tutorMessageIndex: 2,
    semantic: null,
    mapping: null,
    evidence: null,
    correction: "unknown",
    contradiction: "unknown",
    prompting: "unknown",
    origin: { transportSourceId: null, providerEventId: null, providerInterval: null },
  });
  expect(
    trackClassification({
      journalRuntimeId: "tracking-test",
      origin: trackingOrigin(source, COUNTING_LESSON),
      transcript: "Child: One.",
      proposal: null,
      mapping: null,
      lesson: COUNTING_LESSON,
      history: [],
    }).at(-1),
  ).toMatchObject({ tutorMessageIndex: null });
});

it("uses complete cloned history beyond recent diagnostics and tolerates old events without tracking", () => {
  const h = harness();
  h.journal.append("old.export", { accepted: true }, { state: h.state, revision: 0 });
  h.child();
  h.proposal();
  for (let index = 0; index < 110; index++) h.journal.append("measurement", null, { state: h.state, revision: 0 });
  h.transcript("tutor", "Child: One.\nTutor: Yes.");
  expect(h.journal.recent().some(event => (event.detail as EvidenceTracking | null)?.accepted?.answerAccepted)).toBe(
    false,
  );
  expect(h.evidence().at(-1)?.prior?.offset).toBe(1);
  const observed = h.journal.observe(undefined, () => h.state);
  Reflect.set((observed.events[1].detail as EvidenceTracking).accepted!, "answerAccepted", false);
  expect(h.evidence()[0].accepted?.answerAccepted).toBe(true);
  expect(
    trackReduction({
      before: h.state,
      event: { type: "clock.tick", source: runtimeSource(h.state), atMs: h.state.nowMs },
      result: { state: h.state, effects: [] },
      origin: trackingOrigin(classificationSource(h.state)!, COUNTING_LESSON),
      lesson: COUNTING_LESSON,
      history: [],
    }),
  ).toEqual([]);
});

it("captures tracking payloads independently of later live state and lesson mutations", () => {
  const lesson = structuredClone(TEST_CONCEPT_LESSON);
  const h = harness(lesson);
  h.child(CONCEPT_TRANSCRIPT_FIXTURES.paraphrase);
  h.proposal(CONCEPT_TRANSCRIPT_FIXTURES.paraphrase, {
    conceptObservations: [{ criterionId: "repetition", observation: "demonstrated_independent" }],
  });
  const before = h.evidence();
  expect(before[0].accepted?.conceptEvidence["concept-a:repetition"].status).toBe("demonstrated");
  Reflect.set(h.state.conceptEvidence["concept-a:repetition"], "status", "not_yet");
  Reflect.set(lesson.nodes["concept-a"].concepts![0], "description", "changed after capture");
  expect(h.evidence()).toEqual(before);
});

it("retains Jev labels, probabilities and mapping abstention without inventing a tutor verdict", () => {
  const h = harness();
  h.child();
  const source = classificationSource(h.state)!;
  const fixture = fillerTrace.steps.find(step => "mapping" in step)!.mapping!;
  const mapping = parseLiveClassificationDiagnostic(
    { ...fixture, nodeId: source.nodeId, transcriptRevision: source.transcriptRevision },
    LEGACY_COUNTING_LESSON,
    source.nodeId,
  );
  expect(mapping).not.toBeNull();
  h.journal.trackClassification(
    {
      origin: trackingOrigin(source, COUNTING_LESSON),
      transcript: "Child: One.",
      proposal: null,
      mapping,
      lesson: COUNTING_LESSON,
    },
    h.state,
  );
  const feedback = h.history().at(-1)!.detail as FeedbackTracking;
  expect(feedback.mapping).toEqual(mapping);
  expect(feedback.mapping?.outputs?.tutorState).toEqual(fixture.outputs.tutorState);
  expect(feedback.semantic).toBeNull();
  expect(h.state.answerAccepted).toBe(false);
});

it("retains independent concept provenance when a later prompted turn is consumed", () => {
  const h = harness(TEST_CONCEPT_LESSON);
  h.child(CONCEPT_TRANSCRIPT_FIXTURES.paraphrase);
  h.proposal(CONCEPT_TRANSCRIPT_FIXTURES.paraphrase, {
    conceptObservations: [{ criterionId: "repetition", observation: "demonstrated_independent" }],
  });
  const original = structuredClone(h.evidence()[0]);
  h.child(CONCEPT_TRANSCRIPT_FIXTURES.prompted);
  h.proposal(CONCEPT_TRANSCRIPT_FIXTURES.prompted, {
    conceptObservations: [{ criterionId: "repetition", observation: "demonstrated_prompted" }],
  });
  const result = h.evidence().at(-1)!;
  expect(result.accepted?.conceptEvidence["concept-a:repetition"]).toMatchObject({
    understanding: "independent",
    source: original.accepted!.conceptEvidence["concept-a:repetition"].source,
  });
  expect(result.accepted?.conceptEvidence["concept-a:repetition"].promptingHistory.at(-1)?.prompted).toBe(true);
  expect(h.evidence()[0]).toEqual(original);
});

it("correlates delivery only temporally within a known transport and original exchange", () => {
  const h = harness();
  h.child();
  const source = classificationSource(h.state)!;
  const origin = trackingOrigin(source, COUNTING_LESSON, 7);
  h.journal.trackClassification(
    {
      origin,
      transcript: "Child: One.\nTutor: Yes.",
      proposal: null,
      mapping: null,
      lesson: COUNTING_LESSON,
    },
    h.state,
  );
  const input = { origin, attachmentGeneration: 2, pcm: "quiet" as const, playbackFact: null, outputGate: null };
  expect(trackDelivery(input, h.history())).toMatchObject({
    feedback: { runtimeId: source.runtimeId, offset: 1 },
    correlation: "inferred_temporal",
    responseId: null,
    responseComplete: "unknown",
    speechHeard: "unknown",
  });
  for (const changed of [
    { ...origin, transportSourceId: null },
    { ...origin, transportSourceId: 8 },
    { ...origin, source: { ...source, childTurnId: source.childTurnId + 1 } },
    { ...origin, source: { ...source, visitId: source.visitId + 1 } },
    { ...origin, source: { ...source, transcriptRevision: source.transcriptRevision - 1 } },
  ]) {
    expect(trackDelivery({ ...input, origin: changed }, h.history())).toMatchObject({
      feedback: null,
      correlation: null,
      responseComplete: "unknown",
    });
  }
  expect(trackDelivery(input, [])).toMatchObject({ feedback: null, correlation: null });
});
