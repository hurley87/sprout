import type { LessonDefinition } from "./lesson-definition";

export const ANSWER_COMMITMENTS = ["committed", "unresolved", "withdrawn", "no_answer"] as const;
export type AnswerCommitment = (typeof ANSWER_COMMITMENTS)[number];

/** Application-owned learner-evidence lessons; others keep their confirmation gates. */
const LEARNER_EVIDENCE_LESSON_IDS: ReadonlySet<string> = new Set(["counting", "counting-halloween", "ice-cream-shop"]);

/** Accept learner evidence separately from the latest tutor feedback. */
export function acceptsLearnerAnswerIndependently(lesson?: LessonDefinition) {
  return (
    !!lesson &&
    LEARNER_EVIDENCE_LESSON_IDS.has(lesson.id) &&
    lesson.answerAcceptance === "learner_evidence" &&
    !lesson.conversationFirst
  );
}
