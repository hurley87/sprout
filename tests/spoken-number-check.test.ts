import { afterEach, expect, it, vi } from "vitest";
import { DINO_CAR_CRUNCH_LESSON as lesson } from "../lib/lesson-runtime/dino-car-crunch-lesson";
import { validateLessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import {
  mapConversationObservation,
  CLASSIFIER_VERSION,
  CONVERSATION_CLASSIFICATION_THRESHOLDS,
  type ConversationStateOutputs,
} from "../lib/lesson-runtime/conversation-observer-contract";
import { applySpokenNumberCheck } from "../lib/lesson-runtime/spoken-number-check";
import { classifyConversationStateWithDiagnostics } from "../lib/lesson-runtime/jev-conversation-state-classifier";
import { parseLiveClassificationDiagnostic } from "../lib/lesson-runtime/live-classification-diagnostic";
import { JEV_MODEL } from "../lib/jev";
import { classificationSource, runtimeSource } from "../lib/lesson-runtime/lesson-runtime-reducer";
import { classifierProposal } from "./helpers/runtime-classifier";
import { WORDLESS_FRAGMENT_TRANSCRIPTS } from "./fixtures/wordless-child-fragments";
import { createReducerHarness, prepareLearnerClassification } from "./helpers/runtime-harness";

const real = `Tutor: Here comes Rex, hungry! Big car-carrier trucks are carrying ten cars each, and some loose ones rolled up too. How many cars does Rex get to eat altogether?
Child: Fifty-five
Tutor: Let's count from the trucks: fifty... fifty-one... fifty-two
Tutor: ...
Child: Fifty-three, fifty-four, fifty-five, fifty
Tutor: Yes,
Child: -six
Tutor: fifty-six cars. Rex is ready to chomp them.`;
const input = (transcript: string) => ({ lesson, nodeId: "fifty-six", transcriptRevision: 4, transcript });
const outputs: ConversationStateOutputs = {
  objectiveState: {
    choice: "completed",
    confidence: 1,
    probabilities: { completed: 1, incorrect: 0, unclear_or_incomplete: 0, unresolved_help: 0, no_attempt: 0 },
  },
  tutorState: {
    choice: "confirmed_completion",
    confidence: 0.73,
    probabilities: { confirmed_completion: 0.73, clarifying: 0.1, helping: 0.1, asking: 0.04, other: 0.03 },
  },
  answerCommitment: {
    choice: "committed",
    confidence: 1,
    probabilities: { committed: 1, unresolved: 0, withdrawn: 0, no_answer: 0 },
  },
};
const uncertain: ConversationStateOutputs = {
  ...outputs,
  objectiveState: {
    choice: "incorrect",
    confidence: 0.48,
    probabilities: {
      completed: 0.33,
      incorrect: 0.48,
      unclear_or_incomplete: 0.14,
      unresolved_help: 0.01,
      no_attempt: 0.04,
    },
  },
};
// Session a25c1317: GPT-Live said the total over the child's "fifty… six", and every later repeat was read as an
// echo until the parent stopped the lesson. These are the transcript and scores of the first stalled check.
const liveTalkedOver = `Tutor: Rex is hungry again! Big car-carrier trucks and some loose cars are here. How many cars does Rex get to eat in all?
Child: one, two, three, four, five
Tutor: Let's
Tutor: try starting
Child: , five, um, five, one, two, three, four, five
Tutor: Try starting
Child: , six
Tutor: from the trucks. Fifty, fifty-one, fifty-two, fifty-three, fifty-four, fifty-five...
Child: fifty
Tutor: Yes! Fifty-six
Child: -six
Tutor: cars. Rex can't wait to chomp them.`;
const liveTalkedOverScores: ConversationStateOutputs = {
  objectiveState: {
    choice: "completed",
    confidence: 0.25,
    probabilities: {
      completed: 0.4,
      incorrect: 0.22,
      unclear_or_incomplete: 0.23,
      unresolved_help: 0.01,
      no_attempt: 0.14,
    },
  },
  tutorState: {
    choice: "confirmed_completion",
    confidence: 0.5,
    probabilities: { confirmed_completion: 0.6, clarifying: 0.02, helping: 0.17, asking: 0.01, other: 0.2 },
  },
  answerCommitment: {
    choice: "committed",
    confidence: 0.27,
    probabilities: { committed: 0.45, unresolved: 0.33, withdrawn: 0, no_answer: 0.22 },
  },
};
function check(transcript: string, scores = outputs) {
  const snapshot = input(transcript);
  return applySpokenNumberCheck(mapConversationObservation(snapshot, scores), snapshot);
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("agrees with a learner-owned matching number", () => {
  expect(check("Child: fifty-six")).toMatchObject({
    proposal: { answerOutcome: "correct" },
    spokenNumber: { action: "agree" },
  });
});
it.each([
  ["Child: thirteen", "incorrect"],
  ["Tutor: fifty-six\nChild: fifty-six", "none"],
  ["Child: fifty-six or fifty-five", "unclear"],
  ["Child: thirteen-five", "unclear"],
  ["Child: hello", "unclear"],
])("vetoes %s", (transcript, outcome) => {
  expect(check(transcript)).toMatchObject({
    outcome: "hold_scene",
    proposal: { answerOutcome: outcome },
    spokenNumber: { action: "veto" },
  });
});
it("rescues the split answer and retains mapper fields and original scores", () => {
  const result = check(real, uncertain);
  expect(result).toMatchObject({
    status: "accepted",
    outcome: "allow_semantic_completion_evidence",
    outputs: uncertain,
    proposal: {
      answerOutcome: "correct",
      answerCommitment: "committed",
      childActivity: "unknown",
      supportState: "none",
      tutorState: "unknown",
    },
    spokenNumber: { action: "rescue", classifierOutcome: null },
  });
});
it("never rescues a confident incorrect proposal", () => {
  const scores = {
    ...outputs,
    objectiveState: {
      ...outputs.objectiveState,
      choice: "incorrect" as const,
      probabilities: { ...outputs.objectiveState.probabilities, completed: 0, incorrect: 1 },
    },
  };
  expect(check("Child: fifty-six", scores)).toMatchObject({
    proposal: { answerOutcome: "incorrect" },
    spokenNumber: { action: "none" },
  });
});
it.each(WORDLESS_FRAGMENT_TRANSCRIPTS)("agrees despite a trailing wordless child fragment: %#", transcript => {
  const snapshot = { lesson, nodeId: "warm-up", transcriptRevision: 92, transcript };
  expect(applySpokenNumberCheck(mapConversationObservation(snapshot, outputs), snapshot)).toMatchObject({
    proposal: { answerOutcome: "correct", answerCommitment: "committed" },
    spokenNumber: { action: "agree", reader: { status: "number", value: 7, owner: "child" } },
  });
});
it("does not change non-opted-in lessons", () => {
  const snapshot = { ...input("Child: thirteen"), lesson: { ...lesson, spokenNumberCheck: undefined } };
  const decision = mapConversationObservation(snapshot, outputs);
  expect(applySpokenNumberCheck(decision, snapshot)).toBe(decision);
});
it("rejects the flag on non-count nodes or conversation-first lessons", () => {
  expect(() =>
    validateLessonDefinition({
      ...lesson,
      nodes: {
        ...lesson.nodes,
        "fifty-six": { ...lesson.nodes["fifty-six"], presentation: { answerKind: "other", answer: 56 } },
      },
    }),
  ).toThrow();
  expect(() => validateLessonDefinition({ ...lesson, conversationFirst: true })).toThrow();
});
it("applies the check to the mocked Jev response and preserves diagnostic export", async () => {
  vi.stubEnv("TYPESAFE_API_KEY", "test");
  const answers = Object.fromEntries(
    Object.entries(uncertain).map(([key, value]) => [key, { type: "choice", ...value }]),
  );
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ model: JEV_MODEL, answers })));
  const snapshot = input(real);
  const decision = await classifyConversationStateWithDiagnostics(snapshot, new AbortController().signal);
  expect(decision).toMatchObject({
    proposal: { answerOutcome: "correct", answerCommitment: "committed" },
    spokenNumber: { action: "rescue" },
  });
  expect(
    parseLiveClassificationDiagnostic(
      {
        classifierVersion: CLASSIFIER_VERSION,
        decision: decision.status,
        outcome: decision.outcome,
        outputs: decision.outputs,
        labelCompletionEligible: decision.labelCompletionEligible,
        spokenNumber: decision.spokenNumber,
        thresholds: CONVERSATION_CLASSIFICATION_THRESHOLDS,
        nodeId: snapshot.nodeId,
        transcriptRevision: snapshot.transcriptRevision,
        elapsedMs: 1,
      },
      lesson,
      snapshot.nodeId,
      real,
    ),
  ).toMatchObject({ spokenNumber: { action: "rescue" } });
});

