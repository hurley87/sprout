import { mulberry32, shuffle } from "./seeded-random";

export const CHRISTMAS_TREE_KINDS = ["bauble", "candy-cane", "gingerbread", "present"] as const;
export type ChristmasTreeKind = (typeof CHRISTMAS_TREE_KINDS)[number];

export const CHRISTMAS_TREE_SLOTS_PER_KIND = 6;
export const CHRISTMAS_TREE_SEED_MIN = 0;
export const CHRISTMAS_TREE_SEED_MAX = 99;

export type ChristmasTreeArrangement = {
  readonly seed: number;
  readonly counts: Readonly<Record<ChristmasTreeKind, number>>;
  readonly slots: Readonly<Record<ChristmasTreeKind, readonly number[]>>;
  readonly asked: readonly [ChristmasTreeKind, ChristmasTreeKind, ChristmasTreeKind];
  readonly omitted: ChristmasTreeKind;
};

export function isChristmasTreeSeed(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= CHRISTMAS_TREE_SEED_MIN &&
    value <= CHRISTMAS_TREE_SEED_MAX
  );
}

export function christmasTreeArrangement(seed: number): ChristmasTreeArrangement {
  if (!isChristmasTreeSeed(seed)) throw new RangeError("Christmas tree seed must be an integer from 0 to 99");

  const random = mulberry32(seed);
  const [bauble, candyCane, gingerbread, present] = shuffle([1, 2, 3, 4, 5], random);
  const counts = Object.freeze({ bauble, "candy-cane": candyCane, gingerbread, present });

  const [omitted, ...rounds] = shuffle(CHRISTMAS_TREE_KINDS, random);
  let [first, second, third] = rounds;
  if (counts[second] < counts[first]) [first, second] = [second, first];
  if (counts[third] < counts[first]) [first, third] = [third, first];
  const asked = Object.freeze([first, second, third] as const);

  const indices = Array.from({ length: CHRISTMAS_TREE_SLOTS_PER_KIND }, (_, index) => index);
  const pickSlots = (count: number) =>
    Object.freeze(
      shuffle(indices, random)
        .slice(0, count)
        .sort((a, b) => a - b),
    );
  const slots = Object.freeze({
    bauble: pickSlots(bauble),
    "candy-cane": pickSlots(candyCane),
    gingerbread: pickSlots(gingerbread),
    present: pickSlots(present),
  });

  return Object.freeze({ seed, counts, slots, asked, omitted });
}
