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

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled;
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
