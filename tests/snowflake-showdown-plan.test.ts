import { describe, expect, it } from "vitest";
import {
  MITTEN_COLOURS,
  SNOWFLAKE_SHOWDOWN_ROUNDS,
  SNOWFLAKE_SHOWDOWN_SEED_MAX,
  SNOWFLAKE_SHOWDOWN_SEED_MIN,
  SNOWFLAKE_SLOTS_PER_MITTEN,
  isSnowflakeShowdownSeed,
  snowflakeLayout,
  snowflakeShowdownPlan,
  type SnowflakeShowdownRound,
} from "../lib/lesson-runtime/snowflake-showdown-plan";

const seeds = Array.from(
  { length: SNOWFLAKE_SHOWDOWN_SEED_MAX - SNOWFLAKE_SHOWDOWN_SEED_MIN + 1 },
  (_, index) => SNOWFLAKE_SHOWDOWN_SEED_MIN + index,
);
const plans = seeds.map(snowflakeShowdownPlan);
const roundNumbers = Array.from({ length: SNOWFLAKE_SHOWDOWN_ROUNDS }, (_, index) => index + 1);

const tierFor = (index: number) => (index < 3 ? "far" : index < 7 ? "two" : "one");
const pairOf = (round: SnowflakeShowdownRound) =>
  [round.counts.pink, round.counts.blue].sort((a, b) => a - b).join("-");

describe("Snowflake Showdown plans", () => {
  it("orders the mittens blue then pink, left to right", () => {
    expect(MITTEN_COLOURS).toEqual(["blue", "pink"]);
  });

  it.each([-1, 100, 1.5, NaN, "3"])("rejects invalid seed %j", seed => {
    expect(isSnowflakeShowdownSeed(seed)).toBe(false);
    expect(() => snowflakeShowdownPlan(seed as number)).toThrow(RangeError);
    expect(() => snowflakeLayout(seed as number, 1, "pink")).toThrow(RangeError);
  });

  it.each(seeds)("generates a deterministic, frozen, valid plan for seed %i", seed => {
    expect(isSnowflakeShowdownSeed(seed)).toBe(true);
    const plan = snowflakeShowdownPlan(seed);
    expect(plan).toEqual(snowflakeShowdownPlan(seed));
    expect(plan.seed).toBe(seed);
    expect(plan.rounds).toHaveLength(SNOWFLAKE_SHOWDOWN_ROUNDS);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.rounds)).toBe(true);

    plan.rounds.forEach((round, index) => {
      const tier = tierFor(index);
      const { pink, blue } = round.counts;
      expect(round.round).toBe(index + 1);
      expect(round.tier).toBe(tier);
      expect(Object.isFrozen(round)).toBe(true);
      expect(Object.isFrozen(round.counts)).toBe(true);

      for (const count of [pink, blue]) {
        expect(Number.isInteger(count)).toBe(true);
        expect(count).toBeGreaterThanOrEqual(1);
        expect(count).toBeLessThanOrEqual(6);
      }
      expect(pink).not.toBe(blue);
      expect(round.more).toBe(pink > blue ? "pink" : "blue");
      expect(round.gap).toBe(Math.abs(pink - blue));
      if (tier === "far") expect(round.gap).toBeGreaterThanOrEqual(3);
      if (tier === "two") expect(round.gap).toBe(2);
      if (tier === "one") expect(round.gap).toBe(1);

      if (index > 0) expect(pairOf(round)).not.toBe(pairOf(plan.rounds[index - 1]));
      if (index > 1) {
        const window = plan.rounds.slice(index - 2, index + 1);
        expect(new Set(window.map(r => r.more)).size).toBe(2);
      }
    });

    for (const colour of MITTEN_COLOURS) {
      const wins = plan.rounds.filter(round => round.more === colour).length;
      expect(wins).toBeGreaterThanOrEqual(4);
      expect(wins).toBeLessThanOrEqual(6);
    }
  });

  it("varies plans across seeds", () => {
    expect(new Set(plans.map(plan => JSON.stringify(plan.rounds))).size).toBeGreaterThan(1);
  });

  it("uses every allowed pair in each tier", () => {
    const pairs = (tier: string) =>
      new Set(plans.flatMap(plan => plan.rounds.filter(round => round.tier === tier).map(pairOf)));
    expect(pairs("far")).toEqual(new Set(["1-4", "1-5", "1-6", "2-5", "2-6", "3-6"]));
    expect(pairs("two")).toEqual(new Set(["1-3", "2-4", "3-5", "4-6"]));
    expect(pairs("one")).toEqual(new Set(["1-2", "2-3", "3-4", "4-5", "5-6"]));
  });

  it("gives each side more somewhere in every tier", () => {
    for (const tier of ["far", "two", "one"] as const) {
      const rounds = plans.flatMap(plan => plan.rounds.filter(round => round.tier === tier));
      expect(new Set(rounds.map(round => round.more))).toEqual(new Set(MITTEN_COLOURS));
    }
  });
});

describe("snowflakeLayout", () => {
  it.each(seeds)("picks distinct, in-range, deterministic slots for seed %i", seed => {
    const plan = snowflakeShowdownPlan(seed);
    for (const colour of MITTEN_COLOURS) {
      let previous: readonly number[] | undefined;
      for (const round of plan.rounds) {
        const count = round.counts[colour];
        const layout = snowflakeLayout(seed, round.round, colour);
        expect(layout).toHaveLength(count);
        expect(new Set(layout).size).toBe(count);
        for (const slot of layout) {
          expect(Number.isInteger(slot)).toBe(true);
          expect(slot).toBeGreaterThanOrEqual(0);
          expect(slot).toBeLessThan(SNOWFLAKE_SLOTS_PER_MITTEN);
        }
        expect(layout).toEqual(snowflakeLayout(seed, round.round, colour));
        expect(Object.isFrozen(layout)).toBe(true);
        if (previous && count < SNOWFLAKE_SLOTS_PER_MITTEN) expect(layout).not.toEqual(previous);
        previous = layout;
      }
    }
  });

  it("never touches the plan's random stream", () => {
    const before = plans.map(plan => JSON.stringify(plan));
    for (const seed of seeds)
      for (const round of roundNumbers) for (const colour of MITTEN_COLOURS) snowflakeLayout(seed, round, colour);
    expect(seeds.map(seed => JSON.stringify(snowflakeShowdownPlan(seed)))).toEqual(before);
  });

  it("gives the same layout whatever order rounds are asked for", () => {
    const forwards = roundNumbers.map(round => snowflakeLayout(7, round, "blue"));
    const backwards = [...roundNumbers].reverse().map(round => snowflakeLayout(7, round, "blue"));
    expect(backwards.reverse()).toEqual(forwards);
  });

  it("varies layouts across seeds", () => {
    const layouts = new Set(seeds.map(seed => snowflakeLayout(seed, 1, "pink").join()));
    expect(layouts.size).toBeGreaterThan(1);
  });

  it.each([0, 11, 1.5, NaN])("rejects invalid round %j", round => {
    expect(() => snowflakeLayout(0, round, "pink")).toThrow(RangeError);
  });

  it("rejects an unknown colour", () => {
    expect(() => snowflakeLayout(0, 1, "green" as never)).toThrow(RangeError);
  });
});
