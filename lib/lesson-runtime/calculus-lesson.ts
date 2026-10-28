import { CALCULUS_TUTOR_GUIDANCE } from "../calculus/work-check";
import { CALCULUS_PROBLEM_IDS, getCalculusProblem } from "../calculus/problems";
import { validateLessonDefinition, type LessonNodeDefinition } from "./lesson-definition";

const nodes: Record<string, LessonNodeDefinition> = {};
for (const [index, id] of CALCULUS_PROBLEM_IDS.entries()) {
  const problem = getCalculusProblem(id);
  nodes[id] = {
    id,
    presentation: { sceneId: id, prompt: problem.prompt },
    learningObjective: problem.prompt,
    tutorBrief: problem.tutorBrief,
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

/** The application checks each spoken step; the tutor follows that check. */
export const CALCULUS_LESSON = validateLessonDefinition({
  id: "calculus",
  initialNodeId: CALCULUS_PROBLEM_IDS[0],
  calculus: true,
  conversationFirst: true,
  nodes,
  recovery: {
    supportClarificationInstruction: "Ask one non-leading clarification of the learner's current step.",
    answerRecoveryInstruction: "Invite the learner to continue their working.",
  },
  // Required closed schema for lesson registration; calculus never invokes this classifier.
  classifier: {
    objectiveInstructions: "Calculus work uses the separate application step check.",
    objectiveCriteria: {
      completed: "Unused",
      incorrect: "Unused",
      unclear_or_incomplete: "Unused",
      unresolved_help: "Unused",
      no_attempt: "Unused",
    },
    tutorInstructions: "Tutor words grant no mathematical or navigation authority.",
    tutorCriteria: {
      confirmed_completion: "Unused",
      clarifying: "Unused",
      helping: "Unused",
      asking: "Unused",
      other: "Unused",
    },
  },
  tutor: {
    persona: "You are a calculus practice partner.",
    sessionGuidance: CALCULUS_TUTOR_GUIDANCE,
    startInstruction: "Ask the current problem and listen.",
    nodeInstruction: "Use only the current problem.",
  },
});
