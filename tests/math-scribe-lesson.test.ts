import { describe, expect, it } from "vitest";
import { MATH_SCRIBE_LESSON } from "../lib/lesson-runtime/math-scribe-lesson";
import { lessonNodeOrder, validateLessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import { getMathScribeProblem, MATH_SCRIBE_PROBLEM_IDS } from "../lib/math-scribe/problems";
import { createSession } from "../lib/math-scribe/session";
import { MATH_SCRIBE_DIFFERENCE_QUOTIENT_LESSON } from "../lib/lesson-runtime/math-scribe-difference-quotient-lesson";
import { isMathScribeProblemId } from "../lib/math-scribe/problems";

describe("math scribe lesson", () => {
  it("keeps the difference quotient in a separate one-problem lesson", () => {
    expect(lessonNodeOrder(MATH_SCRIBE_DIFFERENCE_QUOTIENT_LESSON)).toEqual(["difference-quotient", "recap"]);
    expect(isMathScribeProblemId("difference-quotient")).toBe(true);
    expect(getMathScribeProblem("difference-quotient").statedDomain).toEqual(["h ≠ 0"]);
    expect(MATH_SCRIBE_PROBLEM_IDS).toEqual(["reciprocal", "negative-exponent"]);
  });
  it("has parseable problems followed by a terminal recap", () => {
    expect(validateLessonDefinition(MATH_SCRIBE_LESSON).mathScribe).toBe(true);
    expect(lessonNodeOrder(MATH_SCRIBE_LESSON)).toEqual([...MATH_SCRIBE_PROBLEM_IDS, "recap"]);
    for (const id of MATH_SCRIBE_PROBLEM_IDS) {
      const problem = getMathScribeProblem(id);
      expect(createSession({ problemId: id, latex: problem.latex }).ok).toBe(true);
    }
  });
});
