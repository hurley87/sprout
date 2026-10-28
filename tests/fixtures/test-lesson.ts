import { validateLessonDefinition, type LessonDefinition } from "../../lib/lesson-runtime/lesson-definition";

/** Test-only non-counting content; deliberately absent from the application registry. */
export const TEST_PATTERN_LESSON: LessonDefinition = validateLessonDefinition({
  id: "test-patterns",
  initialNodeId: "pattern-a",
  recovery: {
    supportClarificationInstruction:
      "For this pattern activity, ask whether the learner has finished describing what repeats or would like help. Follow any new response and do not supply the pattern rule. This request cannot complete the activity.",
    answerRecoveryInstruction:
      "For this pattern activity, ask the learner to repeat their description if they are waiting. Follow any new response, and do not provide the pattern rule or claim completion without a settled learner answer.",
  },
  nodes: {
    "pattern-a": {
      id: "pattern-a",
      presentation: { sceneId: "pattern-card", symbol: "circle", sequenceLength: 4 },
      learningObjective: "Describe the repeated symbol in the displayed pattern.",
      tutorBrief: "Ask what repeats in the pattern; let the learner explain in their own words.",
      onSuccess: { kind: "node", nodeId: "pattern-b" },
    },
    "pattern-b": {
      id: "pattern-b",
      presentation: { sceneId: "pattern-card-next", symbol: "triangle", sequenceLength: 5 },
      learningObjective: "Explain what changes in the next pattern.",
      tutorBrief: "Ask what changed and invite a short explanation.",
      onSuccess: { kind: "complete" },
    },
  },
  tutor: {
    persona: "You are a patient pattern tutor.",
    sessionGuidance: "Let the learner explain before offering a hint.",
    startInstruction: "Ask what repeats in the displayed sequence.",
    nodeInstruction: "Teach only the displayed pattern and its current objective.",
  },
  classifier: {
    objectiveInstructions: "Judge understanding of the current pattern objective.",
    objectiveCriteria: {
      completed: "The learner correctly describes the pattern rule.",
      incorrect: "The learner settles on an incorrect pattern rule.",
      unclear_or_incomplete: "The explanation is incomplete or unclear.",
      unresolved_help: "The learner still needs help or expresses difficulty.",
      no_attempt: "No learner attempt at the objective exists.",
    },
    tutorInstructions: "Classify only the latest tutor response.",
    tutorCriteria: {
      confirmed_completion: "The tutor clearly confirms a correct explanation.",
      clarifying: "The tutor asks for repetition or clarification.",
      helping: "The tutor provides a hint or scaffold.",
      asking: "The tutor invites an answer to the current objective.",
      other: "No relevant tutor message or another function.",
    },
  },
});
