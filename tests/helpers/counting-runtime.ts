/** Test adapter: legacy counting-focused tests opt into the registered fixture explicitly. */
export * from "../../lib/lesson-runtime/lesson-runtime-reducer";
import { COUNTING_LESSON } from "../../lib/lesson-runtime/counting-lesson";
// These regressions pin the original confirmation-gated reducer contract.
// Current counting policy has separate direct reducer/runtime coverage.
/** Runtime-mechanics replays recorded under the shared 250 ms transition window. The counting
 * lessons now author 1,000 ms; tests/counting-halloween-transition.test.ts covers that window. */
export const SHARED_WINDOW_COUNTING_LESSON = { ...COUNTING_LESSON, transitionQuietMs: undefined };
export const LEGACY_COUNTING_LESSON = { ...SHARED_WINDOW_COUNTING_LESSON, answerAcceptance: undefined };
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

export function reduceLessonRuntime(
  state: LessonRuntimeState,
  event: LessonRuntimeEvent,
): ReturnType<typeof reduceRuntime> {
  return reduceRuntime(state, event, LEGACY_COUNTING_LESSON);
}