const confident = (choice: "incorrect" | "no_attempt" | "unresolved_help" | "unclear_or_incomplete") => ({
  ...outputs,
  objectiveState: {
    choice,
    confidence: 1,
    probabilities: {
      completed: 0,
      incorrect: 0,
      unclear_or_incomplete: 0,
      unresolved_help: 0,
      no_attempt: 0,
      [choice]: 1,
    },
  },
});

it.each([
  ["a wrong child number (teen for thirty-something)", "Child: thirteen", "incorrect", "committed"],
  ["a wrong child number", "Child: fifty-five", "incorrect", "committed"],
  ["a tutor echo", "Tutor: It's fifty-six.\nChild: fifty-six", "none", "no_answer"],
  ["an unresolved question", "Child: fifty-six?", "unclear", "unresolved"],
  ["alternatives", "Child: fifty-six or sixty-five", "unclear", "unresolved"],
  ["a malformed teen compound", "Child: thirteen-five", "unclear", "unresolved"],
  ["no number at all", "Child: lots of cars", "unclear", "unresolved"],
  ["an unnormalised pronunciation", "Child: fifdy-sick", "unclear", "unresolved"],
] as const)("vetoes a correct proposal for %s", (_label, transcript, answerOutcome, answerCommitment) => {
  expect(check(transcript)).toMatchObject({
    outcome: "hold_scene",
    proposal: { answerOutcome, answerCommitment },
    spokenNumber: { action: "veto", classifierOutcome: "correct" },
  });
});

