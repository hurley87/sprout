import { describe, expect, it } from "vitest";
import {
  STOCKING_COLOURS,
  WHICH_STOCKING_ROUNDS,
  WHICH_STOCKING_SEED_MAX,
  WHICH_STOCKING_SEED_MIN,
  isWhichStockingSeed,
  whichStockingPlan,
  type WhichStockingRound,
} from "../lib/lesson-runtime/which-stocking-plan";

const seeds = Array.from(
  { length: WHICH_STOCKING_SEED_MAX - WHICH_STOCKING_SEED_MIN + 1 },
  (_, index) => WHICH_STOCKING_SEED_MIN + index,
);
const plans = seeds.map(whichStockingPlan);

const tierFor = (index: number) => (index < 3 ? "far" : index < 6 ? "any" : "close");
const colours = (round: WhichStockingRound) => round.stockings.map(stocking => stocking.colour);
const sortedCounts = (round: WhichStockingRound) =>
  round.stockings.map(stocking => stocking.count).sort((a, b) => a - b);
const answerPosition = (round: WhichStockingRound) => colours(round).indexOf(round.answer);

describe("Which Stocking plans", () => {
  it.each([-1, 100, 1.5, NaN, "3"])("rejects invalid seed %j", seed => {
    expect(isWhichStockingSeed(seed)).toBe(false);
    expect(() => whichStockingPlan(seed as number)).toThrow(RangeError);
  });

  it.each(seeds)("generates a deterministic, frozen, valid plan for seed %i", seed => {
    expect(isWhichStockingSeed(seed)).toBe(true);
    const plan = whichStockingPlan(seed);
    expect(plan).toEqual(whichStockingPlan(seed));
    expect(plan.seed).toBe(seed);
    expect(plan.rounds).toHaveLength(WHICH_STOCKING_ROUNDS);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.rounds)).toBe(true);

    plan.rounds.forEach((round, index) => {
      const tier = tierFor(index);
      expect(round.round).toBe(index + 1);
      expect(round.tier).toBe(tier);
      expect(round.stockings).toHaveLength(tier === "far" ? 2 : 3);
      expect(Object.isFrozen(round)).toBe(true);
      expect(Object.isFrozen(round.stockings)).toBe(true);
      round.stockings.forEach(stocking => expect(Object.isFrozen(stocking)).toBe(true));

      const counts = sortedCounts(round);
      for (const count of counts) {
        expect(Number.isInteger(count)).toBe(true);
        expect(count).toBeGreaterThanOrEqual(1);
        expect(count).toBeLessThanOrEqual(5);
      }
      expect(new Set(counts).size).toBe(counts.length);
      if (tier === "far") {
        expect(new Set(colours(round))).toEqual(new Set(["pink", "purple"]));
        expect(counts[1] - counts[0]).toBeGreaterThanOrEqual(3);
      } else {
        expect(new Set(colours(round))).toEqual(new Set(STOCKING_COLOURS));
      }
      if (tier === "close") expect(counts).toEqual([counts[0], counts[0] + 1, counts[0] + 2]);

      const matches = round.stockings.filter(stocking => stocking.count === round.target);
      expect(matches).toHaveLength(1);
      expect(round.answer).toBe(matches[0].colour);

      if (index > 0) {
        const previous = plan.rounds[index - 1];
        expect(round.target).not.toBe(previous.target);
        expect(colours(round)).not.toEqual(colours(previous));
      }
      if (index > 1) {
        const window = plan.rounds.slice(index - 2, index + 1);
        expect(new Set(window.map(r => r.answer)).size).toBeGreaterThan(1);
        expect(new Set(window.map(answerPosition)).size).toBeGreaterThan(1);
      }
    });
  });

  it("varies plans across seeds", () => {
    expect(new Set(plans.map(plan => JSON.stringify(plan.rounds))).size).toBeGreaterThan(1);
  });

  it("uses every allowed far pair and close triple", () => {
    const roundsOf = (tier: string) => plans.flatMap(plan => plan.rounds.filter(round => round.tier === tier));
    const shapes = (tier: string) => new Set(roundsOf(tier).map(round => sortedCounts(round).join("-")));
    expect(shapes("far")).toEqual(new Set(["1-4", "1-5", "2-5"]));
    expect(shapes("close")).toEqual(new Set(["1-2-3", "2-3-4", "3-4-5"]));
  });

  it("makes each colour the answer somewhere in every tier it appears in", () => {
    for (const tier of ["far", "any", "close"] as const) {
      const rounds = plans.flatMap(plan => plan.rounds.filter(round => round.tier === tier));
      const present = new Set(rounds.flatMap(colours));
      expect(new Set(rounds.map(round => round.answer))).toEqual(present);
    }
  });

  it("hangs exactly the configured colours from round 4 on", () => {
    for (const plan of plans) {
      for (const round of plan.rounds.slice(3))
        expect([...colours(round)].sort()).toEqual([...STOCKING_COLOURS].sort());
    }
  });
});
