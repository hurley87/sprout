import type { LessonDefinition } from "./lesson-definition";

export const ANSWER_COMMITMENTS = ["committed", "unresolved", "withdrawn", "no_answer"] as const;
export type AnswerCommitment = (typeof ANSWER_COMMITMENTS)[number];

/** Application-owned counting adventures; any other lesson keeps its confirmation gates. */
const COUNTING_LESSON_IDS: ReadonlySet<string> = new Set(["counting", "counting-halloween"]);

/** Counting accepts learner evidence separately from the latest tutor feedback. */
export function acceptsLearnerAnswerIndependently(lesson?: LessonDefinition) {
  return (
    !!lesson &&
    COUNTING_LESSON_IDS.has(lesson.id) &&
    lesson.answerAcceptance === "learner_evidence" &&
    !lesson.conversationFirst
  );
}
