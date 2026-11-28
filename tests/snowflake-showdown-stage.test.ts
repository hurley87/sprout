import { expect, it } from "vitest";
import { pairingLines } from "../app/snowflake-showdown-scene";
import { snowflakeShowdownSuccessLabel } from "../app/snowflake-showdown-theme";
import {
  MAX_WIGGLES,
  PAIRING_LEAD_MS,
  PAIRING_STEP_MS,
  SILENCE_START,
  SILENCE_WIGGLE_MS,
  STREAK_START,
  observeSilence,
  pairingSchedule,
  pairsShown,
  recordShowdownSuccess,
  recordWiggle,
  showsFlurry,
  snowflakeShowdownMisses,
  successTimeline,
  wiggleDueAtMs,
  type SilenceClock,
  type SilenceSignals,
} from "../app/snowflake-showdown-timeline";
import { snowflakeShowdownLesson } from "../lib/lesson-runtime/snowflake-showdown-lesson";
import { snowflakeLayout } from "../lib/lesson-runtime/snowflake-showdown-plan";
import type { LessonSnapshot } from "../lib/lesson-runtime/lesson-runtime";

const lesson = snowflakeShowdownLesson(0);
// Seed 0, round 5: blue 5, pink 3, so blue has more and two blue snowflakes are left over.
const node = lesson.nodes["showdown-5"];

it("only counts incorrect misses from the current confirmed visit", () => {
  const snapshot = {
    runtime: {
      nodeId: node.id,
      visitId: 2,
      pendingRender: null,
      difficulties: [
        { kind: "incorrect", source: { visitId: 1 } },
        { kind: "incorrect", source: { visitId: 2 } },
        { kind: "help_request", source: { visitId: 2 } },
      ],
    },
  } as unknown as LessonSnapshot;
  expect(snowflakeShowdownMisses(snapshot, node)).toBe(1);
  expect(
    snowflakeShowdownMisses({ ...snapshot, runtime: { ...snapshot.runtime!, pendingRender: {} as never } }, node),
  ).toBe(0);
  expect(snowflakeShowdownMisses(snapshot, lesson.nodes["showdown-6"])).toBe(0);
  expect(snowflakeShowdownMisses(snapshot, null)).toBe(0);
  expect(snowflakeShowdownMisses(null, node)).toBe(0);
});

it("pairs one snowflake from each mitten about every half second, then glows the leftovers", () => {
  const blue = snowflakeLayout(0, 5, "blue");
  const pink = snowflakeLayout(0, 5, "pink");
  expect([blue.length, pink.length]).toEqual([5, 3]);
  const schedule = pairingSchedule(pairingLines(blue, pink));
  expect(schedule.steps).toHaveLength(3);
  expect(schedule.steps.map(step => step.atMs)).toEqual([
    PAIRING_LEAD_MS,
    PAIRING_LEAD_MS + PAIRING_STEP_MS,
    PAIRING_LEAD_MS + 2 * PAIRING_STEP_MS,
  ]);
  expect(PAIRING_STEP_MS).toBe(500);
  // Each pair joins a shown blue and a shown pink snowflake, each used once.
  expect(new Set(schedule.steps.map(step => step.blue)).size).toBe(3);
  expect(new Set(schedule.steps.map(step => step.pink))).toEqual(new Set(pink));
  for (const step of schedule.steps) expect(blue).toContain(step.blue);
  expect(schedule.leftover).toEqual({ colour: "blue", slots: [3, 7] });
  expect([...schedule.leftover!.slots, ...schedule.steps.map(step => step.blue)].sort()).toEqual([...blue].sort());
  expect(schedule.leftoverAtMs).toBe(schedule.steps.at(-1)!.atMs + PAIRING_STEP_MS);
  expect(schedule.endMs).toBe(schedule.leftoverAtMs);

  expect(pairsShown(schedule, 0)).toBe(0);
  expect(pairsShown(schedule, PAIRING_LEAD_MS)).toBe(1);
  expect(pairsShown(schedule, PAIRING_LEAD_MS + PAIRING_STEP_MS - 1)).toBe(1);
  expect(pairsShown(schedule, schedule.endMs)).toBe(3);
});

