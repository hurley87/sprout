import { describe, expect, it } from "vitest";
import {
  CHIMNEY_ASSISTED_INTERVAL_MS,
  CHIMNEY_FALL_MS,
  CHIMNEY_INITIAL_PACE,
  CHIMNEY_PACE_INTERVALS_MS,
  DOWN_THE_CHIMNEY_ROUNDS,
  chimneyDropSequenceMs,
  chimneyReplayIntervalMs,
  chimneyRoundIntervalMs,
  downTheChimneyPlan,
  isDownTheChimneySeed,
  nextChimneyPace,
} from "../lib/lesson-runtime/down-the-chimney-plan";

const seeds = Array.from({ length: 100 }, (_, index) => index);

describe("Down the Chimney plans", () => {
  it.each([-1, 100, 1.5, NaN, "3"])("rejects invalid seed %j", seed => {
    expect(isDownTheChimneySeed(seed)).toBe(false);
    expect(() => downTheChimneyPlan(seed as number)).toThrow(RangeError);
  });

  it.each(seeds)("generates a deterministic, frozen, valid plan for seed %i", seed => {
    expect(isDownTheChimneySeed(seed)).toBe(true);
    const plan = downTheChimneyPlan(seed);
    expect(plan).toEqual(downTheChimneyPlan(seed));
    expect(plan.seed).toBe(seed);
    expect(plan.rounds).toHaveLength(DOWN_THE_CHIMNEY_ROUNDS);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.rounds)).toBe(true);
    plan.rounds.forEach((round, index) => {
      const step = index < 2 ? 0 : index < 5 ? 1 : 2;
      expect(round.round).toBe(index + 1);
      expect(round.step).toBe(step);
      expect(Number.isInteger(round.count)).toBe(true);
      expect(round.count).toBeGreaterThanOrEqual(1);
      expect(round.count).toBeLessThanOrEqual(step + 3);
      if (index > 0) expect(round.count).not.toBe(plan.rounds[index - 1].count);
      expect(Object.isFrozen(round)).toBe(true);
    });
  });

  it("varies plans and includes every allowed count at each step", () => {
    const plans = seeds.map(downTheChimneyPlan);
    expect(new Set(plans.map(plan => JSON.stringify(plan.rounds))).size).toBeGreaterThan(1);
    for (const step of [0, 1, 2]) {
      const counts = plans.flatMap(plan => plan.rounds.filter(round => round.step === step).map(round => round.count));
      expect(new Set(counts)).toEqual(new Set(Array.from({ length: step + 3 }, (_, index) => index + 1)));
    }
  });
});

describe("Chimney pacing", () => {
  it("slows after a miss and restores the planned pace after two clean rounds", () => {
    const missed = nextChimneyPace(CHIMNEY_INITIAL_PACE, { missed: true });
    expect(missed).toEqual({ slowdown: 1, cleanStreak: 0 });
    expect(chimneyRoundIntervalMs(1, missed)).toBe(1500);
    const clean = nextChimneyPace(missed, { missed: false });
    expect(clean).toEqual({ slowdown: 1, cleanStreak: 1 });
    const restored = nextChimneyPace(clean, { missed: false });
    expect(restored).toEqual(CHIMNEY_INITIAL_PACE);
    expect(chimneyRoundIntervalMs(1, restored)).toBe(1200);
    expect(nextChimneyPace(clean, { missed: true })).toEqual({ slowdown: 2, cleanStreak: 0 });
  });

  it("clamps accumulated slowdown and the resulting interval", () => {
    let pace = CHIMNEY_INITIAL_PACE;
    for (let index = 0; index < 5; index++) pace = nextChimneyPace(pace, { missed: true });
    expect(pace).toEqual({ slowdown: 3, cleanStreak: 0 });
    for (const step of [0, 1, 2] as const) expect(chimneyRoundIntervalMs(step, pace)).toBe(1800);
  });

  it("keeps silence replays, slows first misses, and assists after further misses", () => {
    CHIMNEY_PACE_INTERVALS_MS.forEach((interval, index) => {
      expect(chimneyReplayIntervalMs(interval, 0)).toBe(interval);
      expect(chimneyReplayIntervalMs(interval, 1)).toBe(CHIMNEY_PACE_INTERVALS_MS[Math.max(0, index - 1)]);
      expect(chimneyReplayIntervalMs(interval, 2)).toBe(CHIMNEY_ASSISTED_INTERVAL_MS);
      expect(chimneyReplayIntervalMs(interval, 3)).toBe(CHIMNEY_ASSISTED_INTERVAL_MS);
    });
  });

  it("includes the final fall in the drop sequence duration", () => {
    expect(chimneyDropSequenceMs(1, 1500)).toBe(CHIMNEY_FALL_MS);
    expect(chimneyDropSequenceMs(5, 1200)).toBe(5300);
  });
});
