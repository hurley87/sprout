import { afterEach, describe, expect, it, vi } from "vitest";
import { DINO_CAR_CRUNCH_LESSON } from "../lib/lesson-runtime/dino-car-crunch-lesson";
import { ICE_CREAM_LESSON } from "../lib/lesson-runtime/ice-cream-lesson";
import { validateLessonDefinition, type LessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import {
  mapConversationObservation,
  CLASSIFIER_VERSION,
  CONVERSATION_CLASSIFICATION_THRESHOLDS,
  type ConversationStateDecision,
  type ConversationStateOutputs,
} from "../lib/lesson-runtime/conversation-observer-contract";
import { applySpokenColourCheck } from "../lib/lesson-runtime/spoken-colour-check";
import { applySpokenNumberCheck } from "../lib/lesson-runtime/spoken-number-check";
import { classifyConversationStateWithDiagnostics } from "../lib/lesson-runtime/jev-conversation-state-classifier";
import { parseLiveClassificationDiagnostic } from "../lib/lesson-runtime/live-classification-diagnostic";
import { JEV_MODEL } from "../lib/jev";

const base = DINO_CAR_CRUNCH_LESSON;
const stocking = (id: string, presentation: LessonDefinition["nodes"][string]["presentation"], next?: string) => ({
  id,
  presentation: { sceneId: id, answerKind: "colour", ...presentation },
  learningObjective: "Find the stocking holding the number and name its colour.",
  tutorBrief: "Say only the number.",
  onSuccess: next ? { kind: "node" as const, nodeId: next } : { kind: "complete" as const },
});
const lesson: LessonDefinition = validateLessonDefinition({
  // Keeps the Dino lesson id: only allowlisted lesson ids accept learner answers independently.
  ...base,
  initialNodeId: "stocking-1",
  spokenNumberCheck: undefined,
  spokenColourCheck: { aliases: { yellow: "gold", golden: "gold" } },
  nodes: {
    "stocking-1": stocking(
      "stocking-1",
      { answer: "purple", colours: "pink,purple", target: 4, count_pink: 1, count_purple: 4 },
      "stocking-2",
    ),
    "stocking-2": stocking("stocking-2", {
      answer: "purple",
      colours: "gold,pink,purple",
      target: 3,
      count_pink: 4,
      count_purple: 3,
      count_gold: 1,
    }),
  },
});
const input = (transcript: string, nodeId = "stocking-2", target: LessonDefinition = lesson) => ({
  lesson: target,
  nodeId,
  transcriptRevision: 4,
  transcript,
});
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
function check(transcript: string, scores = outputs, nodeId = "stocking-2") {
  const snapshot = input(transcript, nodeId);
  return applySpokenColourCheck(mapConversationObservation(snapshot, scores), snapshot);
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("spoken colour check", () => {
  it.each(["Child: purple", "Child: the purple one!", "Tutor: Three!\nChild: Purple."])(
    "agrees with a learner-owned matching colour: %s",
    transcript => {
      expect(check(transcript)).toMatchObject({
        outcome: "allow_semantic_completion_evidence",
        proposal: { answerOutcome: "correct", answerCommitment: "committed" },
        spokenColour: { action: "agree", classifierOutcome: "correct", reader: { owner: "child", value: "purple" } },
      });
    },
  );

  it.each([
    ["a different on-screen colour", "Child: pink", "incorrect", "committed"],
    ["an aliased wrong colour", "Child: yellow", "incorrect", "committed"],
    ["an off-screen colour", "Child: blue", "incorrect", "committed"],
    ["a tutor echo", "Tutor: It's the purple one.\nChild: purple", "none", "no_answer"],
    ["the number back", "Tutor: Three!\nChild: three", "unclear", "unresolved"],
    ["pointing", "Child: that one", "unclear", "unresolved"],
    ["no colour at all", "Child: um", "unclear", "unresolved"],
    ["alternatives", "Child: pink or purple", "unclear", "unresolved"],
    ["a question", "Child: purple?", "unclear", "unresolved"],
    ["a self-correction away from the answer", "Child: purple… no, pink", "incorrect", "committed"],
  ] as const)("vetoes a correct proposal for %s", (_label, transcript, answerOutcome, answerCommitment) => {
    expect(check(transcript)).toMatchObject({
      outcome: "hold_scene",
      proposal: { answerOutcome, answerCommitment },
      spokenColour: { action: "veto", classifierOutcome: "correct" },
    });
  });

  it("rescues a matching child colour the classifier was unsure about, keeping the original scores", () => {
    const original = mapConversationObservation(input("Child: purple"), uncertain);
    expect(original.status).toBe("abstained");
    expect(check("Child: pink… no, purple", uncertain)).toMatchObject({
      status: "accepted",
      outcome: "allow_semantic_completion_evidence",
      outputs: uncertain,
      reason: undefined,
      proposal: { answerOutcome: "correct", answerCommitment: "committed" },
      spokenColour: { action: "rescue", classifierOutcome: null, reader: { value: "purple", owner: "child" } },
    });
  });

  it("may rescue when the classifier is confident only that the answer is unclear", () => {
    expect(check("Child: purple", confident("unclear_or_incomplete"))).toMatchObject({
      proposal: { answerOutcome: "correct", answerCommitment: "committed" },
      spokenColour: { action: "rescue" },
    });
  });

  it.each(["Child: three", "Child: that one", "Tutor: Purple!\nChild: purple", "Child: pink"])(
    "never rescues without a matching child-owned colour: %s",
    transcript => {
      const result = check(transcript, uncertain);
      expect(result.spokenColour?.action).toBe("none");
      expect(result.status).toBe("abstained");
    },
  );

  it("marks a second repeat of a disclosed answer as assisted, for both agree and rescue", () => {
    const transcript = "Tutor: The purple one has three.\nChild: purple\nTutor: Say it again?\nChild: purple";
    expect(check(transcript)).toMatchObject({
      outcome: "allow_semantic_completion_evidence",
      spokenColour: { action: "assisted", reader: { owner: "assisted" } },
    });
    expect(check(transcript, uncertain)).toMatchObject({
      outcome: "allow_semantic_completion_evidence",
      proposal: { answerOutcome: "correct" },
      spokenColour: { action: "assisted" },
    });
  });

  it.each(["incorrect", "no_attempt", "unresolved_help"] as const)(
    "never overrides a confident %s judgement",
    choice => {
      const result = check("Child: purple", confident(choice));
      expect(result.spokenColour).toMatchObject({ action: "none" });
      expect(result.proposal?.answerOutcome).not.toBe("correct");
    },
  );

  it("does not change lessons without the setting", () => {
    const snapshot = input("Child: pink", "stocking-2", { ...lesson, spokenColourCheck: undefined });
    const decision = mapConversationObservation(snapshot, outputs);
    expect(applySpokenColourCheck(decision, snapshot)).toBe(decision);
  });

  it("does not change non-colour nodes", () => {
    const countNode = {
      ...lesson.nodes["stocking-2"],
      presentation: { answerKind: "count", answer: 3, colours: "pink,purple" },
    };
    const snapshot = input("Child: pink", "stocking-2", {
      ...lesson,
      nodes: { ...lesson.nodes, "stocking-2": countNode },
    });
    const decision = mapConversationObservation(snapshot, outputs);
    expect(applySpokenColourCheck(decision, snapshot)).toBe(decision);
  });

  it("leaves Ice Cream on classifier-only judging", () => {
    expect(ICE_CREAM_LESSON.spokenColourCheck).toBeUndefined();
    const snapshot = {
      lesson: ICE_CREAM_LESSON,
      nodeId: "pink-scoop",
      transcriptRevision: 1,
      transcript: "Child: blue",
    };
    const decision = mapConversationObservation(snapshot, outputs);
    expect(applySpokenColourCheck(decision, snapshot)).toBe(decision);
  });

  it("is untouched by the number check and the other way round, so their order does not matter", () => {
    const snapshot = input("Child: pink");
    const decision = mapConversationObservation(snapshot, outputs);
    expect(applySpokenNumberCheck(decision, snapshot)).toBe(decision);
    expect(applySpokenColourCheck(applySpokenNumberCheck(decision, snapshot), snapshot)).toEqual(
      applySpokenNumberCheck(applySpokenColourCheck(decision, snapshot), snapshot),
    );
  });
});

describe("spoken colour diagnostic", () => {
  it.each([
    ["a near miss (one more)", "Child: pink", { picked: "pink", pickedCount: 4, target: 3, nearMiss: true }],
    ["a far miss", "Child: yellow", { picked: "gold", pickedCount: 1, target: 3, nearMiss: false }],
    ["the right pick", "Child: purple", { picked: "purple", pickedCount: 3, target: 3, nearMiss: false }],
  ])("records %s", (_label, transcript, fields) => {
    expect(check(transcript).spokenColour).toEqual({
      action: expect.any(String),
      reader: expect.objectContaining({ status: "colour" }),
      classifierOutcome: "correct",
      ...fields,
    });
  });

  it("records a one-fewer near miss", () => {
    expect(check("Child: purple", outputs, "stocking-1").spokenColour).toMatchObject({
      picked: "purple",
      nearMiss: false,
    });
    const twoAway = input("Child: pink", "stocking-1");
    const nearLesson = {
      ...lesson,
      nodes: {
        ...lesson.nodes,
        "stocking-1": {
          ...lesson.nodes["stocking-1"],
          presentation: { ...lesson.nodes["stocking-1"].presentation, count_pink: 3 },
        },
      },
    };
    const near = { ...twoAway, lesson: nearLesson };
    expect(applySpokenColourCheck(mapConversationObservation(near, outputs), near).spokenColour).toMatchObject({
      picked: "pink",
      pickedCount: 3,
      target: 4,
      nearMiss: true,
    });
  });

  it("omits counts and near miss when the facts are missing", () => {
    expect(check("Child: blue").spokenColour).toEqual({
      action: "veto",
      reader: { status: "colour", value: "blue", source: "blue", owner: "child" },
      classifierOutcome: "correct",
      picked: "blue",
      target: 3,
    });
    const bare = {
      ...lesson,
      nodes: {
        ...lesson.nodes,
        "stocking-2": {
          ...lesson.nodes["stocking-2"],
          presentation: { answerKind: "colour", answer: "purple", colours: "gold,pink,purple" },
        },
      },
    };
    const snapshot = input("Child: pink", "stocking-2", bare);
    expect(applySpokenColourCheck(mapConversationObservation(snapshot, outputs), snapshot).spokenColour).toEqual({
      action: "veto",
      reader: { status: "colour", value: "pink", source: "pink", owner: "child" },
      classifierOutcome: "correct",
      picked: "pink",
    });
  });

  it("has no pick fields when the reader found no colour", () => {
    expect(check("Child: three").spokenColour).toEqual({
      action: "veto",
      reader: { status: "number_only", source: "three" },
      classifierOutcome: "correct",
    });
  });

  it("appears in the classifier decision and the exported diagnostic, like the number diagnostic", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test");
    const answers = Object.fromEntries(
      Object.entries(uncertain).map(([key, value]) => [key, { type: "choice", ...value }]),
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ model: JEV_MODEL, answers })));
    const transcript = "Tutor: Three!\nChild: pink\nTutor: That one has four. We want three.\nChild: purple";
    const snapshot = input(transcript);
    const decision = await classifyConversationStateWithDiagnostics(snapshot, new AbortController().signal);
    expect(decision).toMatchObject({
      proposal: { answerOutcome: "correct", answerCommitment: "committed" },
      spokenColour: { action: "rescue", picked: "purple", pickedCount: 3, target: 3, nearMiss: false },
    });
    expect(decision).not.toHaveProperty("spokenNumber");
    const exported = (spokenColour: ConversationStateDecision["spokenColour"], target = lesson) =>
      parseLiveClassificationDiagnostic(
        {
          classifierVersion: CLASSIFIER_VERSION,
          decision: decision.status,
          outcome: decision.outcome,
          outputs: decision.outputs,
          labelCompletionEligible: decision.labelCompletionEligible,
          spokenColour,
          thresholds: CONVERSATION_CLASSIFICATION_THRESHOLDS,
          nodeId: snapshot.nodeId,
          transcriptRevision: snapshot.transcriptRevision,
          elapsedMs: 1,
        },
        target,
        snapshot.nodeId,
        transcript,
      );
    expect(exported(decision.spokenColour)).toMatchObject({ spokenColour: decision.spokenColour });
    // A diagnostic that does not replay, or comes from a lesson without the setting, is rejected.
    expect(exported({ ...decision.spokenColour!, nearMiss: true })).toBeNull();
    expect(exported(decision.spokenColour, { ...lesson, spokenColourCheck: undefined })).toBeNull();
  });
});

