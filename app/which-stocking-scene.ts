import type { StockingColour } from "@/lib/lesson-runtime/which-stocking-plan";

/** Placements are centred in the 1600 × 900 background coordinate space.
 * Render them in a scene layer with the same cover crop and alignment as the
 * background. Coordinates and widths are fractions of that layer's dimensions.
 *
 * Centre-safe band: background x 592–1008 is what a 390 × 844 portrait screen shows. The mantel,
 * every stocking with its fullest cane fan, the firebox and the hearth sit inside it. The window
 * (left) and the toy pile (right) are landscape-only decoration.
 *
 * Draw order, back to front: background, fire, candy canes, stockings, toys. Each stocking's cuff
 * hides the bottom of its canes, so the canes look as if they poke out of the stocking.
 */
const BACKGROUND_WIDTH = 1600;
const BACKGROUND_HEIGHT = 900;

export const BACKGROUND_ALIGNMENT = { landscape: 0.5, portrait: 0.5 } as const;

export const ASSET_VIEWBOXES = {
  "living-room": [1600, 900],
  fire: [240, 200],
  "stocking-pink": [120, 190],
  "stocking-purple": [120, 190],
  "stocking-gold": [120, 190],
  "stocking-blue": [120, 190],
  "candy-cane": [22, 71],
  snow: [32, 32],
  "toy-teddy": [100, 90],
  "toy-drum": [100, 90],
  "toy-ball": [100, 90],
  "toy-train": [100, 90],
  "toy-rocking-horse": [100, 90],
  "toy-blocks": [100, 90],
  "toy-spinning-top": [100, 90],
  "toy-boat": [100, 90],
} as const;
export type WhichStockingAsset = keyof typeof ASSET_VIEWBOXES;

/** Pink, purple and gold are what the plan uses today; blue is ready if the third colour changes. */
export type StockingArtColour = "pink" | "purple" | "gold" | "blue";
export type StockingAsset = `stocking-${StockingArtColour}`;
export type ToyAsset = Extract<WhichStockingAsset, `toy-${string}`>;

export type SceneBox = { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number };
export type ScenePlacement = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly aspect: number;
};
export type AssetPlacement<A extends WhichStockingAsset = WhichStockingAsset> = ScenePlacement & { readonly asset: A };
/** `rotation` is in degrees, clockwise, about the placement centre. */
export type CanePlacement = AssetPlacement<"candy-cane"> & { readonly rotation: number };
export type StockingSlot = {
  /** Where the stocking SVG goes; the same for every colour. */
  readonly stocking: ScenePlacement;
  /** The painted stocking from the top of the cuff to the toe, without the hanging loop. */
  readonly body: SceneBox;
  /** The white cuff. Canes rise from its top edge and their ends hide behind it. */
  readonly cuff: SceneBox;
  /** The hanging loop above the cuff. It is drawn in front of the canes, so they keep clear of it. */
  readonly loop: SceneBox;
};

export function assetPath(asset: WhichStockingAsset): string {
  const directory = asset === "snow" ? "christmas-tree" : "which-stocking";
  return `/${directory}/${asset}.svg`;
}

function sized(asset: WhichStockingAsset, x: number, y: number, width: number): ScenePlacement {
  const [w, h] = ASSET_VIEWBOXES[asset];
  return { x: x / BACKGROUND_WIDTH, y: y / BACKGROUND_HEIGHT, width: width / BACKGROUND_WIDTH, aspect: h / w };
}

function place<A extends WhichStockingAsset>(asset: A, x: number, y: number, width: number): AssetPlacement<A> {
  return { asset, ...sized(asset, x, y, width) };
}

function box(left: number, right: number, top: number, bottom: number): SceneBox {
  return {
    left: left / BACKGROUND_WIDTH,
    right: right / BACKGROUND_WIDTH,
    top: top / BACKGROUND_HEIGHT,
    bottom: bottom / BACKGROUND_HEIGHT,
  };
}

export const WHICH_STOCKING_FIXED = {
  fire: place("fire", 800, 680, 240),
  /** Brighten or wash light over this region for the voice cue; it covers the firebox and hearth. */
  glow: box(660, 940, 560, 800),
  /** The window glass, for the finale snowfall. */
  windowSnow: box(252, 484, 168, 430),
  /** The shelf top to the frieze's lower edge, where the stockings hang. */
  mantel: box(594, 1006, 268, 362),
  /** The plain board under the shelf: the canes stand against it, clear of the shelf and the brick. */
  frieze: box(600, 1000, 294.5, 362),
} as const;

/** Rectangular part of the firebox opening, below its arch. */
export const HEARTH_OPENING = box(700, 900, 634, 772);
/** The firebox surround and hearth slab, kept clear of the stockings and the toy pile. */
export const HEARTH = box(574, 1026, 534, 800);

// Stocking art, in its own 120 × 190 viewBox units (one unit = one background unit).
const STOCKING_WIDTH = 120;
const CUFF_CENTRE_X = 60;
const CUFF = { left: 14, right: 106, top: 20, bottom: 50 } as const;
const LOOP = { left: 1, right: 17, top: 5.75 } as const;
const TOE = { right: 119, bottom: 186 } as const;
/** The cuff's top edge lies 10 units over the frieze's lower edge, as if hung from it. */
const CUFF_TOP_Y = 352;
const SLOT_XS = { 2: [708, 892], 3: [666, 800, 934] } as const;

