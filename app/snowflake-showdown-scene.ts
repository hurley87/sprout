import {
  MITTEN_COLOURS,
  SNOWFLAKE_SLOTS_PER_MITTEN,
  type MittenColour,
} from "@/lib/lesson-runtime/snowflake-showdown-plan";

/** Placements are centred in the 1600 × 900 background coordinate space.
 * Render them in a scene layer with the same cover crop and alignment as the
 * background. Coordinates and widths are fractions of that layer's dimensions.
 *
 * Centre-safe band: background x 592–1008 is what a 390 × 844 portrait screen shows. Both mittens
 * with every palm slot and their cuffs, and the star row, sit inside it. The band holds only smooth
 * sky, one soft snow line and the two mitten shadows, so nothing countable sits near the palms. The
 * pines, the sun and the sled are landscape-only decoration.
 *
 * The snowman stands in the snow just below and outside the blue mitten. In portrait about his left
 * third (his outer arm and the edge of his body) falls outside the band; his face, hat, scarf and other
 * arm stay on screen. In landscape he is fully visible.
 *
 * Vertical strips: the lesson screen's status pill covers about the top 77 units on a phone and the
 * progress bar about the bottom 85, so the star row sits at y 101–135 and the mittens at y 225–525.
 *
 * Draw order, back to front: background, snowman, mittens, pairing lines, snowflakes, stars, flurry.
 */
const BACKGROUND_WIDTH = 1600;
const BACKGROUND_HEIGHT = 900;

export const BACKGROUND_ALIGNMENT = { landscape: 0.5, portrait: 0.5 } as const;

export const ASSET_VIEWBOXES = {
  "snowy-yard": [1600, 900],
  "mitten-blue": [200, 300],
  "mitten-pink": [200, 300],
  "mitten-blue-back": [200, 300],
  "mitten-pink-back": [200, 300],
  snowflake: [40, 40],
  snowman: [180, 220],
  "snowman-clap": [180, 220],
  "snowman-shrug": [180, 220],
  "snowman-dance": [180, 220],
  "star-pale": [72, 72],
  "star-gold": [72, 72],
  flurry: [320, 140],
} as const;
export type SnowflakeShowdownAsset = keyof typeof ASSET_VIEWBOXES;
export type MittenAsset = `mitten-${MittenColour}` | `mitten-${MittenColour}-back`;
export type SnowmanAsset = Extract<SnowflakeShowdownAsset, `snowman${string}`>;
export type SnowmanPose = "idle" | "clap" | "shrug" | "dance";

export type ScenePoint = { readonly x: number; readonly y: number };
export type SceneBox = { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number };
export type ScenePlacement = ScenePoint & { readonly width: number; readonly aspect: number };
export type AssetPlacement<A extends SnowflakeShowdownAsset = SnowflakeShowdownAsset> = ScenePlacement & {
  readonly asset: A;
};

/** The gold star is the Christmas Tree lesson's; everything else lives with this lesson. */
export function assetPath(asset: SnowflakeShowdownAsset): string {
  return asset === "star-gold" ? "/christmas-tree/star.svg" : `/snowflake-showdown/${asset}.svg`;
}

export function mittenAsset(colour: MittenColour, side: "palm" | "back"): MittenAsset {
  return side === "palm" ? `mitten-${colour}` : `mitten-${colour}-back`;
}

const SNOWMAN_ASSETS: Readonly<Record<SnowmanPose, SnowmanAsset>> = {
  idle: "snowman",
  clap: "snowman-clap",
  shrug: "snowman-shrug",
  dance: "snowman-dance",
};

export function snowmanAsset(pose: SnowmanPose): SnowmanAsset {
  return SNOWMAN_ASSETS[pose];
}

function sized(asset: SnowflakeShowdownAsset, x: number, y: number, width: number): ScenePlacement {
  const [w, h] = ASSET_VIEWBOXES[asset];
  return { x: x / BACKGROUND_WIDTH, y: y / BACKGROUND_HEIGHT, width: width / BACKGROUND_WIDTH, aspect: h / w };
}

