import {
  CHRISTMAS_TREE_KINDS,
  type ChristmasTreeArrangement,
  type ChristmasTreeKind,
} from "@/lib/lesson-runtime/christmas-tree-arrangement";

const BOX_WIDTH = 800;
const BOX_HEIGHT = 500;

const assetAspects = {
  "bauble-pink": 82 / 72,
  "bauble-gold": 82 / 72,
  "bauble-purple": 82 / 72,
  "candy-cane": 82 / 72,
  gingerbread: 82 / 76,
  "present-pink": 86 / 108,
  "present-gold": 86 / 108,
  tree: BOX_HEIGHT / BOX_WIDTH,
  star: 1,
  lights: BOX_HEIGHT / BOX_WIDTH,
} as const;

type ChristmasTreeAsset = keyof typeof assetAspects;

export type ChristmasTreePlacement = {
  readonly asset: ChristmasTreeAsset;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly aspect: number;
};

// Author centres and widths in the same coordinates as tree.svg.
function place(asset: ChristmasTreeAsset, x: number, y: number, width: number): ChristmasTreePlacement {
  return { asset, x: x / BOX_WIDTH, y: y / BOX_HEIGHT, width: width / BOX_WIDTH, aspect: assetAspects[asset] };
}

function present(asset: "present-pink" | "present-gold", x: number, width: number): ChristmasTreePlacement {
  return place(asset, x, 483 - (width * assetAspects[asset]) / 2, width);
}

type SixPlacements = readonly [
  ChristmasTreePlacement,
  ChristmasTreePlacement,
  ChristmasTreePlacement,
  ChristmasTreePlacement,
  ChristmasTreePlacement,
  ChristmasTreePlacement,
];

export const CHRISTMAS_TREE_SLOTS: Readonly<Record<ChristmasTreeKind, SixPlacements>> = {
  bauble: [
    place("bauble-pink", 400, 119, 62),
    place("bauble-purple", 248, 199, 62),
    place("bauble-gold", 552, 198, 62),
    place("bauble-purple", 400, 278, 64),
    place("bauble-pink", 221, 357, 62),
    place("bauble-gold", 465, 359, 64),
  ],
  "candy-cane": [
    place("candy-cane", 321, 117, 62),
    place("candy-cane", 450, 199, 60),
    place("candy-cane", 292, 280, 62),
    place("candy-cane", 615, 279, 61),
    place("candy-cane", 107, 359, 61),
    place("candy-cane", 579, 359, 60),
  ],
  gingerbread: [
    place("gingerbread", 480, 117, 66),
    place("gingerbread", 346, 198, 64),
    place("gingerbread", 179, 279, 66),
    place("gingerbread", 507, 280, 64),
    place("gingerbread", 335, 358, 66),
    place("gingerbread", 690, 358, 64),
  ],
  present: [
    present("present-pink", 109, 88),
    present("present-gold", 225, 98),
    present("present-pink", 341, 83),
    present("present-gold", 459, 90),
    present("present-pink", 575, 96),
    present("present-gold", 691, 85),
  ],
};

export const CHRISTMAS_TREE_FIXED = {
  tree: place("tree", 400, 250, BOX_WIDTH),
  star: place("star", 400, 42, 64),
  lights: place("lights", 400, 250, BOX_WIDTH),
} as const;

export const CHRISTMAS_TREE_ICONS: Readonly<Record<ChristmasTreeKind, ChristmasTreeAsset>> = {
  bauble: "bauble-pink",
  "candy-cane": "candy-cane",
  gingerbread: "gingerbread",
  present: "present-pink",
};

export function christmasTreePlacements(arrangement: ChristmasTreeArrangement) {
  return CHRISTMAS_TREE_KINDS.flatMap(kind =>
    arrangement.slots[kind].map(slot => ({ kind, slot, placement: CHRISTMAS_TREE_SLOTS[kind][slot] })),
  );
}