describe("spoken colour check setting", () => {
  const nodes = lesson.nodes;
  const withNode = (presentation: LessonDefinition["nodes"][string]["presentation"]) => ({
    ...lesson,
    nodes: { ...nodes, "stocking-2": { ...nodes["stocking-2"], presentation } },
  });
  const valid = { answerKind: "colour", answer: "purple", colours: "gold,pink,purple" };

  it.each([
    ["no aliases", { ...lesson, spokenColourCheck: {} }],
    ["an empty alias map", { ...lesson, spokenColourCheck: { aliases: {} } }],
    ["the gold aliases", lesson],
  ])("accepts %s", (_label, definition) => {
    expect(validateLessonDefinition(definition)).toBe(definition);
  });

  it.each([
    ["conversationFirst", { ...lesson, conversationFirst: true }],
    ["a non-object setting", { ...lesson, spokenColourCheck: true as never }],
    ["an unknown key", { ...lesson, spokenColourCheck: { alias: {} } as never }],
    ["a count node", withNode({ answerKind: "count", answer: 3, colours: "pink,purple" })],
    ["a missing answer", withNode({ ...valid, answer: "" })],
    ["a numeric answer", withNode({ ...valid, answer: 3 })],
    ["missing colours", withNode({ answerKind: "colour", answer: "purple" })],
    ["one colour", withNode({ ...valid, colours: "purple" })],
    ["repeated colours", withNode({ ...valid, colours: "purple,purple" })],
    ["uppercase colours", withNode({ ...valid, colours: "Gold,pink,purple" })],
    ["an answer not shown", withNode({ ...valid, colours: "gold,pink" })],
    ["an alias to an unknown colour", { ...lesson, spokenColourCheck: { aliases: { yellow: "orange" } } }],
    ["an alias shadowing a colour", { ...lesson, spokenColourCheck: { aliases: { pink: "purple" } } }],
    ["an uppercase alias", { ...lesson, spokenColourCheck: { aliases: { Yellow: "gold" } } }],
    ["a non-object alias map", { ...lesson, spokenColourCheck: { aliases: "yellow" as never } }],
  ])("rejects %s", (_label, definition) => {
    expect(() => validateLessonDefinition(definition)).toThrow(/Spoken-colour check/);
  });

  it("rejects both spoken checks together", () => {
    expect(() => validateLessonDefinition({ ...lesson, spokenNumberCheck: true })).toThrow();
  });
});
