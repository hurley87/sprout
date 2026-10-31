import { afterEach, expect, it, vi } from "vitest";
import {
  CLASSIFIER_VERSION,
  CONVERSATION_CLASSIFICATION_THRESHOLDS,
  conversationStateQuestions,
  mapConversationObservation,
  normalizeConversationOutputs,
  type ObjectiveState,
} from "../lib/lesson-runtime/conversation-observer-contract";
import { classifyConversationStateWithDiagnostics } from "../lib/lesson-runtime/jev-conversation-state-classifier";
import { COUNTING_LESSON } from "../lib/lesson-runtime/counting-lesson";
import type { AnswerCommitment } from "../lib/lesson-runtime/counting-answer-policy";
import { JEV_MODEL } from "../lib/jev";
import { parseConversationStateProposal } from "../lib/lesson-runtime/conversation-state-classifier";
import { classificationSource, runtimeSource } from "../lib/lesson-runtime/lesson-runtime-reducer";
import { parseLiveClassificationDiagnostic } from "../lib/lesson-runtime/live-classification-diagnostic";
import { createReducerHarness, prepareLearnerClassification } from "./helpers/runtime-harness";

const input = { lesson: COUNTING_LESSON, nodeId: "count-1-duck", transcriptRevision: 1, transcript: "Child: One." };
const questions = conversationStateQuestions(COUNTING_LESSON, input.nodeId);
function distribution(options: Record<string, string>, choice: string, p = 0.97) {
  return {
    type: "choice",
    choice,
    confidence: p,
    probabilities: Object.fromEntries(
      Object.keys(options).map(label => [label, label === choice ? p : (1 - p) / (Object.keys(options).length - 1)]),
    ),
  };
}
function providerBody(objective: ObjectiveState = "completed", commitment: AnswerCommitment = "committed", p = 0.97) {
  return {
    model: JEV_MODEL,
    answers: {
      objectiveState: distribution(questions.objectiveState.criteria, objective),
      tutorState: distribution(questions.tutorState.criteria, "other"),
      answerCommitment: distribution(questions.answerCommitment.criteria, commitment, p),
    },
  };
}
function normalized(objective: ObjectiveState = "completed", commitment: AnswerCommitment = "committed", p = 0.97) {
  return normalizeConversationOutputs(providerBody(objective, commitment, p), COUNTING_LESSON, input.nodeId)!;
}
function diagnostic(decision: ReturnType<typeof mapConversationObservation>) {
  return {
    classifierVersion: CLASSIFIER_VERSION,
    decision: decision.status,
    outcome: decision.outcome,
    ...(decision.reason ? { reason: decision.reason } : {}),
    outputs: decision.outputs,
    labelCompletionEligible: decision.labelCompletionEligible,
    thresholds: CONVERSATION_CLASSIFICATION_THRESHOLDS,
    nodeId: input.nodeId,
    transcriptRevision: input.transcriptRevision,
    elapsedMs: 1,
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// These are supplied judgments, not measured model classifications or acoustic labels.
it.each([
  { text: "Two. No, I am choosing one.", objective: "completed", commitment: "committed", accept: true },
  {
    text: "Uh, two... actually one. That is my answer.",
    objective: "completed",
    commitment: "committed",
    accept: true,
  },
  {
    text: "I counted two at first, but there is only one.",
    objective: "completed",
    commitment: "committed",
    accept: true,
  },
  { text: "One. Why is that?", objective: "completed", commitment: "committed", accept: true },
  { text: "One... no, two. I choose two.", objective: "incorrect", commitment: "committed", accept: false },
  { text: "Two, or maybe one?", objective: "completed", commitment: "unresolved", accept: false },
  { text: "One or two. I have not decided.", objective: "completed", commitment: "unresolved", accept: false },
  { text: "Uh, two, uh, one", objective: "completed", commitment: "unresolved", accept: false },
  { text: "One. No, I withdraw that answer.", objective: "completed", commitment: "withdrawn", accept: false },
  { text: "I am not sure what I said.", objective: "unclear_or_incomplete", commitment: "unresolved", accept: false },
  { text: "One, perhaps? I am still deciding.", objective: "completed", commitment: "unresolved", accept: false },
  { text: "I have no answer.", objective: "no_attempt", commitment: "no_answer", accept: false },
] as const)("requires commitment and correctness for $text", async ({ text, objective, commitment, accept }) => {
  vi.stubEnv("TYPESAFE_API_KEY", "mock-provider-key");
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(providerBody(objective, commitment)));
  vi.stubGlobal("fetch", fetch);
  const decision = await classifyConversationStateWithDiagnostics(
    { ...input, transcript: `Child: ${text}` },
    new AbortController().signal,
  );
  expect(fetch).toHaveBeenCalledOnce();
  const wire = JSON.parse(fetch.mock.calls[0][1]?.body as string);
  expect(wire.model).toBe(JEV_MODEL);
  expect(Object.keys(wire.questions)).toEqual(["objectiveState", "tutorState", "answerCommitment"]);
  expect(decision.outputs?.answerCommitment?.choice).toBe(commitment);
  expect(decision.proposal?.answerCommitment).toBe(commitment);
  expect(decision.outcome).toBe(accept ? "allow_semantic_completion_evidence" : "hold_scene");
  expect(parseLiveClassificationDiagnostic(diagnostic(decision), COUNTING_LESSON)).not.toBeNull();
  const h = createReducerHarness("commitment", { lesson: COUNTING_LESSON, quietDrainMs: 100 });
  h.send({ type: "child.turn.started", source: runtimeSource(h.state) });
  h.send({
    type: "transcript.updated",
    source: runtimeSource(h.state),
    revision: 1,
    speaker: "child",
    transcriptSnapshot: `Child: ${text}`,
  });
  h.send({ type: "child.turn.ended", source: runtimeSource(h.state) });
  h.send({
    type: "proposal.received",
    source: classificationSource(h.state)!,
    proposal: decision.proposal,
    transcriptSnapshot: `Child: ${text}`,
  });
  expect(h.state.answerAccepted).toBe(accept);
  expect(h.state.acknowledgmentObserved).toBe(false);
  expect(h.state.phase).toBe("active");
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "active" });
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
  h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 100);
  expect(h.state.phase).toBe(accept ? "rendering" : "active");
});

