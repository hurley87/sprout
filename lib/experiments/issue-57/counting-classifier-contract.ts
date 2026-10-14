/** Counting-only rubric alias retained for frozen offline issue #57 comparisons. */
import { COUNTING_LESSON } from "../../lesson-runtime/counting-lesson";
import { conversationStateQuestions } from "../../lesson-runtime/conversation-observer-contract";

export const CONVERSATION_STATE_QUESTIONS = conversationStateQuestions(COUNTING_LESSON);
export const CONTEXT_PROJECTION_QUESTIONS = CONVERSATION_STATE_QUESTIONS;