it("shows the whole pairing at once with reduced motion", () => {
  const schedule = pairingSchedule(pairingLines(snowflakeLayout(0, 5, "blue"), snowflakeLayout(0, 5, "pink")), true);
  expect(schedule.steps.map(step => step.atMs)).toEqual([0, 0, 0]);
  expect(schedule.leftoverAtMs).toBe(0);
  expect(pairsShown(schedule, 0)).toBe(3);
});

const quiet: SilenceSignals = {
  ready: true,
  childSpeaking: false,
  childCandidate: false,
  tutorActive: false,
  childTurnId: 0,
};
function run(steps: [atMs: number, signals: Partial<SilenceSignals>][]): SilenceClock {
  return steps.reduce((clock, [atMs, signals]) => observeSilence(clock, { ...quiet, ...signals }, atMs), SILENCE_START);
}

it("waits five quiet seconds from the flip ending before a wiggle", () => {
  expect(SILENCE_WIGGLE_MS).toBe(5_000);
  // Still flipping: nothing is due.
  expect(wiggleDueAtMs(run([[0, { ready: false }]]))).toBeNull();
  const flipped = run([
    [0, { ready: false }],
    [500, {}],
  ]);
  expect(wiggleDueAtMs(flipped)).toBe(5_500);
  // The same signals again change nothing.
  expect(observeSilence(flipped, quiet, 3_000)).toBe(flipped);
});

it("restarts the wait when the tutor goes quiet or her turn ends, and cancels it while anyone is busy", () => {
  // The tutor talks from 1 s to 3 s: the wait starts again at 3 s.
  let clock = run([
    [0, {}],
    [1_000, { tutorActive: true }],
  ]);
  expect(wiggleDueAtMs(clock)).toBeNull();
  clock = observeSilence(clock, quiet, 3_000);
  expect(wiggleDueAtMs(clock)).toBe(8_000);

  // She speaks from 4 s; a candidate alone also cancels; the wait restarts when her turn ends.
  clock = observeSilence(clock, { ...quiet, childCandidate: true }, 4_000);
  expect(wiggleDueAtMs(clock)).toBeNull();
  clock = observeSilence(clock, { ...quiet, childSpeaking: true, childTurnId: 1 }, 4_200);
  expect(wiggleDueAtMs(clock)).toBeNull();
  clock = observeSilence(clock, { ...quiet, childTurnId: 1 }, 5_000);
  expect(wiggleDueAtMs(clock)).toBe(10_000);

  // A new turn id while quiet (a turn that started and ended between observations) restarts it too.
  clock = observeSilence(clock, { ...quiet, childTurnId: 2 }, 6_000);
  expect(wiggleDueAtMs(clock)).toBe(11_000);

  // Success or a pending render makes the round not ready.
  expect(wiggleDueAtMs(observeSilence(clock, { ...quiet, childTurnId: 2, ready: false }, 7_000))).toBeNull();
});

it("repeats after another five quiet seconds, at most three times a round", () => {
  let clock = run([[0, {}]]);
  const wiggles: number[] = [];
  for (let at = wiggleDueAtMs(clock); at !== null; at = wiggleDueAtMs(clock)) {
    wiggles.push(at);
    clock = recordWiggle(clock, at);
  }
  expect(MAX_WIGGLES).toBe(3);
  expect(wiggles).toEqual([5_000, 10_000, 15_000]);
  // Activity after the cap brings no more.
  clock = observeSilence(clock, { ...quiet, tutorActive: true }, 16_000);
  clock = observeSilence(clock, quiet, 17_000);
  expect(wiggleDueAtMs(clock)).toBeNull();
  // A tutor reply between wiggles pushes the next one back.
  let pushed = recordWiggle(run([[0, {}]]), 5_000);
  pushed = observeSilence(pushed, { ...quiet, tutorActive: true }, 7_000);
  pushed = observeSilence(pushed, quiet, 8_000);
  expect(wiggleDueAtMs(pushed)).toBe(13_000);
});

