import type { LessonEventCursor, LessonObservation, LessonRuntime } from "./lesson-runtime";

export type LessonObservationBridge = {
  read(after?: LessonEventCursor): LessonObservation | null;
  report(): ReturnType<LessonRuntime["report"]> | null;
};

export type LessonObservationWindow = {
  __SPROUT_OBSERVE_LESSON__?: boolean;
  sproutLessonObservation?: LessonObservationBridge;
};

/** Explicit test opt-in, evaluated at mount. The facade has no transition authority. */
export function attachLessonObservation(host: LessonObservationWindow, current: () => LessonRuntime | null) {
  if (host.__SPROUT_OBSERVE_LESSON__ !== true) return () => {};
  let attached = true;
  const bridge: LessonObservationBridge = Object.freeze({
    read: (after?: LessonEventCursor) => (attached ? (current()?.observe(after) ?? null) : null),
    report: () => (attached ? structuredClone(current()?.report() ?? null) : null),
  });
  Object.defineProperty(host, "sproutLessonObservation", { value: bridge, configurable: true });
  return () => {
    attached = false;
    if (host.sproutLessonObservation === bridge) delete host.sproutLessonObservation;
  };
}
