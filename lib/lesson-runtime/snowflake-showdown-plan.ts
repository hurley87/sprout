import { mulberry32 } from "./seeded-random";

export const SNOWFLAKE_SHOWDOWN_SEED_MIN = 0;
export const SNOWFLAKE_SHOWDOWN_SEED_MAX = 99;
export const SNOWFLAKE_SHOWDOWN_ROUNDS = 10;

/** Left to right on the stage: the snowman's blue mitten, then her pink one. */
export const MITTEN_COLOURS = ["blue", "pink"] as const;
export type MittenColour = (typeof MITTEN_COLOURS)[number];

/** Palm slots per mitten; the artwork defines their positions in this index order, never touching. */
export const SNOWFLAKE_SLOTS_PER_MITTEN = 9;

export type SnowflakeShowdownTier = "far" | "two" | "one";
export type SnowflakeShowdownRoundNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type SnowflakeShowdownRound = {
  readonly round: SnowflakeShowdownRoundNumber;
  readonly tier: SnowflakeShowdownTier;
  readonly counts: { readonly pink: number; readonly blue: number };
  readonly more: MittenColour;
  readonly gap: number;
};
export type SnowflakeShowdownPlan = { readonly seed: number; readonly rounds: readonly SnowflakeShowdownRound[] };

const MIN_COUNT = 1;
const MAX_COUNT = 6;
const MAX_SAME_SIDE_RUN = 2;
const MIN_ROUNDS_PER_SIDE = 4;
const MAX_ROUNDS_PER_SIDE = 6;

/** The amounts start far apart and move closer, so she judges at a glance first and has to count last. */
function tierFor(index: number): SnowflakeShowdownTier {
  return index < 3 ? "far" : index < 7 ? "two" : "one";
}

const fitsTier: Readonly<Record<SnowflakeShowdownTier, (gap: number) => boolean>> = {
  far: gap => gap >= 3,
  two: gap => gap === 2,
  one: gap => gap === 1,
};

type CountPair = readonly [low: number, high: number];

/** Every unordered (low, high) pair for a tier, in a fixed order so seeds stay stable. */
const PAIRS: Readonly<Record<SnowflakeShowdownTier, readonly CountPair[]>> = (() => {
  const all: CountPair[] = [];
  for (let low = MIN_COUNT; low <= MAX_COUNT; low++)
    for (let high = low + 1; high <= MAX_COUNT; high++) all.push([low, high]);
  return {
    far: all.filter(([low, high]) => fitsTier.far(high - low)),
    two: all.filter(([low, high]) => fitsTier.two(high - low)),
    one: all.filter(([low, high]) => fitsTier.one(high - low)),
  };
})();

/**
 * Every whole-game order of which mitten has more that obeys both side rules: at most two rounds running
 * on one side, and four to six rounds each. Built once from all 2^10 orders, in a fixed order.
 */
const MORE_SEQUENCES: readonly (readonly MittenColour[])[] = (() => {
  const sequences: MittenColour[][] = [];
  for (let bits = 0; bits < 2 ** SNOWFLAKE_SHOWDOWN_ROUNDS; bits++) {
    const sequence = Array.from(
      { length: SNOWFLAKE_SHOWDOWN_ROUNDS },
      (_, index) => MITTEN_COLOURS[(bits >> index) & 1],
    );
    const pinkRounds = sequence.filter(colour => colour === "pink").length;
    const balanced =
      pinkRounds >= MIN_ROUNDS_PER_SIDE &&
      pinkRounds <= MAX_ROUNDS_PER_SIDE &&
      SNOWFLAKE_SHOWDOWN_ROUNDS - pinkRounds >= MIN_ROUNDS_PER_SIDE &&
      SNOWFLAKE_SHOWDOWN_ROUNDS - pinkRounds <= MAX_ROUNDS_PER_SIDE;
    const shortRuns = sequence.every(
      (colour, index) =>
        index < MAX_SAME_SIDE_RUN ||
        sequence.slice(index - MAX_SAME_SIDE_RUN, index).some(earlier => earlier !== colour),
    );
    if (balanced && shortRuns) sequences.push(sequence);
  }
  return sequences;
})();

export function isSnowflakeShowdownSeed(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= SNOWFLAKE_SHOWDOWN_SEED_MIN &&
    value <= SNOWFLAKE_SHOWDOWN_SEED_MAX
  );
}