it.each(["incorrect", "no_attempt", "unresolved_help"] as const)(
  "never rescues over a confident %s judgement",
  choice => {
    expect(check(real, confident(choice)).spokenNumber).toMatchObject({ action: "none" });
    expect(check(real, confident(choice)).proposal?.answerOutcome).not.toBe("correct");
  },
);

it("may rescue when the classifier is confident only that the answer is unclear", () => {
  expect(check(real, confident("unclear_or_incomplete"))).toMatchObject({
    proposal: { answerOutcome: "correct", answerCommitment: "committed" },
    spokenNumber: { action: "rescue" },
  });
});

it.each([
  ["live split number", "fifty-six", real, uncertain, "rescue", true, "thirty-five"],
  ["teen for thirty-five", "thirty-five", "Child: thirteen", outputs, "veto", false, null],
  ["paused number", "twenty-three", "Child: twenty... three", uncertain, "rescue", true, "forty-two"],
  [
    "counting on with bare ones",
    "twenty-three",
    "Child: Twenty, one, two, three",
    uncertain,
    "rescue",
    true,
    "forty-two",
  ],
  [
    "tutor talking over the split answer",
    "fifty-six",
    liveTalkedOver,
    liveTalkedOverScores,
    "rescue",
    true,
    "thirty-five",
  ],
  [
    "second repeat of a disclosed answer",
    "fifty-six",
    "Tutor: It's fifty-six.\nChild: fifty-six\nTutor: Can you say that again?\nChild: fifty-six",
    uncertain,
    "assisted",
    true,
    "thirty-five",
  ],
  [
    "first repeat of a disclosed answer",
    "fifty-six",
    "Tutor: It's fifty-six.\nChild: fifty-six",
    outputs,
    "veto",
    false,
    null,
  ],
  ["self-correction", "twenty-three", "Child: twenty-three... no, twenty-four", outputs, "veto", false, null],
  [
    "counting on",
    "twenty-three",
    "Child: twenty, twenty-one, twenty-two, twenty-three",
    outputs,
    "agree",
    true,
    "forty-two",
  ],
] as const)("replays %s through the check and reducer", (_name, nodeId, transcript, scores, action, accepted, next) => {
  const harness = createReducerHarness("dino-car-crunch", {
    lesson: { ...lesson, initialNodeId: nodeId },
    quietDrainMs: 1_000,
  });
  const source = prepareLearnerClassification(harness, 1);
  const snapshot = { lesson, nodeId, transcriptRevision: source.transcriptRevision, transcript };
  const original = mapConversationObservation(snapshot, scores);
  if (action === "rescue") expect(original.status).toBe("abstained");
  const checked = applySpokenNumberCheck(original, snapshot);
  expect(checked.spokenNumber?.action).toBe(action);
  expect(checked.proposal).not.toBeNull();
  harness.send({ type: "proposal.received", source, proposal: checked.proposal!, transcriptSnapshot: transcript });
  if (accepted) {
    harness.send({ type: "output.activity", source: runtimeSource(harness.state), state: "active" });
    harness.send({ type: "transcript.updated", source: runtimeSource(harness.state), speaker: "tutor", revision: 2 });
    const confirmationSource = classificationSource(harness.state)!;
    harness.send({
      type: "proposal.received",
      source: confirmationSource,
      proposal: classifierProposal(confirmationSource, {
        answerOutcome: checked.proposal!.answerOutcome,
        answerCommitment: checked.proposal!.answerCommitment,
        tutorState: "acknowledging",
      }),
      transcriptSnapshot: `${transcript}\nTutor: That's right.`,
    });
  }
  harness.send({ type: "output.activity", source: runtimeSource(harness.state), state: "quiet" });
  expect(harness.state.answerAccepted).toBe(accepted);
  harness.send({ type: "clock.tick", source: runtimeSource(harness.state) }, lesson.successHoldMs!);
  expect(harness.state.phase === "rendering").toBe(accepted);
  expect(harness.state.pendingRender?.identity.nodeId ?? null).toBe(next);
});