function place<A extends SnowflakeShowdownAsset>(asset: A, x: number, y: number, width: number): AssetPlacement<A> {
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

// Mitten art, in its own 200 × 300 viewBox units (one unit = one background unit). The blue mitten is
// drawn with its thumb on the left and pink is its mirror image, so both thumbs point outward: the
// smooth inner edges face each other and the pairing lines cross a clear gap. The back sides share the
// outline, so a mitten keeps its footprint, cuff and shadow through the flip.
type MittenBox = { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number };
const MITTEN_WIDTH = 200;
const MITTEN_TOP = 225;
const MITTEN_LEFT: Readonly<Record<MittenColour, number>> = { blue: 595, pink: 805 };
/** Blue's palm: the plain, flat part of the hand inside the outline, clear of the curved top and wrist. */
const BLUE_PALM: MittenBox = { left: 38, right: 182, top: 58, bottom: 212 };
/** The cuff rectangle with its outline stroke. Its corners are rounded by MITTEN_CUFF_RADIUS. */
const BLUE_CUFF: MittenBox = { left: 31.5, right: 188.5, top: 217.5, bottom: 294.5 };
/** Everything the mitten paints, thumb tip to cuff, outline included. */
const BLUE_BOUNDS: MittenBox = { left: 5, right: 195, top: 5.5, bottom: 294.5 };

function mitten(colour: MittenColour, b: MittenBox): SceneBox {
  const left = MITTEN_LEFT[colour];
  const mirrored = colour === "pink";
  return box(
    left + (mirrored ? MITTEN_WIDTH - b.right : b.left),
    left + (mirrored ? MITTEN_WIDTH - b.left : b.right),
    MITTEN_TOP + b.top,
    MITTEN_TOP + b.bottom,
  );
}

function perMitten<T>(make: (colour: MittenColour) => T): Readonly<Record<MittenColour, T>> {
  return Object.fromEntries(MITTEN_COLOURS.map(colour => [colour, make(colour)])) as Record<MittenColour, T>;
}

/** Where each mitten SVG goes, palm side and back alike: blue on the left, pink on the right. */
export const MITTEN_PLACEMENTS = perMitten(colour =>
  sized(mittenAsset(colour, "palm"), MITTEN_LEFT[colour] + MITTEN_WIDTH / 2, MITTEN_TOP + 150, MITTEN_WIDTH),
);
/** The flat part of each palm. Every snowflake slot lies inside it. */
export const MITTEN_PALM = perMitten(colour => mitten(colour, BLUE_PALM));
/** Each cuff with its outline: lay the voice-cue glow over pink's. */
export const MITTEN_CUFF = perMitten(colour => mitten(colour, BLUE_CUFF));
/** The cuff's corner radius, as a fraction of the layer width. */
export const MITTEN_CUFF_RADIUS = 16.5 / BACKGROUND_WIDTH;
/** Everything each mitten paints, for wiggles and crop checks. */
export const MITTEN_BOUNDS = perMitten(colour => mitten(colour, BLUE_BOUNDS));

/** One snowflake's placement width. Every snowflake on both mittens is this size. */
const SNOWFLAKE_WIDTH = 38;
/** How much of snowflake.svg's 40-unit box the flake paints: tip to tip upright, and across. */
export const SNOWFLAKE_PAINTED = { height: 37.4 / 40, width: 33.24 / 40 } as const;

// Blue's nine slot centres in mitten units, row by row, left to right. A loose staggered grid: every
// slot is nudged off the grid so that no three line up (each sits at least 6 units off the segment
// joining any two it lies between), and partial sets read as scattered, not as rows or dice faces.
// Neighbours are at least 48 units apart on one axis, leaving 10 units between their 38-unit boxes.
// Pink uses the mirror image, renumbered in the same reading order.
const BLUE_SLOT_ROWS: readonly (readonly (readonly [number, number])[])[] = [
  [
    [57, 89],
    [105, 77],
    [158, 78],
  ],
  [
    [64, 137],
    [115, 138],
    [163, 126],
  ],
  [
    [57, 193],
    [105, 186],
    [154, 193],
  ],
];

function slotCentres(colour: MittenColour): readonly (readonly [number, number])[] {
  const left = MITTEN_LEFT[colour];
  return BLUE_SLOT_ROWS.flatMap(row =>
    colour === "pink"
      ? [...row].reverse().map(([x, y]) => [left + MITTEN_WIDTH - x, MITTEN_TOP + y] as const)
      : row.map(([x, y]) => [left + x, MITTEN_TOP + y] as const),
  );
}

/** Nine palm positions per mitten, indexed 0–8 in reading order to match snowflakeLayout's slots. */
export const SNOWFLAKE_SLOTS: Readonly<Record<MittenColour, readonly AssetPlacement<"snowflake">[]>> = perMitten(
  colour => slotCentres(colour).map(([x, y]) => place("snowflake", x, y, SNOWFLAKE_WIDTH)),
);

function checkedSlots(slotIndices: readonly number[]): readonly number[] {
  for (const index of slotIndices) {
    if (!Number.isInteger(index) || index < 0 || index >= SNOWFLAKE_SLOTS_PER_MITTEN)
      throw new RangeError(`snowflake slot must be an integer from 0 to ${SNOWFLAKE_SLOTS_PER_MITTEN - 1}`);
  }
  if (new Set(slotIndices).size !== slotIndices.length) throw new RangeError("snowflake slots must not repeat");
  return slotIndices;
}

/** The placements for a set of slot indices on one mitten, in the order given. */
export function snowflakePlacements(
  colour: MittenColour,
  slotIndices: readonly number[],
): readonly AssetPlacement<"snowflake">[] {
  return checkedSlots(slotIndices).map(index => SNOWFLAKE_SLOTS[colour][index]);
}

/** Below and outside the blue mitten, standing in the snow; poses swap in place. */
export const SNOWMAN_PLACEMENT = sized("snowman", 625, 660, 180);
export function snowmanPlacement(pose: SnowmanPose): AssetPlacement<SnowmanAsset> {
  return { asset: snowmanAsset(pose), ...SNOWMAN_PLACEMENT };
}

/** Ten star placements across the top strip, left to right; pale until earned, then gold. */
export const STAR_ROW: readonly ScenePlacement[] = Array.from({ length: 10 }, (_, i) =>
  sized("star-pale", 800 + (i - 4.5) * 40, 118, 34),
);

/** The streak gust crosses the open sky between the stars and the mittens, from off one edge to off
 * the other at every crop, so it never passes over the counted snowflakes. */
export const FLURRY_PATH = {
  from: place("flurry", -200, 180, 260),
  to: place("flurry", 1800, 180, 260),
} as const;

export type PairingLine = {
  readonly blue: number;
  readonly pink: number;
  /** The blue snowflake's centre. */
  readonly from: ScenePoint;
  /** The pink snowflake's centre. */
  readonly to: ScenePoint;
};
export type SnowflakePairing = {
  /** One line per pair, top to bottom by the blue end: draw them in this order, beneath the snowflakes. */
  readonly lines: readonly PairingLine[];
  /** The larger side's unpaired slots, which glow gold; null when the counts match. */
  readonly leftover: { readonly colour: MittenColour; readonly slots: readonly number[] } | null;
};

/** How close a pairing line may pass to another snowflake's centre before it counts as running
 * behind it: the painted radius plus a little air. */
const PASS_CLEARANCE = (SNOWFLAKE_WIDTH * SNOWFLAKE_PAINTED.height) / 2 + 2;

type Point = readonly [number, number];
type PairingCost = readonly [crossings: number, passes: number, length: number];

function cheaper(a: PairingCost, b: PairingCost): boolean {
  if (a[0] !== b[0]) return a[0] < b[0];
  if (a[1] !== b[1]) return a[1] < b[1];
  return a[2] < b[2] - 1e-9;
}

function turn(a: Point, b: Point, c: Point): number {
  return Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
}

/** True when two segments cross at a point inside both. */
export function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  return turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/**
 * Pairs snowflakes one from each mitten until the smaller side runs out, for the wrong-call help.
 *
 * Every way of giving each smaller-side snowflake a different larger-side partner is ranked by, in
 * order: crossing lines, then lines running behind another shown snowflake, then total line length. The
 * shortest matching never crosses (uncrossing two lines always shortens them), so the winner never has
 * crossing lines; among those it avoids running a line behind a third snowflake where the layout allows,
 * then keeps lines short, which leaves the leftovers on the far side of the larger mitten. Both sides
 * are searched top to bottom and ties keep the first matching found, so the result is deterministic.
 *
 * A line can still run behind a snowflake when no matching avoids it (say, three in one row on each
 * mitten), so draw the lines beneath the snowflakes.
 */
export function pairingLines(blueSlots: readonly number[], pinkSlots: readonly number[]): SnowflakePairing {
  const sideSlots = { blue: checkedSlots(blueSlots), pink: checkedSlots(pinkSlots) };
  const centre = (colour: MittenColour, index: number): ScenePoint => {
    const { x, y } = SNOWFLAKE_SLOTS[colour][index];
    return { x, y };
  };
  const units = (colour: MittenColour, index: number): Point => {
    const { x, y } = centre(colour, index);
    return [x * BACKGROUND_WIDTH, y * BACKGROUND_HEIGHT];
  };
  const topToBottom = (colour: MittenColour) =>
    [...sideSlots[colour]].sort((a, b) => {
      const [ax, ay] = units(colour, a);
      const [bx, by] = units(colour, b);
      return ay - by || ax - bx;
    });

  const smallColour: MittenColour = sideSlots.pink.length < sideSlots.blue.length ? "pink" : "blue";
  const largeColour: MittenColour = smallColour === "blue" ? "pink" : "blue";
  const small = topToBottom(smallColour).map(slot => units(smallColour, slot));
  const large = topToBottom(largeColour).map(slot => units(largeColour, slot));
  const smallSlots = topToBottom(smallColour);
  const largeSlots = topToBottom(largeColour);
  const everyFlake = [...small, ...large];

  const length = small.map(s => large.map(l => Math.hypot(l[0] - s[0], l[1] - s[1])));
  const passes = small.map(s =>
    large.map(l => everyFlake.filter(p => p !== s && p !== l && distanceToSegment(p, s, l) < PASS_CLEARANCE).length),
  );

  let best: { cost: PairingCost; partners: number[] } | undefined;
  const partners: number[] = [];
  const search = (i: number, used: number, cost: PairingCost) => {
    if (best && !cheaper(cost, best.cost)) return;
    if (i === small.length) {
      best = { cost, partners: [...partners] };
      return;
    }
    for (let j = 0; j < large.length; j++) {
      if (used & (1 << j)) continue;
      const crossings = partners.filter((k, h) => segmentsCross(small[h], large[k], small[i], large[j])).length;
      partners.push(j);
      search(i + 1, used | (1 << j), [cost[0] + crossings, cost[1] + passes[i][j], cost[2] + length[i][j]]);
      partners.pop();
    }
  };
  search(0, 0, [0, 0, 0]);
  const chosen = best?.partners ?? [];

  const lines = smallSlots
    .map((s, i) => {
      const l = largeSlots[chosen[i]];
      const blue = smallColour === "blue" ? s : l;
      const pink = smallColour === "blue" ? l : s;
      return { blue, pink, from: centre("blue", blue), to: centre("pink", pink) };
    })
    .sort((a, b) => a.from.y - b.from.y || a.from.x - b.from.x);
  const leftoverSlots = largeSlots.filter((_, j) => !chosen.includes(j)).sort((a, b) => a - b);
  return {
    lines,
    leftover: leftoverSlots.length ? { colour: largeColour, slots: leftoverSlots } : null,
  };
}
