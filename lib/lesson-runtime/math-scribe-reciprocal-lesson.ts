import { validateLessonDefinition } from "./lesson-definition";
import { MATH_SCRIBE_LESSON } from "./math-scribe-lesson";

export const MATH_SCRIBE_RECIPROCAL_LESSON = validateLessonDefinition({
  ...MATH_SCRIBE_LESSON,
  id: "math-scribe-reciprocal",
  initialNodeId: "reciprocal",
  nodes: {
    reciprocal: {
      ...MATH_SCRIBE_LESSON.nodes.reciprocal,
      onSuccess: { kind: "node", nodeId: "recap" },
    },
    recap: MATH_SCRIBE_LESSON.nodes.recap,
  },
});
