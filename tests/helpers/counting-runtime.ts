/** Test adapter: legacy counting-focused tests opt into the registered fixture explicitly. */
export * from "../../lib/lesson-runtime/lesson-runtime-reducer";
import { COUNTING_LESSON } from "../../lib/lesson-runtime/counting-lesson";
import {
  createLessonRuntime as createRuntime,
  reduceLessonRuntime as reduceRuntime,
  type LessonRuntimeEvent,
  type LessonRuntimeState,
} from "../../lib/lesson-runtime/lesson-runtime-reducer";

export function createLessonRuntime(
  runtimeId: string,
  options: { quietDrainMs?: number; atMs?: number } = {},
): LessonRuntimeState {
  return createRuntime(runtimeId, { ...options, lesson: COUNTING_LESSON });
}

export function reduceLessonRuntime(state: LessonRuntimeState, event: LessonRuntimeEvent): ReturnType<typeof reduceRuntime> {
  return reduceRuntime(state, event, COUNTING_LESSON);
}
