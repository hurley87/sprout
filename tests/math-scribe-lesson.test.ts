import { describe, expect, it } from "vitest";
import { MATH_SCRIBE_LESSON } from "../lib/lesson-runtime/math-scribe-lesson";
import { lessonNodeOrder, validateLessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import { getMathScribeProblem, MATH_SCRIBE_PROBLEM_IDS } from "../lib/math-scribe/problems";
import { createSession } from "../lib/math-scribe/session";

describe("math scribe lesson", () => {
  it("has parseable problems followed by a terminal recap", () => {
    expect(validateLessonDefinition(MATH_SCRIBE_LESSON).mathScribe).toBe(true);
    expect(lessonNodeOrder(MATH_SCRIBE_LESSON)).toEqual([...MATH_SCRIBE_PROBLEM_IDS, "recap"]);
    for (const id of MATH_SCRIBE_PROBLEM_IDS) {
      const problem = getMathScribeProblem(id);
      expect(createSession({ problemId: id, latex: problem.latex }).ok).toBe(true);
    }
  });
});
