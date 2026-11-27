import { mulberry32 } from "./seeded-random";

export const WHICH_STOCKING_SEED_MIN = 0;
export const WHICH_STOCKING_SEED_MAX = 99;
export const WHICH_STOCKING_ROUNDS = 8;

/**
 * The playtest checks that the child can name gold; if she cannot, change this to "blue".
 * Nothing else in the plan names a colour, so this is the only line to edit.
 */
export const THIRD_STOCKING_COLOUR = "gold";
export const STOCKING_COLOURS = ["pink", "purple", THIRD_STOCKING_COLOUR] as const;
export type StockingColour = (typeof STOCKING_COLOURS)[number];

export type WhichStockingTier = "far" | "any" | "close";
export type WhichStockingRoundNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type WhichStocking = { readonly colour: StockingColour; readonly count: number };
export type WhichStockingRound = {
  readonly round: WhichStockingRoundNumber;
  readonly tier: WhichStockingTier;
  /** Left to right along the mantel. */
  readonly stockings: readonly WhichStocking[];
  readonly target: number;
  readonly answer: StockingColour;
};
export type WhichStockingPlan = { readonly seed: number; readonly rounds: readonly WhichStockingRound[] };

const COUNTS = [1, 2, 3, 4, 5] as const;

/** Two stockings first, then three; the amounts move closer together as the rounds go on. */
const TIERS: Readonly<
  Record<WhichStockingTier, { colours: readonly StockingColour[]; countSets: readonly (readonly number[])[] }>
> = {
  far: {
    colours: STOCKING_COLOURS.slice(0, 2),
    countSets: subsets(COUNTS, 2).filter(([low, high]) => high - low >= 3),
  },
  any: { colours: STOCKING_COLOURS, countSets: subsets(COUNTS, 3) },
  close: {
    colours: STOCKING_COLOURS,
    countSets: subsets(COUNTS, 3).filter(([low, , high]) => high - low === 2),
  },
};

function tierFor(index: number): WhichStockingTier {
  return index < 3 ? "far" : index < 6 ? "any" : "close";
}

export function isWhichStockingSeed(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= WHICH_STOCKING_SEED_MIN &&
    value <= WHICH_STOCKING_SEED_MAX
  );
}

type Candidate = { stockings: readonly WhichStocking[]; target: number; answer: StockingColour; position: number };

/**
 * The seed lets the server and browser independently reconstruct the same rounds.
 *
 * Each round lists every possible layout for its tier (at most 1,080), keeps the ones that respect
 * the previous rounds, and picks one with the seeded random. There is no retry loop, so generation
 * always finishes. The kept list is never empty: with three stockings, the order is free and at most
 * one colour and one position are ruled out for the answer, so a choice remains. With two
 * stockings the order must swap every round, so the two rounds before can't have had the same answer
 * colour and also the same answer position, and only one of those limits applies at a time. Any
 * answer stocking can take a count other than the previous target.
 */
export function whichStockingPlan(seed: number): WhichStockingPlan {
  if (!isWhichStockingSeed(seed)) throw new RangeError("Which Stocking seed must be an integer from 0 to 99");

  const random = mulberry32(seed);
  const rounds: WhichStockingRound[] = [];
  const positions: number[] = [];
  for (let index = 0; index < WHICH_STOCKING_ROUNDS; index++) {
    const tier = tierFor(index);
    const previous = rounds.at(-1);
    const twoBack = rounds.at(-2);
    const repeatedAnswer = previous && twoBack && previous.answer === twoBack.answer ? previous.answer : undefined;
    const repeatedPosition =
      positions.length >= 2 && positions.at(-1) === positions.at(-2) ? positions.at(-1) : undefined;
    const previousOrder = previous?.stockings.map(stocking => stocking.colour).join();

    const allowed = candidatesFor(tier).filter(
      candidate =>
        candidate.target !== previous?.target &&
        candidate.answer !== repeatedAnswer &&
        candidate.position !== repeatedPosition &&
        candidate.stockings.map(stocking => stocking.colour).join() !== previousOrder,
    );
    if (allowed.length === 0) throw new Error(`No valid Which Stocking layout for round ${index + 1}`);

    const { stockings, target, answer, position } = allowed[Math.floor(random() * allowed.length)];
    positions.push(position);
    rounds.push(
      Object.freeze({
        round: (index + 1) as WhichStockingRoundNumber,
        tier,
        stockings: Object.freeze(stockings.map(stocking => Object.freeze({ ...stocking }))),
        target,
        answer,
      }),
    );
  }
  return Object.freeze({ seed, rounds: Object.freeze(rounds) });
}

/** Every colour order, count arrangement and target for a tier, in a fixed order so seeds stay stable. */
function candidatesFor(tier: WhichStockingTier): Candidate[] {
  const { colours, countSets } = TIERS[tier];
  const candidates: Candidate[] = [];
  for (const order of permutations(colours)) {
    for (const counts of countSets.flatMap(permutations)) {
      const stockings = order.map((colour, position) => ({ colour, count: counts[position] }));
      stockings.forEach(({ colour, count }, position) =>
        candidates.push({ stockings, target: count, answer: colour, position }),
      );
    }
  }
  return candidates;
}

function subsets<T>(values: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  return values.flatMap((value, index) => subsets(values.slice(index + 1), size - 1).map(rest => [value, ...rest]));
}

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length <= 1) return [[...values]];
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map(rest => [value, ...rest]),
  );
}
