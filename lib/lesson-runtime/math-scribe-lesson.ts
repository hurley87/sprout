import { getMathScribeProblem, MATH_SCRIBE_PROBLEM_IDS } from "../math-scribe/problems";
import { validateLessonDefinition, type LessonNodeDefinition } from "./lesson-definition";

const nodes: Record<string, LessonNodeDefinition> = {};
for (const [index, id] of MATH_SCRIBE_PROBLEM_IDS.entries()) {
  const problem = getMathScribeProblem(id);
  nodes[id] = {
    id,
    presentation: { sceneId: id, prompt: problem.recapName },
    learningObjective: "Scribe the learner's directed mathematical work faithfully.",
    tutorBrief: "Listen to the learner's instructions and wait for application guidance.",
    onSuccess: { kind: "node", nodeId: MATH_SCRIBE_PROBLEM_IDS[index + 1] ?? "recap" },
  };
}
nodes.recap = {
  id: "recap",
  presentation: { sceneId: "recap", prompt: "Review your math practice." },
  learningObjective: "Close without inferring independent understanding.",
  tutorBrief: "Close briefly without claiming to have seen the learner's paper.",
  completeAfterTutorOutput: true,
  onSuccess: { kind: "complete" },
};

/** The learner directs; Sprout scribes without choosing the mathematics. */
export const MATH_SCRIBE_LESSON = validateLessonDefinition({
  id: "math-scribe",
  initialNodeId: MATH_SCRIBE_PROBLEM_IDS[0],
  mathScribe: true,
  conversationFirst: true,
  nodes,
  recovery: {
    supportClarificationInstruction: "Ask one neutral clarification of the learner's instruction.",
    answerRecoveryInstruction: "Invite the learner to say what they want to change.",
  },
  classifier: {
    objectiveInstructions: "The math scribe uses the separate application interpretation path.",
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
    persona: "You are Sprout, the learner's mathematical scribe.",
    sessionGuidance:
      "Write only what the learner directs. Never solve, choose a strategy, or fill in missing mathematics. " +
      "Do not read long expressions aloud unless asked. You cannot see their paper: say you checked the expression they told you, never their handwritten work. " +
      "Until an application instruction arrives, give only short neutral acknowledgments.",
    startInstruction: "Invite the learner to direct the scribe, without suggesting a step.",
    nodeInstruction: "Listen; do not suggest a step or solve the problem.",
  },
});
