// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MITTEN_COLOURS,
  SNOWFLAKE_SHOWDOWN_ROUNDS,
  SNOWFLAKE_SHOWDOWN_SEED_MAX,
  SNOWFLAKE_SHOWDOWN_SEED_MIN,
  SNOWFLAKE_SLOTS_PER_MITTEN,
  snowflakeLayout,
  type MittenColour,
} from "../lib/lesson-runtime/snowflake-showdown-plan";
import {
  ASSET_VIEWBOXES,
  assetPath,
  BACKGROUND_ALIGNMENT,
  FLURRY_PATH,
  MITTEN_BOUNDS,
  MITTEN_CUFF,
  MITTEN_PALM,
  MITTEN_PLACEMENTS,
  mittenAsset,
  pairingLines,
  segmentsCross,
  SNOWFLAKE_PAINTED,
  SNOWFLAKE_SLOTS,
  snowflakePlacements,
  SNOWMAN_PLACEMENT,
  snowmanAsset,
  snowmanPlacement,
  STAR_ROW,
  type SceneBox,
  type ScenePlacement,
  type SnowflakeShowdownAsset,
} from "../app/snowflake-showdown-scene";

// Work in background units (1600 × 900) so distances convert to pixels with a single scale.
type Rect = { left: number; right: number; top: number; bottom: number };
type Point = readonly [number, number];
const W = 1600;
const H = 900;

function units(b: SceneBox): Rect {
  return { left: b.left * W, right: b.right * W, top: b.top * H, bottom: b.bottom * H };
}
function rect(p: ScenePlacement): Rect {
  const width = p.width * W;
  const height = width * p.aspect;
  return {
    left: p.x * W - width / 2,
    right: p.x * W + width / 2,
    top: p.y * H - height / 2,
    bottom: p.y * H + height / 2,
  };
}
const centre = (p: ScenePlacement): Point => [p.x * W, p.y * H];
const inside = (inner: Rect, outer: Rect) =>
  inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom;
const apart = (a: Rect, b: Rect) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
/** Space between two boxes along the axis that separates them; negative when they overlap. */
function boxGap(a: Rect, b: Rect) {
  return Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom);
}
/** The flake's painted size in background units: tip to tip upright, and its narrower width across. */
function painted(p: ScenePlacement) {
  return { height: p.width * W * SNOWFLAKE_PAINTED.height, width: p.width * W * SNOWFLAKE_PAINTED.width };
}
/** Space between the painted flakes: every arm tip lies on a circle of the tip-to-tip diameter. */
function flakeGap(a: ScenePlacement, b: ScenePlacement) {
  const [ax, ay] = centre(a);
  const [bx, by] = centre(b);
  return Math.hypot(ax - bx, ay - by) - (painted(a).height + painted(b).height) / 2;
}

/** The visible part of the background at a viewport size: the stage crops it like CSS cover, bottom-aligned. */
function crop(width: number, height: number) {
  const alignment = width > height ? BACKGROUND_ALIGNMENT.landscape : BACKGROUND_ALIGNMENT.portrait;
  const scale = Math.max(width / W, height / H);
  const left = ((W * scale - width) * alignment) / scale;
  const top = (H * scale - height) / scale;
  return { scale, left, right: left + width / scale, top, bottom: H };
}
const SCREENS = [
  [1440, 800],
  [390, 844],
] as const;
const PORTRAIT = crop(390, 844);
const PORTRAIT_BAND: Rect = { left: PORTRAIT.left, right: PORTRAIT.right, top: 0, bottom: H };
/** The lesson screen's status pill (4.5rem) and progress bar (5rem) overlay the scene at the top and bottom. */
const PILL_PX = 72;
const PROGRESS_PX = 80;

function subsets(size: number, from = 0): number[][] {
  if (size === 0) return [[]];
  const sets: number[][] = [];
  for (let i = from; i < SNOWFLAKE_SLOTS_PER_MITTEN; i++)
    for (const rest of subsets(size - 1, i + 1)) sets.push([i, ...rest]);
  return sets;
}
const COUNTS = [1, 2, 3, 4, 5, 6] as const;

