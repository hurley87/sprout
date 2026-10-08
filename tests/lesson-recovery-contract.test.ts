import { expect, it } from "vitest";
import { COUNTING_LESSON } from "../lib/lesson-runtime/counting-lesson";
import { ANSWER_RECOVERY_INSTRUCTION } from "../lib/lesson-runtime/answer-recovery";
import { SUPPORT_CLARIFICATION_INSTRUCTION } from "../lib/lesson-runtime/support-clarification";
import { TEST_PATTERN_LESSON } from "./fixtures/test-lesson";

it("authors counting recovery prompts on the counting lesson and preserves legacy aliases", () => {
  expect(COUNTING_LESSON.recovery.supportClarificationInstruction).toBe(SUPPORT_CLARIFICATION_INSTRUCTION);
  expect(COUNTING_LESSON.recovery.answerRecoveryInstruction).toBe(ANSWER_RECOVERY_INSTRUCTION);
});

it("requires non-counting recovery prompts to describe the selected lesson", () => {
  const { supportClarificationInstruction, answerRecoveryInstruction } = TEST_PATTERN_LESSON.recovery;
  expect(supportClarificationInstruction).toContain("pattern activity");
  expect(supportClarificationInstruction).toContain("pattern rule");
  expect(answerRecoveryInstruction).toContain("pattern activity");
  expect(answerRecoveryInstruction).toContain("pattern rule");
  expect(supportClarificationInstruction).not.toContain("number and object");
  expect(answerRecoveryInstruction).not.toContain("number and object");
});
