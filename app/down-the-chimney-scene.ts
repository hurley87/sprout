/** Placements are centred in the 1600 × 900 background coordinate space.
 * Render them in a scene layer with the same cover crop and alignment as the
 * background. Coordinates and widths are fractions of that layer's dimensions.
 */
const BACKGROUND_WIDTH = 1600;
const BACKGROUND_HEIGHT = 900;

export const BACKGROUND_ALIGNMENT = { landscape: 0.5, portrait: 0.5 } as const;

export const ASSET_VIEWBOXES = {
  "night-house": [1600, 900],
  moon: [160, 160],
  santa: [180, 220],
  "santa-drop": [180, 220],
  "santa-dust": [180, 220],
  "santa-peer": [180, 220],
  "santa-wave": [180, 220],
  "chimney-back": [160, 180],
  "chimney-front": [160, 180],
  "snow-puff": [120, 70],
  "present-pink": [108, 86],
  "present-gold": [108, 86],
  "present-red": [108, 86],
  fireplace: [400, 250],
  fire: [400, 250],
  sleigh: [260, 90],
  tree: [800, 500],
  lights: [800, 500],
} as const;
export type ChimneyAsset = keyof typeof ASSET_VIEWBOXES;
export type PresentColour = "pink" | "gold" | "red";
export type ChimneyPlacement = {
  readonly asset: ChimneyAsset;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly aspect: number;
};

export function assetPath(asset: ChimneyAsset): string {
  const directory = asset === "tree" || asset === "lights" ? "christmas-tree" : "down-the-chimney";
  return `/${directory}/${asset}.svg`;
}

function place(asset: ChimneyAsset, x: number, y: number, width: number): ChimneyPlacement {
  const [w, h] = ASSET_VIEWBOXES[asset];
  return { asset, x: x / BACKGROUND_WIDTH, y: y / BACKGROUND_HEIGHT, width: width / BACKGROUND_WIDTH, aspect: h / w };
}

export const CHIMNEY_FIXED = {
  moon: place("moon", 970, 95, 115),
  santa: place("santa", 728, 175, 270),
  chimneyBack: place("chimney-back", 925, 263, 155),
  chimneyFront: place("chimney-front", 925, 263, 155),
  snowPuff: place("snow-puff", 925, 177, 105),
  fireplace: place("fireplace", 800, 650, 610),
  fire: place("fire", 800, 650, 610),
  // Keep the tree clear of the fireplace's right brick edge so the fifth present is uncluttered.
  tree: place("tree", 1250, 691, 480),
  lights: place("lights", 1250, 691, 480),
  sleighStart: place("sleigh", 770, 88, 120),
  sleighEnd: place("sleigh", 1080, 88, 120),
} as const;

export const CHIMNEY_DROP = {
  start: place("present-pink", 925, 110, 74),
  end: place("present-pink", 925, 297, 74),
} as const;

// Rectangular part of the fireplace opening, in background fractions.
export const HEARTH_OPENING = {
  left: 594.125 / 1600,
  right: 1005.875 / 1600,
  top: 682.025 / 900,
  bottom: 802.475 / 900,
} as const;

export function fireplaceRow(count: number): readonly ChimneyPlacement[] {
  if (!Number.isInteger(count) || count < 1 || count > 5) throw new RangeError("count must be an integer from 1 to 5");
  return Array.from({ length: count }, (_, i) => place("present-pink", 800 + (i - (count - 1) / 2) * 81, 762, 80));
}

export const PILE_SLOTS = Array.from({ length: 8 }, (_, i) =>
  place("present-pink", 1168 + (i % 4) * 55, 760 + Math.floor(i / 4) * 45, 50),
);

export function presentColour(round: number, index: number): PresentColour {
  const colours: readonly PresentColour[] = ["pink", "gold", "red"];
  return colours[(((round + index) % colours.length) + colours.length) % colours.length];
}
