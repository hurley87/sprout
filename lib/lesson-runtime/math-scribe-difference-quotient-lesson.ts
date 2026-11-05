import { validateLessonDefinition } from "./lesson-definition";
import { MATH_SCRIBE_LESSON } from "./math-scribe-lesson";

export const MATH_SCRIBE_DIFFERENCE_QUOTIENT_LESSON = validateLessonDefinition({
  ...MATH_SCRIBE_LESSON,
  id: "math-scribe-difference-quotient",
  initialNodeId: "difference-quotient",
  nodes: {
    "difference-quotient": {
      ...MATH_SCRIBE_LESSON.nodes.reciprocal,
      id: "difference-quotient",
      presentation: { sceneId: "difference-quotient", prompt: "the difference quotient" },
      onSuccess: { kind: "node", nodeId: "recap" },
    },
    recap: MATH_SCRIBE_LESSON.nodes.recap,
  },
});
