import { COUNTING_LESSON } from "./counting-lesson";
import { CATCHING_UNICORNS_LESSON } from "./catching-unicorns-lesson";
import type { LessonDefinition } from "./lesson-definition";

/** Application-owned allowlist. Keep additions explicit and small. */
const APPLICATION_LESSONS: Readonly<Record<string, LessonDefinition>> = {
  [COUNTING_LESSON.id]: COUNTING_LESSON,
  [CATCHING_UNICORNS_LESSON.id]: CATCHING_UNICORNS_LESSON,
};

export function resolveLessonDefinition(value: unknown): LessonDefinition | null {
  return typeof value === "string" && Object.hasOwn(APPLICATION_LESSONS, value) ? APPLICATION_LESSONS[value] : null;
}
