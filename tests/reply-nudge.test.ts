import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AnswerRecoveryActivity } from "../lib/lesson-runtime/answer-recovery";
import { DINO_CAR_CRUNCH_LESSON as lesson } from "../lib/lesson-runtime/dino-car-crunch-lesson";
import { validateLessonDefinition, type LessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import {
  createLessonRuntime,
  runtimeSource,
  type LessonRuntimeState,
} from "../lib/lesson-runtime/lesson-runtime-reducer";
import { ReplyNudge, SILENCE_NUDGE_AFTER_BURST_MS } from "../lib/lesson-runtime/silence-nudge";

const answered: LessonRuntimeState = {
  ...createLessonRuntime("runtime", { lesson }),
  hasChildTurn: true,
  childTurnId: 1,
  hasChildTranscript: true,
  transcriptSource: "child",
  outputActivity: "quiet",
};
const burst = {
  childSpeaking: true,
  childCandidate: { deferredTurn: true, hasChildTranscript: true, tutorOutputObserved: false },
};
const afterQuietMs = lesson.replyNudge!.afterQuietMs;

function setup(definition = lesson) {
  const request = vi.fn();
  const diagnostic = vi.fn();
  const nudge = new ReplyNudge(definition, request, diagnostic);
  const observe = (
    overrides: Partial<LessonRuntimeState> = {},
    recovery: AnswerRecoveryActivity = { pending: false },
  ) => nudge.observe({ ...answered, ...overrides }, true, recovery);
  const endTurn = (overrides: Partial<LessonRuntimeState> = {}) => {
    const state = { ...answered, ...overrides };
    nudge.childTurnEnded(runtimeSource(state));
    observe(overrides);
  };
  return { nudge, request, diagnostic, observe, endTurn };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("waits for the actual turn end, then sends once per visit", () => {
  const { observe, endTurn, request } = setup();
  observe(burst);
  observe();
  vi.advanceTimersByTime(afterQuietMs);
  expect(request).not.toHaveBeenCalled();

  endTurn();
  vi.advanceTimersByTime(afterQuietMs - 1);
  expect(request).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(request).toHaveBeenCalledExactlyOnceWith(runtimeSource(answered), lesson.replyNudge);

  endTurn({ childTurnId: 2 });
  vi.advanceTimersByTime(20_000);
  expect(request).toHaveBeenCalledOnce();

  observe({ visitId: 2, nodeId: "twenty-three" });
  vi.advanceTimersByTime(afterQuietMs);
  expect(request).toHaveBeenCalledOnce();
  endTurn({ visitId: 2, nodeId: "twenty-three", childTurnId: 3 });
  vi.advanceTimersByTime(afterQuietMs);
  expect(request).toHaveBeenCalledTimes(2);
});

it("cancels when the tutor replies in the transcript", () => {
  const { diagnostic, observe, endTurn, request } = setup();
  endTurn();
  vi.advanceTimersByTime(2_000);
  observe({ transcriptSource: "tutor" });
  vi.advanceTimersByTime(20_000);
  expect(request).not.toHaveBeenCalled();
  expect(diagnostic).toHaveBeenCalledWith("reply_nudge.cancelled", runtimeSource(answered), {
    reason: "latest_transcript_not_child",
  });
});

it("retains the turn-end deadline when a child transcript arrives late", () => {
  const { observe, endTurn, request } = setup();
  endTurn({ transcriptSource: "tutor" });
  vi.advanceTimersByTime(2_000);
  observe();
  vi.advanceTimersByTime(afterQuietMs - 2_001);
  expect(request).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(request).toHaveBeenCalledOnce();
});

it.each(["child", "tutor"] as const)("restarts the quiet wait after %s speech", speaker => {
  const { observe, endTurn, request } = setup();
  endTurn();
  vi.advanceTimersByTime(3_000);
  observe(speaker === "child" ? { childSpeaking: true, childTurnId: 2 } : { outputActivity: "active" });
  vi.advanceTimersByTime(afterQuietMs);
  expect(request).not.toHaveBeenCalled();

  if (speaker === "child") endTurn({ childTurnId: 2 });
  else observe();
  vi.advanceTimersByTime(afterQuietMs - 1);
  expect(request).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(request).toHaveBeenCalledOnce();
});

it.each([
  { burstAt: 2_000, duration: 200, remaining: 3_800 },
  { burstAt: 5_500, duration: 1_000, remaining: SILENCE_NUDGE_AFTER_BURST_MS },
])("pauses for a provisional burst at $burstAt ms", ({ burstAt, duration, remaining }) => {
  const { observe, endTurn, request } = setup();
  endTurn();
  vi.advanceTimersByTime(burstAt);
  observe(burst);
  vi.advanceTimersByTime(duration);
  expect(request).not.toHaveBeenCalled();
  observe();
  vi.advanceTimersByTime(remaining - 1);
  expect(request).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(request).toHaveBeenCalledOnce();
});

it("resumes the original quiet wait if answer recovery settles without a send", () => {
  const { observe, endTurn, request } = setup();
  endTurn();
  observe({}, { pending: true });
  vi.advanceTimersByTime(afterQuietMs + 500);
  expect(request).not.toHaveBeenCalled();
  observe();
  vi.advanceTimersByTime(0);
  expect(request).toHaveBeenCalledOnce();
});

it.each([
  null,
  { afterQuietMs: 2_999, instruction: "Too soon." },
  { afterQuietMs: 60_001, instruction: "Too late." },
  { afterQuietMs: 6_000.5, instruction: "Fractional." },
  { afterQuietMs: 6_000, instruction: " " },
])("rejects an invalid reply nudge definition %#", replyNudge => {
  expect(() => validateLessonDefinition({ ...lesson, replyNudge } as LessonDefinition)).toThrow(/Reply nudge/);
});