export function stockingSlots(count: 2 | 3): readonly StockingSlot[] {
  if (count !== 2 && count !== 3) throw new RangeError("stocking count must be 2 or 3");
  const top = CUFF_TOP_Y - CUFF.top;
  const height = STOCKING_WIDTH * sized("stocking-pink", 0, 0, 1).aspect;
  return SLOT_XS[count].map(cx => {
    const left = cx - CUFF_CENTRE_X;
    return {
      stocking: sized("stocking-pink", cx, top + height / 2, STOCKING_WIDTH),
      body: box(left + CUFF.left, left + TOE.right, CUFF_TOP_Y, top + TOE.bottom),
      cuff: box(left + CUFF.left, left + CUFF.right, CUFF_TOP_Y, top + CUFF.bottom),
      loop: box(left + LOOP.left, left + LOOP.right, top + LOOP.top, CUFF_TOP_Y),
    };
  });
}

/** Conservative convex outlines that cover everything candy-cane.svg paints, in its viewBox units:
 * the hook (with the tail) and the straight shaft. Use them to check that canes stay apart.
 */
export const CANE_OUTLINE: readonly (readonly (readonly [number, number])[])[] = [
  [
    [1, 17.46],
    [1, 6.86],
    [6.86, 1],
    [15.14, 1],
    [21, 6.86],
    [21, 19.8],
    [3.34, 19.8],
  ],
  [
    [13, 11],
    [21, 11],
    [21, 67.66],
    [18.66, 70],
    [15.34, 70],
    [13, 67.66],
  ],
];
/** The bottom of the shaft, which the fan tables position; the hook's top is at viewBox y = 1. */
export const CANE_PIVOT = [17, 66] as const;
const CANE_WIDTH = 22;
/** How far below the cuff's top edge the shaft ends, before any extra drop. */
const CANE_TUCK = 9;

// Per count: [x offset of the shaft bottom from the cuff centre, extra drop below the tuck, rotation].
// Every hook curls left, which lets the canes sit closest; the outer pair drops lower in big fans so
// their hooks pass beside, not into, their neighbours'.
const CANE_FANS: Readonly<Record<1 | 2 | 3 | 4 | 5, readonly (readonly [number, number, number])[]>> = {
  1: [[6, 0, 0]],
  2: [
    [-2.5, 2, -8],
    [14, 2, 8],
  ],
  3: [
    [-9, 4, -16],
    [6, 0, 0],
    [21, 4, 16],
  ],
  4: [
    [-14.5, 8, -21],
    [-2, 0, -7],
    [12.5, 0, 7],
    [25.5, 8, 21],
  ],
  5: [
    [-19.5, 8, -28],
    [-8.5, 0, -14],
    [5, 0, 0],
    [18.5, 0, 14],
    [30, 8, 28],
  ],
};

export function caneFan(slot: StockingSlot, count: number): readonly CanePlacement[] {
  if (!Number.isInteger(count) || count < 1 || count > 5) throw new RangeError("count must be an integer from 1 to 5");
  const cuffX = ((slot.cuff.left + slot.cuff.right) / 2) * BACKGROUND_WIDTH;
  const cuffTop = slot.cuff.top * BACKGROUND_HEIGHT;
  const [w, h] = ASSET_VIEWBOXES["candy-cane"];
  const pivotX = CANE_PIVOT[0] - w / 2;
  const pivotY = CANE_PIVOT[1] - h / 2;
  return CANE_FANS[count as keyof typeof CANE_FANS].map(([dx, drop, rotation]) => {
    const angle = (rotation * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const x = cuffX + dx - (pivotX * cos - pivotY * sin);
    const y = cuffTop + CANE_TUCK + drop - (pivotX * sin + pivotY * cos);
    return { ...place("candy-cane", x, y, CANE_WIDTH), rotation };
  });
}

const STOCKING_ASSETS: Readonly<Record<StockingArtColour, StockingAsset>> = {
  pink: "stocking-pink",
  purple: "stocking-purple",
  gold: "stocking-gold",
  blue: "stocking-blue",
};

export function stockingColourAsset(colour: StockingColour | StockingArtColour): StockingAsset {
  return STOCKING_ASSETS[colour];
}

/** One toy joins the pile per round, in this order. */
export const TOY_ASSETS: readonly ToyAsset[] = [
  "toy-teddy",
  "toy-drum",
  "toy-ball",
  "toy-train",
  "toy-rocking-horse",
  "toy-blocks",
  "toy-spinning-top",
  "toy-boat",
];

/** Bottom row of four on the floor, three stacked on them, one on top. Fill in order. */
export const TOY_PILE_SLOTS: readonly ScenePlacement[] = [
  [1078, 836],
  [1150, 836],
  [1222, 836],
  [1294, 836],
  [1114, 772],
  [1186, 772],
  [1258, 772],
  [1186, 708],
].map(([x, y]) => sized("toy-teddy", x, y, 70));
