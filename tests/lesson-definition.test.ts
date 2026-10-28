import { expect, it } from "vitest";
import { CALCULUS_LESSON } from "../lib/lesson-runtime/calculus-lesson";
import { conversationStateQuestions } from "../lib/lesson-runtime/conversation-observer-contract";
import { validateLessonDefinition, type LessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import { TEST_PATTERN_LESSON } from "./fixtures/test-lesson";

it("validates calculus lessons without placeholder classifier content", () => {
  expect(CALCULUS_LESSON).not.toHaveProperty("classifier");
  expect(validateLessonDefinition(CALCULUS_LESSON)).toBe(CALCULUS_LESSON);
  expect(() => conversationStateQuestions(CALCULUS_LESSON)).toThrow("mathematical action review path");
});

it("still validates calculus graph structure", () => {
  expect(() => validateLessonDefinition({ ...CALCULUS_LESSON, initialNodeId: "missing" })).toThrow(
    "authored initial node",
  );
});

it("still requires classifier criteria for non-calculus lessons", () => {
  expect(validateLessonDefinition(TEST_PATTERN_LESSON)).toBe(TEST_PATTERN_LESSON);
  const { classifier, ...withoutClassifier } = TEST_PATTERN_LESSON;
  expect(() => validateLessonDefinition(withoutClassifier as LessonDefinition)).toThrow();
  expect(() =>
    validateLessonDefinition({
      ...TEST_PATTERN_LESSON,
      classifier: {
        ...classifier,
        objectiveCriteria: {},
      },
    }),
  ).toThrow("classifier criteria must be authored");
});
