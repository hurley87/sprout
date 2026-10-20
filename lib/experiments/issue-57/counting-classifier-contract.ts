/** Frozen confirmation-era rubric for offline issue #57 comparisons, never the live lesson. */
import { COUNTING_LESSON } from "../../lesson-runtime/counting-lesson";
import type { LessonDefinition } from "../../lesson-runtime/lesson-definition";
import { conversationStateQuestions } from "../../lesson-runtime/conversation-observer-contract";

export const HISTORICAL_COUNTING_LESSON: LessonDefinition = {
  ...COUNTING_LESSON,
  answerAcceptance: undefined,
  classifier: {
    objectiveInstructions: "Which mutually exclusive state best describes the objective now? Unresolved current help takes precedence over a previously correct or incorrect answer.",
    objectiveCriteria: {
      completed: "The child has settled on an intelligible correct answer for the authored quantity, including a finished count, self-correction, or reaffirmation. Earlier errors or help are resolved by later settled success. A later status question such as is that all does not automatically retract a settled answer unless it expresses renewed task uncertainty or help. Fillers or opening hesitation alone do not undo settlement. This is task completion, not proof of independent mastery.",
      incorrect: "The child has settled on an intelligible incorrect answer; no continuing help request or difficulty remains current.",
      unclear_or_incomplete: "The child attempted the task but has not settled on an intelligible answer: a partial count, unfinished speech, unresolved alternatives, or genuinely tentative final task answer. Tutor agreement cannot settle it. Use unresolved_help instead if continuing difficulty or a help request remains current.",
      unresolved_help: "The child still needs help or expresses continuing difficulty at snapshot end, including renewed help or renewed task uncertainty after a correct answer. Historical help resolved by a later settled correct child answer is no longer current. A wrong or partial answer alone does not establish a help need. Tutor help alone does not establish current child difficulty. A tutor-supplied answer without settled child evidence cannot resolve a help request.",
      no_attempt: "No Child-labelled task attempt exists for this objective; only tutor-supplied answers, greetings or unrelated speech. Not-knowing and help requests belong to unresolved_help. Missing text does not imply silence or thinking.",
    },
    tutorInstructions: "Describe only the latest relevant tutor response in the ordered transcript, using earlier child and tutor messages as context. Earlier messages are context only, never the latest tutor action. Select the latest response's primary conversational function, not earlier tutor behaviour or physical audio activity.",
    tutorCriteria: {
      confirmed_completion: "The latest relevant tutor response clearly confirms the child's settled correct answer for this current objective. Agreement or a factual restatement can confirm it. Generic praise or thanks alone is insufficient. Supplying a total without settled child evidence, correcting a still-wrong answer, or agreeing with unfinished, tentative or superseded evidence is not confirmation.",
      clarifying: "Primarily asks the child to repeat, finish or disambiguate their response without supplying an answer or counting method.",
      helping: "Primarily gives a hint, counting method, model or invitation to count together, including scaffolding phrased as a question.",
      asking: "Primarily invites the child to answer the current authored counting question, without clarifying their response or giving a scaffold.",
      other: "No tutor message, generic encouragement or thanks without answer confirmation, unrelated speech, or another function not covered above.",
    },
  },
};
export const CONVERSATION_STATE_QUESTIONS = conversationStateQuestions(HISTORICAL_COUNTING_LESSON);
export const CONTEXT_PROJECTION_QUESTIONS = CONVERSATION_STATE_QUESTIONS;
