import { describe, expect, it } from "vitest";
import {
  CHRISTMAS_TREE_KINDS,
  CHRISTMAS_TREE_SEED_MAX,
  CHRISTMAS_TREE_SEED_MIN,
  CHRISTMAS_TREE_SLOTS_PER_KIND,
  christmasTreeArrangement,
  isChristmasTreeSeed,
} from "../lib/lesson-runtime/christmas-tree-arrangement";

const seeds = Array.from(
  { length: CHRISTMAS_TREE_SEED_MAX - CHRISTMAS_TREE_SEED_MIN + 1 },
  (_, index) => CHRISTMAS_TREE_SEED_MIN + index,
);

describe("Christmas tree arrangements", () => {
  it.each(seeds)("generates a deterministic, valid arrangement for seed %i", seed => {
    expect(isChristmasTreeSeed(seed)).toBe(true);
    const arrangement = christmasTreeArrangement(seed);
    expect(arrangement).toEqual(christmasTreeArrangement(seed));
    expect(arrangement.seed).toBe(seed);

    const { counts, slots, asked, omitted } = arrangement;
    expect(new Set(Object.values(counts)).size).toBe(CHRISTMAS_TREE_KINDS.length);
    expect(asked).toHaveLength(3);
    expect(new Set([...asked, omitted])).toEqual(new Set(CHRISTMAS_TREE_KINDS));
    expect(counts[asked[0]]).toBe(Math.min(...asked.map(kind => counts[kind])));

    for (const kind of CHRISTMAS_TREE_KINDS) {
      const count = counts[kind];
      expect(Number.isInteger(count)).toBe(true);
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(5);

      const indices = slots[kind];
      expect(indices).toHaveLength(count);
      expect(new Set(indices).size).toBe(count);
      expect(indices).toEqual([...indices].sort((a, b) => a - b));
      for (const index of indices) {
        expect(Number.isInteger(index)).toBe(true);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(CHRISTMAS_TREE_SLOTS_PER_KIND);
      }
    }
  });

  it.each([-1, 100, 1.5, NaN, "3"])("rejects invalid seed %j", seed => {
    expect(isChristmasTreeSeed(seed)).toBe(false);
    expect(() => christmasTreeArrangement(seed as number)).toThrow(RangeError);
  });

  it("varies the arrangements, omitted kinds and first rounds across seeds", () => {
    const arrangements = seeds.map(christmasTreeArrangement);
    const trees = arrangements.map(({ counts, slots }) => JSON.stringify({ counts, slots }));
    expect(new Set(trees).size).toBeGreaterThan(1);
    expect(new Set(arrangements.map(({ omitted }) => omitted))).toEqual(new Set(CHRISTMAS_TREE_KINDS));
    expect(new Set(arrangements.map(({ asked }) => asked[0]))).toEqual(new Set(CHRISTMAS_TREE_KINDS));
  });

  it("freezes the arrangement and its nested data", () => {
    const arrangement = christmasTreeArrangement(CHRISTMAS_TREE_SEED_MIN);
    const { counts, slots, asked } = arrangement;
    for (const value of [arrangement, counts, slots, asked, ...Object.values(slots)]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });
});
