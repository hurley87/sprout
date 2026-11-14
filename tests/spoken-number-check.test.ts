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