function lineSegments(blue: readonly number[], pink: readonly number[]): [Point, Point][] {
  return pairingLines(blue, pink).lines.map(line => [
    [line.from.x * W, line.from.y * H],
    [line.to.x * W, line.to.y * H],
  ]);
}
function crossings(segments: readonly [Point, Point][]) {
  let count = 0;
  for (let i = 0; i < segments.length; i++)
    for (let j = 0; j < i; j++) if (segmentsCross(...segments[i], ...segments[j])) count++;
  return count;
}
function checkPairing(blue: readonly number[], pink: readonly number[]) {
  const { lines, leftover } = pairingLines(blue, pink);
  const larger: MittenColour = pink.length > blue.length ? "pink" : "blue";
  expect(lines).toHaveLength(Math.min(blue.length, pink.length));
  expect(new Set(lines.map(line => line.blue)).size).toBe(lines.length);
  expect(new Set(lines.map(line => line.pink)).size).toBe(lines.length);
  for (const line of lines) {
    expect(blue).toContain(line.blue);
    expect(pink).toContain(line.pink);
    expect(line.from).toEqual({ x: SNOWFLAKE_SLOTS.blue[line.blue].x, y: SNOWFLAKE_SLOTS.blue[line.blue].y });
    expect(line.to).toEqual({ x: SNOWFLAKE_SLOTS.pink[line.pink].x, y: SNOWFLAKE_SLOTS.pink[line.pink].y });
  }
  for (let i = 1; i < lines.length; i++) expect(lines[i].from.y).toBeGreaterThanOrEqual(lines[i - 1].from.y);
  if (blue.length === pink.length) {
    expect(leftover).toBeNull();
  } else {
    expect(leftover?.colour).toBe(larger);
    const largerSlots = larger === "blue" ? blue : pink;
    const paired = lines.map(line => line[larger]);
    expect(leftover!.slots).toHaveLength(Math.abs(blue.length - pink.length));
    expect([...leftover!.slots, ...paired].sort((a, b) => a - b)).toEqual([...largerSlots].sort((a, b) => a - b));
    expect([...leftover!.slots].sort((a, b) => a - b)).toEqual(leftover!.slots);
  }
}

