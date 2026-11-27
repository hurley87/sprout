import { expect, it } from "vitest";
import { chimneyMisses, countAlongDuration, recordChimneySuccess } from "../app/down-the-chimney-timeline";
import {
  CHIMNEY_INITIAL_PACE,
  chimneyDropSequenceMs,
  chimneyReplayIntervalMs,
} from "../lib/lesson-runtime/down-the-chimney-plan";
import { downTheChimneyLesson } from "../lib/lesson-runtime/down-the-chimney-lesson";
import type { LessonSnapshot } from "../lib/lesson-runtime/lesson-runtime";
it("keeps the window open past the final landing and slows replays", () => {
  expect(countAlongDuration(3, 1500)).toBe(chimneyDropSequenceMs(3, 1500) + 600);
  expect([0, 1, 2].map(misses => chimneyReplayIntervalMs(1500, misses))).toEqual([1500, 1800, 2000]);
});
it("only counts misses from the current confirmed visit", () => {
  const node = downTheChimneyLesson(0).nodes["chimney-1"];
  const snapshot = {
    runtime: {
      nodeId: node.id,
      visitId: 2,
      pendingRender: null,
      difficulties: [
        { kind: "incorrect", source: { visitId: 1 } },
        { kind: "incorrect", source: { visitId: 2 } },
      ],
    },
  } as unknown as LessonSnapshot;
  expect(chimneyMisses(snapshot, node)).toBe(1);
  expect(chimneyMisses({ ...snapshot, runtime: { ...snapshot.runtime!, pendingRender: {} as never } }, node)).toBe(0);
});
it("records each successful visit once and resets pace for a new session", () => {
  const initial = { session: "a", pace: CHIMNEY_INITIAL_PACE, succeeded: new Set<string>() };
  const missed = recordChimneySuccess(initial, "a", "one", true);
  expect(missed.pace.slowdown).toBe(1);
  expect(recordChimneySuccess(missed, "a", "one", true)).toBe(missed);
  expect(recordChimneySuccess(missed, "b", "one", false).pace).toEqual({ slowdown: 0, cleanStreak: 1 });
});

it("uses the opening quiet period and preserves the no-output fallback", async () => {
  const { introDelay } = await import("../app/down-the-chimney-timeline");
  expect(introDelay(1, false, false)).toBeNull();
  expect(introDelay(1, false, true)).toBe(0);
  expect(introDelay(1, true, false)).toBe(1200);
  expect(introDelay(2, false, false)).toBe(1000);
});
it("waits for a reply to finish or uses the silent tutor fallback", async () => {
  const { missReplayDelay } = await import("../app/down-the-chimney-timeline");
  expect(missReplayDelay(false, false)).toBeNull();
  expect(missReplayDelay(false, true)).toBe(0);
  expect(missReplayDelay(true, true)).toBe(700);
});
it("allows two silence replays per round", async () => {
  const { silenceReplayDelay } = await import("../app/down-the-chimney-timeline");
  expect([0, 1, 2].map(silenceReplayDelay)).toEqual([6000, 6000, null]);
});
