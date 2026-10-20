import type { LessonDefinition } from "./lesson-definition";

export const ANSWER_COMMITMENTS = ["committed", "unresolved", "withdrawn", "no_answer"] as const;
export type AnswerCommitment = (typeof ANSWER_COMMITMENTS)[number];

/** Counting accepts learner evidence separately from the latest tutor feedback. */
export function acceptsLearnerAnswerIndependently(lesson?: LessonDefinition) {
  return lesson?.id === "counting" && lesson.answerAcceptance === "learner_evidence" && !lesson.conversationFirst;
}