it("waits for fresh tutor output after a wrong answer is corrected", () => {
  const h = createReducerHarness("wrong-corrected", { lesson: COUNTING_LESSON, quietDrainMs: 100 });
  const wrong = prepareLearnerClassification(h, 1);
  h.send({
    type: "proposal.received",
    source: wrong,
    proposal: mapConversationObservation(input, normalized("incorrect")).proposal!,
  });
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "active" });
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
  expect(h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 100).effects).not.toContainEqual(
    expect.objectContaining({ type: "render.requested" }),
  );
  expect(h.state.phase).toBe("active");
  const corrected = prepareLearnerClassification(h, 2);
  const proposal = mapConversationObservation({ ...input, transcriptRevision: 2 }, normalized()).proposal!;
  expect(h.send({ type: "proposal.received", source: corrected, proposal }).effects).not.toContainEqual(
    expect.objectContaining({ type: "render.requested" }),
  );
  expect(h.state.answerAccepted).toBe(true);
  expect(h.state.phase).toBe("active");
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "active" });
  expect(h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 100).effects).not.toContainEqual(
    expect.objectContaining({ type: "render.requested" }),
  );
  expect(h.state.phase).toBe("active");
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
  expect(h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 100).effects).toContainEqual(
    expect.objectContaining({ type: "render.requested" }),
  );
});

it.each([0.6, 0.89, 0.9, 0.97])("applies unchanged confidence bands to commitment: %s", p => {
  const decision = mapConversationObservation(input, normalized("completed", "committed", p));
  expect(decision.outcome).toBe(p >= 0.9 ? "allow_semantic_completion_evidence" : "unresolved");
  if (p < 0.9) {
    expect(decision).toMatchObject({ reason: "answerCommitment_no_winner", proposal: null });
    const forged = { ...diagnostic(decision), decision: "accepted", outcome: "hold_scene", reason: undefined };
    expect(parseLiveClassificationDiagnostic(forged, COUNTING_LESSON)).toBeNull();
  }
  expect(parseLiveClassificationDiagnostic(diagnostic(decision), COUNTING_LESSON)).not.toBeNull();
});

it.each(["missing", "invalid_label", "invalid_distribution"])(
  "fails closed on %s commitment without retry",
  async kind => {
    vi.stubEnv("TYPESAFE_API_KEY", "mock-provider-key");
    const body = providerBody();
    if (kind === "missing") Reflect.deleteProperty(body.answers, "answerCommitment");
    if (kind === "invalid_label") body.answers.answerCommitment.choice = "certain";
    if (kind === "invalid_distribution") body.answers.answerCommitment.probabilities.committed = 1.5;
    const fetch = vi.fn(async () => Response.json(body));
    vi.stubGlobal("fetch", fetch);
    expect(await classifyConversationStateWithDiagnostics(input, new AbortController().signal)).toMatchObject({
      reason: "provider_unreadable",
      proposal: null,
    });
    expect(fetch).toHaveBeenCalledOnce();
  },
);