/**
 * The seed lets the server and browser independently reconstruct the same rounds.
 *
 * The side rules span the whole game, so a round-by-round pick could paint itself into a corner. Instead
 * one seeded draw picks the side order from MORE_SEQUENCES, which already holds only orders with four to
 * six rounds per side and no run of three; it is never empty (alternating sides qualifies). Then each
 * round draws its amounts from the tier's pairs, minus the previous round's pair. Each tier has at least
 * four pairs, and pairs from different tiers never match because their gaps differ, so a choice always
 * remains. There is no retry loop, so generation always finishes.
 */
export function snowflakeShowdownPlan(seed: number): SnowflakeShowdownPlan {
  if (!isSnowflakeShowdownSeed(seed)) throw new RangeError("Snowflake Showdown seed must be an integer from 0 to 99");

  const random = mulberry32(seed);
  const sides = MORE_SEQUENCES[Math.floor(random() * MORE_SEQUENCES.length)];
  const rounds: SnowflakeShowdownRound[] = [];
  let previousPair: CountPair | undefined;
  for (let index = 0; index < SNOWFLAKE_SHOWDOWN_ROUNDS; index++) {
    const tier = tierFor(index);
    const allowed = PAIRS[tier].filter(pair => pair !== previousPair);
    const pair = allowed[Math.floor(random() * allowed.length)];
    previousPair = pair;

    const [low, high] = pair;
    const more = sides[index];
    rounds.push(
      Object.freeze({
        round: (index + 1) as SnowflakeShowdownRoundNumber,
        tier,
        counts: Object.freeze(more === "pink" ? { pink: high, blue: low } : { pink: low, blue: high }),
        more,
        gap: high - low,
      }),
    );
  }
  return Object.freeze({ seed, rounds: Object.freeze(rounds) });
}

/** Keeps each (seed, round, colour) layout stream apart from the others; seeds stay below 2^7. */
const LAYOUT_SALT = 0x51f0_0000;

/**
 * Which palm slots hold the snowflakes on one mitten in one round, in ascending slot order.
 *
 * Only the stage uses this, to draw the snowflakes; the server needs just the counts, so the answer never
 * depends on where the snowflakes sit. Each round draws from its own generator seeded by (seed, round,
 * colour), never the plan's stream, so changing layouts can never change the counts.
 *
 * The draw lists every slot set of the right size and excludes the set this mitten showed the round
 * before, so a layout never repeats from one round to the next and she can't judge by the shape. With
 * at most six snowflakes on nine slots there are always other sets, so a choice always remains.
 */
export function snowflakeLayout(seed: number, round: number, colour: MittenColour): readonly number[] {
  const { rounds } = snowflakeShowdownPlan(seed);
  if (!Number.isInteger(round) || round < 1 || round > SNOWFLAKE_SHOWDOWN_ROUNDS)
    throw new RangeError("Snowflake Showdown round must be an integer from 1 to 10");
  const colourIndex = MITTEN_COLOURS.indexOf(colour);
  if (colourIndex < 0) throw new RangeError(`Unknown mitten colour: ${String(colour)}`);

  let previous: readonly number[] | undefined;
  for (let index = 0; index < round; index++) {
    const random = mulberry32(LAYOUT_SALT ^ (seed << 8) ^ ((index + 1) << 1) ^ colourIndex);
    const shown = previous;
    const allowed = slotSets(rounds[index].counts[colour]).filter(set => !sameSet(set, shown));
    previous = allowed[Math.floor(random() * allowed.length)];
  }
  return Object.freeze([...(previous ?? [])]);
}

const slotSetCache = new Map<number, readonly (readonly number[])[]>();

/** Every ascending set of `size` slot indices, in a fixed order so seeds stay stable. */
function slotSets(size: number): readonly (readonly number[])[] {
  let sets = slotSetCache.get(size);
  if (!sets) {
    const slots = Array.from({ length: SNOWFLAKE_SLOTS_PER_MITTEN }, (_, index) => index);
    sets = subsets(slots, size);
    slotSetCache.set(size, sets);
  }
  return sets;
}

function sameSet(a: readonly number[], b: readonly number[] | undefined): boolean {
  return b !== undefined && a.length === b.length && a.every((slot, index) => slot === b[index]);
}

function subsets<T>(values: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  return values.flatMap((value, index) => subsets(values.slice(index + 1), size - 1).map(rest => [value, ...rest]));
}
