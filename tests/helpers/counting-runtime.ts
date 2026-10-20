/** Test adapter: legacy counting-focused tests opt into the registered fixture explicitly. */
export * from "../../lib/lesson-runtime/lesson-runtime-reducer";
import { COUNTING_LESSON } from "../../lib/lesson-runtime/counting-lesson";
// These regressions pin the original confirmation-gated reducer contract.
// Current counting policy has separate direct reducer/runtime coverage.
export const LEGACY_COUNTING_LESSON = { ...COUNTING_LESSON, answerAcceptance: undefined };
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
  return createRuntime(runtimeId, { ...options, lesson: LEGACY_COUNTING_LESSON });
}

export function reduceLessonRuntime(state: LessonRuntimeState, event: LessonRuntimeEvent): ReturnType<typeof reduceRuntime> {
  return reduceRuntime(state, event, LEGACY_COUNTING_LESSON);
}