it("requires explicit commitment at the reducer boundary, not just a correct outcome or diagnostic", () => {
  const h = createReducerHarness("missing-commitment", { lesson: COUNTING_LESSON });
  h.send({ type: "child.turn.started", source: runtimeSource(h.state) });
  h.send({ type: "transcript.updated", source: runtimeSource(h.state), revision: 1, speaker: "child" });
  h.send({ type: "child.turn.ended", source: runtimeSource(h.state) });
  const proposal = mapConversationObservation(input, normalized()).proposal!;
  const withoutCommitment = { ...proposal };
  Reflect.deleteProperty(withoutCommitment, "answerCommitment");
  expect(parseConversationStateProposal(withoutCommitment)).not.toBeNull(); // Legacy shape remains readable.
  const result = h.send({
    type: "proposal.received",
    source: classificationSource(h.state)!,
    proposal: withoutCommitment,
  });
  expect(result.proposalConsumption?.reason).toBe("uncommitted_answer_judgment");
  expect(h.state.answerAccepted).toBe(false);
  expect(parseConversationStateProposal({ ...proposal, answerCommitment: "certain" })).toBeNull();
});

it("bases commitment on learner endorsement, not the expected number or tutor agreement", () => {
  const question = questions.answerCommitment;
  expect(question.instructions).toContain("separately from correctness and tutor feedback");
  expect(question.instructions).toContain("Do not infer commitment from the expected quantity");
  expect(question.instructions).toContain("do not invent intonation or acoustic finality");
  expect(Object.keys(question.criteria)).toEqual(["committed", "unresolved", "withdrawn", "no_answer"]);
  expect(question.instructions).not.toMatch(/\b(?:one|two|three)\b/);
  expect(conversationStateQuestions(COUNTING_LESSON, "count-3-butterflies").answerCommitment).toEqual(question);
});

it("suspends an accepted answer on alternatives, rejects stale commitment, and recovers on a fresh settled correction", () => {
  const h = createReducerHarness("revised-commitment", { lesson: COUNTING_LESSON, quietDrainMs: 100 });
  function child(transcript: string, revision: number) {
    h.send({ type: "child.turn.started", source: runtimeSource(h.state) });
    h.send({
      type: "transcript.updated",
      source: runtimeSource(h.state),
      speaker: "child",
      revision,
      transcriptSnapshot: transcript,
    });
    h.send({ type: "child.turn.ended", source: runtimeSource(h.state) });
    return classificationSource(h.state)!;
  }
  function proposal(
    source: NonNullable<ReturnType<typeof classificationSource>>,
    transcript: string,
    commitment: AnswerCommitment,
  ) {
    return mapConversationObservation(
      { ...input, transcriptRevision: source.transcriptRevision, transcript },
      normalized("completed", commitment),
    ).proposal!;
  }
  const originalText = "Child: One.";
  const original = child(originalText, 1);
  const originalProposal = proposal(original, originalText, "committed");
  h.send({ type: "proposal.received", source: original, proposal: originalProposal, transcriptSnapshot: originalText });
  expect(h.state.answerAccepted).toBe(true);
  const alternatives = "Child: One.\nChild: Or two? I have not chosen.";
  const revised = child(alternatives, 2);
  expect(h.state.answerAccepted).toBe(false);
  const stale = h.send({
    type: "proposal.received",
    source: original,
    proposal: originalProposal,
    transcriptSnapshot: originalText,
  });
  expect(stale.proposalConsumption?.consumption).toBe("ignored");
  expect(h.state.answerAccepted).toBe(false);
  h.send({
    type: "proposal.received",
    source: revised,
    proposal: proposal(revised, alternatives, "unresolved"),
    transcriptSnapshot: alternatives,
  });
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "active" });
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
  h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 100);
  expect(h.state.phase).toBe("active");
  expect(h.state.answerAccepted).toBe(false);
  const settled = `${alternatives}\nChild: I have decided on one.`;
  const final = child(settled, 3);
  h.send({
    type: "proposal.received",
    source: final,
    proposal: proposal(final, settled, "committed"),
    transcriptSnapshot: settled,
  });
  expect(h.state.answerAccepted).toBe(true);
  expect(h.state.phase).toBe("active"); // Earlier-turn output cannot be reused.
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "active" });
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
  h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 100);
  expect(h.state.phase).toBe("rendering");
});
