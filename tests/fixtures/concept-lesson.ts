import { validateLessonDefinition, type LessonDefinition } from "../../lib/lesson-runtime/lesson-definition";

/** Neutral infrastructure fixture; it is not a rubric for Catching Unicorns. */
export const TEST_CONCEPT_LESSON: LessonDefinition = validateLessonDefinition({
  id: "test-concepts",
  initialNodeId: "concept-a",
  recovery: {
    supportClarificationInstruction: "Ask whether the learner wants help without giving the explanation.",
    answerRecoveryInstruction: "Ask the learner to repeat their explanation without supplying it.",
  },
  nodes: {
    "concept-a": {
      id: "concept-a",
      presentation: { sceneId: "concept-card", topic: "repeating sequence" },
      learningObjective: "Explain what repeats in the displayed sequence.",
      tutorBrief: "Invite the learner to explain the repeating element.",
      concepts: [{ id: "repetition", description: "Identify the element that recurs in the sequence." }],
      completionPolicy: "all_demonstrated",
      onSuccess: { kind: "node", nodeId: "concept-b", carryForwardCriteria: ["repetition"] },
    },
    "concept-b": {
      id: "concept-b",
      presentation: { sceneId: "concept-card-next", topic: "sequence change" },
      learningObjective: "Explain the repeating element and what changes.",
      tutorBrief: "Ask the learner to compare the sequences.",
      concepts: [
        { id: "repetition", description: "Identify the element that recurs in the sequence." },
        { id: "change", description: "Identify how the next displayed sequence changes." },
      ],
      completionPolicy: "all_demonstrated",
      onSuccess: { kind: "complete" },
    },
  },
  tutor: {
    persona: "You are a patient pattern tutor.",
    sessionGuidance: "Let the learner explain in their own words.",
    startInstruction: "Ask what repeats.",
    nodeInstruction: "Teach only the current displayed pattern.",
  },
  classifier: {
    objectiveInstructions: "Judge only the current authored objective.",
    objectiveCriteria: {
      completed: "The learner's explanation settles the current objective.",
      incorrect: "The learner settles on an incorrect explanation.",
      unclear_or_incomplete: "The learner's explanation is incomplete or unclear.",
      unresolved_help: "The learner still needs help.",
      no_attempt: "The learner has not attempted the current objective.",
    },
    tutorInstructions: "Classify the latest relevant tutor response.",
    tutorCriteria: {
      confirmed_completion: "The tutor confirms a settled correct explanation.",
      clarifying: "The tutor asks for clarification.",
      helping: "The tutor gives a hint or scaffold.",
      asking: "The tutor invites an answer.",
      other: "Another tutor response or no tutor response.",
    },
  },
});

export const CONCEPT_TRANSCRIPT_FIXTURES = {
  paraphrase: "Tutor: What repeats in the sequence?\nChild: The same shape comes back again and again.",
  incomplete: "Tutor: What repeats in the sequence?\nChild: There are shapes...",
  selfCorrection: "Tutor: What repeats in the sequence?\nChild: The triangle.\nChild: Wait, I see the circle comes back each time.",
  prompted: "Tutor: What repeats in the sequence?\nChild: Not sure.\nTutor: Look for the shape that appears again.\nChild: The circle keeps coming back.",
  tutorAnswerLeakage: "Tutor: The circle repeats each time.\nChild: The circle repeats each time.",
  multipleCriteria: "Tutor: Compare these sequences.\nChild: The circle appears in both, and the second one adds a triangle.",
} as const;