describe("Snowflake Showdown scene", () => {
  it("references original SVGs with their exact viewBoxes and placement aspects", () => {
    const placements: (ScenePlacement & { asset?: string })[] = [
      ...MITTEN_COLOURS.flatMap(colour => snowflakePlacements(colour, [0, 1, 2, 3, 4, 5, 6, 7, 8])),
      snowmanPlacement("idle"),
      FLURRY_PATH.from,
      FLURRY_PATH.to,
    ];
    for (const [asset, size] of Object.entries(ASSET_VIEWBOXES)) {
      const path = assetPath(asset as SnowflakeShowdownAsset);
      const source = readFileSync(`public${path}`, "utf8");
      const root = new DOMParser().parseFromString(source, "image/svg+xml").documentElement;
      expect(root.localName, path).toBe("svg");
      expect(root.namespaceURI, path).toBe("http://www.w3.org/2000/svg");
      expect(root.getAttribute("viewBox")?.split(/\s+/).map(Number), path).toEqual([0, 0, ...size]);
      expect(source, path).not.toMatch(/<image|<text|@import|url\((?!#)|href="(?!#)|data:/);
      for (const p of placements.filter(p => p.asset === asset)) expect(p.aspect).toBeCloseTo(size[1] / size[0]);
    }
    expect(assetPath("star-gold")).toBe("/christmas-tree/star.svg");
    expect(assetPath("star-pale")).toBe("/snowflake-showdown/star-pale.svg");

    const mitten = ASSET_VIEWBOXES["mitten-blue"];
    for (const colour of MITTEN_COLOURS) {
      for (const side of ["palm", "back"] as const) expect(ASSET_VIEWBOXES[mittenAsset(colour, side)]).toEqual(mitten);
      expect(MITTEN_PLACEMENTS[colour].aspect).toBeCloseTo(mitten[1] / mitten[0]);
    }
    const snowman = ASSET_VIEWBOXES.snowman;
    for (const pose of ["idle", "clap", "shrug", "dance"] as const) {
      expect(ASSET_VIEWBOXES[snowmanAsset(pose)]).toEqual(snowman);
      expect(snowmanPlacement(pose)).toMatchObject(SNOWMAN_PLACEMENT);
    }
    expect(SNOWMAN_PLACEMENT.aspect).toBeCloseTo(snowman[1] / snowman[0]);
    expect(ASSET_VIEWBOXES["star-gold"]).toEqual(ASSET_VIEWBOXES["star-pale"]);
    for (const star of STAR_ROW) expect(star.aspect).toBeCloseTo(1);
  });

  it("puts blue on the left and pink on the right as mirror images, cuffs and palms inside each mitten", () => {
    const blue = rect(MITTEN_PLACEMENTS.blue);
    const pink = rect(MITTEN_PLACEMENTS.pink);
    expect(blue.right).toBeLessThanOrEqual(pink.left);
    expect(MITTEN_PLACEMENTS.blue.width).toBe(MITTEN_PLACEMENTS.pink.width);
    expect(MITTEN_PLACEMENTS.blue.y).toBe(MITTEN_PLACEMENTS.pink.y);
    expect((blue.left + pink.right) / 2).toBeCloseTo(W / 2);
    // The mittens' inner edges leave a clear gap for the pairing lines.
    expect(units(MITTEN_BOUNDS.pink).left - units(MITTEN_BOUNDS.blue).right).toBeGreaterThanOrEqual(20);
    for (const colour of MITTEN_COLOURS) {
      const mitten = rect(MITTEN_PLACEMENTS[colour]);
      const bounds = units(MITTEN_BOUNDS[colour]);
      expect(inside(bounds, mitten)).toBe(true);
      expect(inside(units(MITTEN_PALM[colour]), bounds)).toBe(true);
      expect(inside(units(MITTEN_CUFF[colour]), bounds)).toBe(true);
      expect(apart(units(MITTEN_PALM[colour]), units(MITTEN_CUFF[colour]))).toBe(true);
      expect(units(MITTEN_CUFF[colour]).top).toBeGreaterThan(units(MITTEN_PALM[colour]).bottom);
    }
    const mirror = (r: Rect): Rect => ({ ...r, left: W - r.right, right: W - r.left });
    for (const region of [MITTEN_PALM, MITTEN_CUFF, MITTEN_BOUNDS]) {
      const [b, p] = [mirror(units(region.blue)), units(region.pink)];
      for (const side of ["left", "right", "top", "bottom"] as const) expect(b[side]).toBeCloseTo(p[side]);
    }
  });

  it("gives each palm nine same-size snowflake slots, well apart and in reading order", () => {
    const size = SNOWFLAKE_SLOTS.blue[0].width;
    for (const colour of MITTEN_COLOURS) {
      const slots = SNOWFLAKE_SLOTS[colour];
      const palm = units(MITTEN_PALM[colour]);
      expect(slots).toHaveLength(SNOWFLAKE_SLOTS_PER_MITTEN);
      for (const [i, slot] of slots.entries()) {
        expect(slot.asset).toBe("snowflake");
        expect(slot.width).toBe(size);
        expect(slot.aspect).toBe(1);
        expect(inside(rect(slot), palm)).toBe(true);
        for (const other of slots.slice(0, i)) {
          // The 38-unit boxes keep 10 units of air on at least one axis; the painted flakes keep more.
          expect(boxGap(rect(slot), rect(other))).toBeGreaterThanOrEqual(10);
          expect(flakeGap(slot, other)).toBeGreaterThanOrEqual(12);
        }
      }
      // Three rows of three, read top row first and left to right within a row.
      for (const row of [0, 1, 2]) {
        const xs = slots.slice(row * 3, row * 3 + 3).map(slot => slot.x);
        expect(xs).toEqual([...xs].sort((a, b) => a - b));
        if (row) {
          const above = Math.max(...slots.slice(row * 3 - 3, row * 3).map(slot => slot.y));
          expect(Math.min(...slots.slice(row * 3, row * 3 + 3).map(slot => slot.y))).toBeGreaterThan(above);
        }
      }
      // No three slots line up: each lies at least 6 units off the segment between any two it falls between.
      const points = slots.map(centre);
      for (const a of points)
        for (const b of points)
          for (const c of points) {
            if (a === b || b === c || a === c) continue;
            const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
            const t = ((c[0] - a[0]) * (b[0] - a[0]) + (c[1] - a[1]) * (b[1] - a[1])) / length ** 2;
            if (t <= 0 || t >= 1) continue;
            const offLine = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / length;
            expect(offLine).toBeGreaterThanOrEqual(6);
          }
    }
    // Pink's layout is blue's mirrored about the centre line, so neither mitten's palm looks fuller.
    const mirrored = SNOWFLAKE_SLOTS.blue.map(({ x, y }) => `${(1 - x).toFixed(6)},${y.toFixed(6)}`).sort();
    expect(SNOWFLAKE_SLOTS.pink.map(({ x, y }) => `${x.toFixed(6)},${y.toFixed(6)}`).sort()).toEqual(mirrored);
  });

  it("maps slot indices to placements and rejects bad indices", () => {
    for (const colour of MITTEN_COLOURS) {
      expect(snowflakePlacements(colour, [])).toEqual([]);
      expect(snowflakePlacements(colour, [8, 0, 4])).toEqual([
        SNOWFLAKE_SLOTS[colour][8],
        SNOWFLAKE_SLOTS[colour][0],
        SNOWFLAKE_SLOTS[colour][4],
      ]);
      for (const set of subsets(6).slice(0, 20))
        expect(snowflakePlacements(colour, set)).toEqual(set.map(i => SNOWFLAKE_SLOTS[colour][i]));
      expect(() => snowflakePlacements(colour, [9])).toThrow(RangeError);
      expect(() => snowflakePlacements(colour, [-1])).toThrow(RangeError);
      expect(() => snowflakePlacements(colour, [1.5])).toThrow(RangeError);
      expect(() => snowflakePlacements(colour, [2, 2])).toThrow(RangeError);
    }
  });

  it("pairs one snowflake from each mitten until the smaller side runs out, for every non-tie count", () => {
    for (const blue of COUNTS) {
      for (const pink of COUNTS) {
        if (blue === pink) continue;
        const blueSets = subsets(blue);
        const pinkSets = subsets(pink);
        for (let i = 0; i < 12; i++)
          checkPairing(blueSets[(i * 37) % blueSets.length], pinkSets[(i * 53 + 11) % pinkSets.length]);
      }
    }
    checkPairing([0, 4, 8], [1, 3, 5]);
    expect(pairingLines([2, 7], [0, 5])).toEqual(pairingLines([7, 2], [5, 0]));
    expect(() => pairingLines([9], [0])).toThrow(RangeError);
    expect(() => pairingLines([0, 0], [1])).toThrow(RangeError);
  });

  it("never crosses pairing lines in any round the game can show, nor in a wide sample of other layouts", () => {
    for (let seed = SNOWFLAKE_SHOWDOWN_SEED_MIN; seed <= SNOWFLAKE_SHOWDOWN_SEED_MAX; seed++) {
      for (let round = 1; round <= SNOWFLAKE_SHOWDOWN_ROUNDS; round++) {
        const blue = snowflakeLayout(seed, round, "blue");
        const pink = snowflakeLayout(seed, round, "pink");
        checkPairing(blue, pink);
        expect(crossings(lineSegments(blue, pink)), `seed ${seed} round ${round}`).toBe(0);
      }
    }
    let sampled = 0;
    for (const blue of COUNTS) {
      for (const pink of COUNTS) {
        if (blue === pink) continue;
        const blueSets = subsets(blue);
        const pinkSets = subsets(pink);
        for (let i = 0; i < blueSets.length; i += 3) {
          for (let j = i % 5; j < pinkSets.length; j += 5) {
            expect(crossings(lineSegments(blueSets[i], pinkSets[j]))).toBe(0);
            sampled++;
          }
        }
      }
    }
    expect(sampled).toBeGreaterThan(10_000);
  });

  it("lines ten evenly spaced stars across the top strip, inside the portrait band and under the pill", () => {
    expect(STAR_ROW).toHaveLength(10);
    const xs = STAR_ROW.map(star => star.x * W);
    for (const [i, star] of STAR_ROW.entries()) {
      expect(star.width).toBe(STAR_ROW[0].width);
      expect(star.y).toBe(STAR_ROW[0].y);
      expect(inside(rect(star), PORTRAIT_BAND)).toBe(true);
      if (i) {
        expect(xs[i] - xs[i - 1]).toBeCloseTo(xs[1] - xs[0]);
        expect(apart(rect(STAR_ROW[i - 1]), rect(star))).toBe(true);
      }
      for (const colour of MITTEN_COLOURS) expect(rect(star).bottom).toBeLessThan(units(MITTEN_BOUNDS[colour]).top);
    }
    expect((xs[0] + xs[9]) / 2).toBeCloseTo(W / 2);
  });

  it("keeps the snowman beside the blue mitten and the flurry clear of the palms", () => {
    const snowman = rect(SNOWMAN_PLACEMENT);
    for (const colour of MITTEN_COLOURS) expect(apart(snowman, units(MITTEN_BOUNDS[colour]))).toBe(true);
    expect(SNOWMAN_PLACEMENT.x * W).toBeLessThan(units(MITTEN_BOUNDS.blue).right);
    expect(snowman.left).toBeLessThan(units(MITTEN_BOUNDS.blue).left);
    expect(snowman.bottom).toBeLessThanOrEqual(H);

    for (const [width, height] of SCREENS) {
      const { left, right } = crop(width, height);
      expect(rect(FLURRY_PATH.from).right).toBeLessThan(left);
      expect(rect(FLURRY_PATH.to).left).toBeGreaterThan(right);
    }
    expect(FLURRY_PATH.from.y).toBe(FLURRY_PATH.to.y);
    for (const colour of MITTEN_COLOURS)
      expect(rect(FLURRY_PATH.from).bottom).toBeLessThan(units(MITTEN_PALM[colour]).top);
  });

  it("keeps six snowflakes easy to count on a phone and everything that matters on screen", () => {
    for (const [width, height] of SCREENS) {
      const view = crop(width, height);
      const { scale } = view;
      const portrait = height > width;
      // What the stage leaves visible between the overlays, in background units.
      const clear: Rect = {
        left: view.left,
        right: view.right,
        top: view.top + PILL_PX / scale,
        bottom: view.bottom - PROGRESS_PX / scale,
      };
      for (const colour of MITTEN_COLOURS) {
        const slots = SNOWFLAKE_SLOTS[colour];
        for (const [i, slot] of slots.entries()) {
          // Measured on the painted flake: its narrower width across, not just its box.
          expect(painted(slot).width * scale).toBeGreaterThanOrEqual(28);
          for (const other of slots.slice(0, i)) {
            expect(flakeGap(slot, other) * scale).toBeGreaterThanOrEqual(8);
            expect(boxGap(rect(slot), rect(other)) * scale).toBeGreaterThanOrEqual(8);
          }
          expect(inside(rect(slot), clear)).toBe(true);
        }
        expect(inside(units(MITTEN_BOUNDS[colour]), clear)).toBe(true);
        expect(inside(units(MITTEN_CUFF[colour]), clear)).toBe(true);
        expect((units(MITTEN_BOUNDS[colour]).bottom - units(MITTEN_BOUNDS[colour]).top) * scale).toBeGreaterThan(250);
      }
      for (const star of STAR_ROW) {
        expect(inside(rect(star), clear)).toBe(true);
        expect(rect(star).right - rect(star).left).toBeGreaterThanOrEqual(30 / scale);
      }
      // The snowman stands fully on screen in landscape. In portrait his outer arm and the edge of his
      // body fall outside the band, but his head, hat and scarf stay on screen.
      const snowman = rect(SNOWMAN_PLACEMENT);
      if (portrait) {
        expect(view.right - view.left).toBeCloseTo(390 / (844 / 900));
        expect(snowman.left).toBeLessThan(view.left);
        // In snowman.svg the hat brim, his widest part above the scarf, starts at x 62.
        const artScale = (SNOWMAN_PLACEMENT.width * W) / ASSET_VIEWBOXES.snowman[0];
        expect(snowman.left + 62 * artScale).toBeGreaterThanOrEqual(view.left);
        expect(snowman.right).toBeLessThanOrEqual(view.right);
      } else {
        expect(inside(snowman, clear)).toBe(true);
      }
    }
  });
});