it("shows the flurry on the third clean round in a row, then starts the streak over", () => {
  const record = (book = STREAK_START, visits: [string, boolean][], session = "a") =>
    visits.reduce((current, [visit, missed]) => recordShowdownSuccess(current, session, visit, missed), book);
  let book = record(STREAK_START, [
    ["1", false],
    ["2", false],
  ]);
  expect(showsFlurry(book, "a", "2")).toBe(false);
  book = record(book, [["3", false]]);
  expect(showsFlurry(book, "a", "3")).toBe(true);
  expect(book.run).toBe(0);
  // Recording the same visit again changes nothing.
  expect(recordShowdownSuccess(book, "a", "3", false)).toBe(book);
  book = record(book, [
    ["4", false],
    ["5", false],
  ]);
  expect(showsFlurry(book, "a", "5")).toBe(false);
  book = record(book, [["6", false]]);
  expect(showsFlurry(book, "a", "6")).toBe(true);
});

it("resets the streak after a miss and on a new session", () => {
  const missed = [
    ["1", false],
    ["2", true],
    ["3", false],
    ["4", false],
  ].reduce((book, [visit, miss]) => recordShowdownSuccess(book, "a", visit as string, miss as boolean), STREAK_START);
  expect(["1", "2", "3", "4"].some(visit => showsFlurry(missed, "a", visit))).toBe(false);
  expect(missed.run).toBe(2);
  expect(showsFlurry(recordShowdownSuccess(missed, "a", "5", false), "a", "5")).toBe(true);

  // Stop then Play: a new runtime id starts from zero, so two more clean rounds are not a streak.
  let next = recordShowdownSuccess(missed, "b", "1", false);
  next = recordShowdownSuccess(next, "b", "2", false);
  expect(next.session).toBe("b");
  expect(showsFlurry(next, "b", "2")).toBe(false);
  expect(showsFlurry(recordShowdownSuccess(next, "b", "3", false), "b", "3")).toBe(true);
  expect(showsFlurry(next, "a", "4")).toBe(false);
});

it("fits the success sequence, flurry included, in the 2.5 s success hold", () => {
  const hold = lesson.successHoldMs!;
  expect(hold).toBe(2_500);
  const plain = successTimeline();
  expect(plain.flurryAtMs).toBeNull();
  expect(plain.danceMs).toBeLessThanOrEqual(700);
  expect(plain.starGoldAtMs - plain.starAtMs).toBe(1_000);
  expect(plain.starAtMs).toBeGreaterThanOrEqual(plain.danceMs - 100);
  expect(plain.endMs).toBeLessThanOrEqual(hold);
  const streak = successTimeline({ streak: true });
  expect(streak.flurryAtMs).not.toBeNull();
  expect(streak.endMs).toBeLessThanOrEqual(hold);
  expect(streak.endMs).toBeGreaterThanOrEqual(streak.flurryAtMs! + 1_400);
  // Reduced motion: the star turns gold in place, and there is no flurry.
  const still = successTimeline({ streak: true, reduced: true });
  expect(still.starGoldAtMs).toBe(still.starAtMs);
  expect(still.flurryAtMs).toBeNull();
  expect(still.endMs).toBeLessThanOrEqual(hold);
});

it("labels the colour with more", () => {
  expect(snowflakeShowdownSuccessLabel(node)).toBe("Blue has more!");
  expect(snowflakeShowdownSuccessLabel(lesson.nodes["showdown-4"])).toBe("Pink has more!");
});