it("rescues counting on from the tens that the live classifier was unsure about", () => {
  // Session d981a120: after the count-on hint the child said "Twenty, one, two, three". The classifier leaned
  // correct (0.86) but below threshold, and the reader read 3, so the scene stalled until the parent stopped it.
  const transcript = `Tutor: Big car-carrier trucks rumbled in with some loose cars, and Rex is getting hungry! How many cars does Rex get to eat?
Child: One, two, three, four, five
Tutor: Take a peek at the big trucks. Each one holds ten cars. Say twenty, then keep counting for the loose cars.
Child: Twenty, one, two, three
Tutor: You got it, twenty-three cars! Rex can't wait to chomp them.`;
  const live: ConversationStateOutputs = {
    objectiveState: {
      choice: "completed",
      confidence: 0.82,
      probabilities: {
        completed: 0.86,
        incorrect: 0.08,
        unclear_or_incomplete: 0.03,
        unresolved_help: 0.01,
        no_attempt: 0.02,
      },
    },
    tutorState: {
      choice: "confirmed_completion",
      confidence: 0.74,
      probabilities: { confirmed_completion: 0.79, clarifying: 0.02, helping: 0.18, asking: 0, other: 0.01 },
    },
    answerCommitment: {
      choice: "committed",
      confidence: 0.35,
      probabilities: { committed: 0.51, unresolved: 0.24, withdrawn: 0.01, no_answer: 0.24 },
    },
  };
  const snapshot = { lesson, nodeId: "twenty-three", transcriptRevision: 90, transcript };
  const mapped = mapConversationObservation(snapshot, live);
  expect(mapped.proposal).toBeNull();
  expect(applySpokenNumberCheck(mapped, snapshot)).toMatchObject({
    outcome: "allow_semantic_completion_evidence",
    proposal: { answerOutcome: "correct", answerCommitment: "committed" },
    spokenNumber: { action: "rescue", reader: { value: 23, owner: "child" } },
  });
});
