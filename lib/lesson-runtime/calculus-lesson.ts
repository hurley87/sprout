import { CALCULUS_TUTOR_GUIDANCE } from "../calculus/tutor-context";
import { CALCULUS_PROBLEM_IDS, getCalculusPresentation } from "../calculus/problems";
import { validateLessonDefinition, type LessonNodeDefinition } from "./lesson-definition";

const nodes: Record<string, LessonNodeDefinition> = {};
for (const [index, id] of CALCULUS_PROBLEM_IDS.entries()) {
  const problem = getCalculusPresentation(id);
  nodes[id] = {
    id,
    presentation: { sceneId: id, prompt: problem.prompt },
    learningObjective: problem.prompt,
    tutorBrief: problem.initialTutorContext,
    onSuccess: { kind: "node", nodeId: CALCULUS_PROBLEM_IDS[index + 1] ?? "recap" },
  };
}
nodes.recap = {
  id: "recap",
  presentation: { sceneId: "recap", prompt: "Review your calculus practice." },
  learningObjective: "Close the practice without inferring independent understanding.",
  tutorBrief: "Close the practice without adding another problem or unsupported mastery claims.",
  completeAfterTutorOutput: true,
  onSuccess: { kind: "complete" },
};

/** Explicit opt-in; no public route until the board and feedback integrations exist. */
export const CALCULUS_LESSON = validateLessonDefinition({
  id: "calculus",
  initialNodeId: CALCULUS_PROBLEM_IDS[0],
  calculus: true,
  conversationFirst: true,
  nodes,
  recovery: {
    supportClarificationInstruction: "Ask one non-leading clarification of the learner's intended mathematical step.",
    answerRecoveryInstruction: "Invite the learner to clarify their own intended notation.",
  },
  tutor: {
    persona: "You are a calculus practice partner.",
    sessionGuidance: CALCULUS_TUTOR_GUIDANCE,
    startInstruction: "Ask the current problem and listen.",
    nodeInstruction: "Use only the current problem.",
  },
});
