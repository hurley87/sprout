import { COUNTING_LESSON } from "./counting-lesson";
import type { LessonDefinition } from "./lesson-definition";

/** Application-owned allowlist. Keep additions explicit and small. */
const APPLICATION_LESSONS: Readonly<Record<string, LessonDefinition>> = {
  [COUNTING_LESSON.id]: COUNTING_LESSON,
};

export function resolveLessonDefinition(value: unknown): LessonDefinition | null {
  return typeof value === "string" && Object.hasOwn(APPLICATION_LESSONS, value) ? APPLICATION_LESSONS[value] : null;
}
