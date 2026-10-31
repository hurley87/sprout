import { CALCULUS_LESSON } from "./calculus-lesson";
import { COUNTING_LESSON } from "./counting-lesson";
import { COUNTING_HALLOWEEN_LESSON } from "./counting-halloween-lesson";
import { CATCHING_UNICORNS_LESSON } from "./catching-unicorns-lesson";
import { MAE386_LESSON } from "./mae386-lesson";
import type { LessonDefinition } from "./lesson-definition";

/** Application-owned allowlist. Keep additions explicit and small. */
const APPLICATION_LESSONS: Readonly<Record<string, LessonDefinition>> = {
  [CALCULUS_LESSON.id]: CALCULUS_LESSON,
  [COUNTING_LESSON.id]: COUNTING_LESSON,
  [COUNTING_HALLOWEEN_LESSON.id]: COUNTING_HALLOWEEN_LESSON,
  [CATCHING_UNICORNS_LESSON.id]: CATCHING_UNICORNS_LESSON,
  [MAE386_LESSON.id]: MAE386_LESSON,
};

export function resolveLessonDefinition(value: unknown): LessonDefinition | null {
  return typeof value === "string" && Object.hasOwn(APPLICATION_LESSONS, value) ? APPLICATION_LESSONS[value] : null;
}
