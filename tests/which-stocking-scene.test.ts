// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STOCKING_COLOURS } from "../lib/lesson-runtime/which-stocking-plan";
import {
  ASSET_VIEWBOXES,
  assetPath,
  BACKGROUND_ALIGNMENT,
  CANE_OUTLINE,
  CANE_PIVOT,
  caneFan,
  HEARTH,
  HEARTH_OPENING,
  stockingColourAsset,
  stockingSlots,
  TOY_ASSETS,
  TOY_PILE_SLOTS,
  WHICH_STOCKING_FIXED,
  type CanePlacement,
  type SceneBox,
  type ScenePlacement,
  type StockingSlot,
} from "../app/which-stocking-scene";

// Work in background units (1600 × 900) so distances convert to pixels with a single scale.
type Point = readonly [number, number];
type Rect = { left: number; right: number; top: number; bottom: number };
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
function apart(a: Rect, b: Rect) {
  return a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
}

const [CANE_W, CANE_H] = ASSET_VIEWBOXES["candy-cane"];
function toWorld(cane: CanePlacement, [x, y]: Point): Point {
  const scale = (cane.width * W) / CANE_W;
  const angle = (cane.rotation * Math.PI) / 180;
  const lx = (x - CANE_W / 2) * scale;
  const ly = (y - CANE_H / 2) * scale;
  return [
    cane.x * W + lx * Math.cos(angle) - ly * Math.sin(angle),
    cane.y * H + lx * Math.sin(angle) + ly * Math.cos(angle),
  ];
}
function outline(cane: CanePlacement): Point[][] {
  return CANE_OUTLINE.map(polygon => polygon.map(point => toWorld(cane, point)));
}
function boxPolygon(r: Rect): Point[] {
  return [
    [r.left, r.top],
    [r.right, r.top],
    [r.right, r.bottom],
    [r.left, r.bottom],
  ];
}
function edges(polygon: readonly Point[]) {
  return polygon.map((a, i) => [a, polygon[(i + 1) % polygon.length]] as const);
}
function separatedByAxis(a: readonly Point[], b: readonly Point[]) {
  return [a, b].some(polygon =>
    edges(polygon).some(([p, q]) => {
      const normal = [q[1] - p[1], p[0] - q[0]];
      const project = (points: readonly Point[]) => points.map(([x, y]) => x * normal[0] + y * normal[1]);
      const pa = project(a);
      const pb = project(b);
      return Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa);
    }),
  );
}
function pointToSegment([x, y]: Point, [p, q]: readonly [Point, Point]) {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const t = Math.max(0, Math.min(1, ((x - p[0]) * dx + (y - p[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - p[0] - t * dx, y - p[1] - t * dy);
}
/** Distance between two convex polygons; 0 when they touch or overlap. */
function distance(a: readonly Point[], b: readonly Point[]) {
  if (!separatedByAxis(a, b)) return 0;
  return Math.min(
    ...a.flatMap(point => edges(b).map(edge => pointToSegment(point, edge))),
    ...b.flatMap(point => edges(a).map(edge => pointToSegment(point, edge))),
  );
}
function caneGap(a: CanePlacement, b: CanePlacement) {
  return Math.min(...outline(a).flatMap(p => outline(b).map(q => distance(p, q))));
}
function bounds(points: readonly Point[]): Rect {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}
/** Length of the cane from the cuff's top edge to the top of the hook, along the cane. */
function visibleLength(cane: CanePlacement, slot: StockingSlot) {
  const [, pivotY] = toWorld(cane, CANE_PIVOT);
  const scale = (cane.width * W) / CANE_W;
  const hidden = (pivotY - units(slot.cuff).top) / Math.cos((cane.rotation * Math.PI) / 180);
  return (CANE_PIVOT[1] - 1) * scale - hidden;
}

const COUNTS = [1, 2, 3, 4, 5] as const;
const LAYOUTS = [stockingSlots(2), stockingSlots(3)];
const fanEnvelope = (slot: StockingSlot) =>
  bounds(COUNTS.flatMap(count => caneFan(slot, count).flatMap(cane => outline(cane).flat())));

function crop(width: number, height: number) {
  const alignment = width > height ? BACKGROUND_ALIGNMENT.landscape : BACKGROUND_ALIGNMENT.portrait;
  const scale = Math.max(width / W, height / H);
  const left = ((W * scale - width) * alignment) / scale;
  return { scale, left, right: left + width / scale };
}

describe("Which Stocking scene", () => {
  it("references SVGs with their exact viewBoxes and placement aspects", () => {
    const placements: (ScenePlacement & { asset?: string })[] = [
      WHICH_STOCKING_FIXED.fire,
      ...LAYOUTS.flat().flatMap(slot => COUNTS.flatMap(count => caneFan(slot, count))),
    ];
    for (const [asset, size] of Object.entries(ASSET_VIEWBOXES)) {
      const path = assetPath(asset as keyof typeof ASSET_VIEWBOXES);
      const source = readFileSync(`public${path}`, "utf8");
      const root = new DOMParser().parseFromString(source, "image/svg+xml").documentElement;
      expect(root.localName, path).toBe("svg");
      expect(root.namespaceURI, path).toBe("http://www.w3.org/2000/svg");
      expect(root.getAttribute("viewBox")?.split(/\s+/).map(Number), path).toEqual([0, 0, ...size]);
      expect(source, path).not.toMatch(/<image|<text|@import|url\((?!#)|href="(?!#)/);
      for (const p of placements.filter(p => p.asset === asset)) expect(p.aspect).toBeCloseTo(size[1] / size[0]);
    }
    const stocking = ASSET_VIEWBOXES["stocking-pink"];
    for (const colour of [...STOCKING_COLOURS, "blue"] as const) {
      expect(ASSET_VIEWBOXES[stockingColourAsset(colour)]).toEqual(stocking);
    }
    for (const slot of LAYOUTS.flat()) expect(slot.stocking.aspect).toBeCloseTo(stocking[1] / stocking[0]);
    expect(new Set(TOY_ASSETS).size).toBe(8);
    for (const toy of TOY_ASSETS) expect(ASSET_VIEWBOXES[toy]).toEqual(ASSET_VIEWBOXES["toy-teddy"]);
    for (const slot of TOY_PILE_SLOTS) expect(slot.aspect).toBeCloseTo(90 / 100);
  });

  it("hangs two or three same-size stockings centred, evenly spaced and apart under the mantel", () => {
    const mantel = units(WHICH_STOCKING_FIXED.mantel);
    for (const slots of LAYOUTS) {
      const xs = slots.map(slot => slot.stocking.x);
      expect((xs[0] + xs.at(-1)!) / 2).toBeCloseTo(0.5);
      for (const [i, slot] of slots.entries()) {
        expect(slot.stocking.width).toBe(slots[0].stocking.width);
        expect(rect(slot.stocking).left).toBeGreaterThanOrEqual(mantel.left);
        expect(rect(slot.stocking).right).toBeLessThanOrEqual(mantel.right);
        // The cuff overlaps the frieze's lower edge, so the stocking reads as hung from the mantel.
        expect(units(slot.cuff).top).toBeLessThan(mantel.bottom);
        expect(units(slot.cuff).bottom).toBeGreaterThan(mantel.bottom);
        expect(apart(units(slot.body), units(HEARTH))).toBe(true);
        if (i) {
          expect(xs[i] - xs[i - 1]).toBeCloseTo(xs[1] - xs[0]);
          expect(apart(rect(slots[i - 1].stocking), rect(slot.stocking))).toBe(true);
        }
      }
    }
    expect(() => stockingSlots(1 as 2)).toThrow(RangeError);
    expect(() => stockingSlots(4 as 3)).toThrow(RangeError);
  });

  it("fans every count of canes out of the cuff without touching each other, the loop or the neighbours", () => {
    const frieze = units(WHICH_STOCKING_FIXED.frieze);
    for (const slots of LAYOUTS) {
      for (const [index, slot] of slots.entries()) {
        const cuff = units(slot.cuff);
        const loop = boxPolygon(units(slot.loop));
        for (const count of COUNTS) {
          const fan = caneFan(slot, count);
          expect(fan).toHaveLength(count);
          for (const [i, cane] of fan.entries()) {
            expect(cane.asset).toBe("candy-cane");
            for (const other of fan.slice(0, i)) expect(caneGap(cane, other)).toBeGreaterThan(4.5);
            for (const polygon of outline(cane)) {
              expect(distance(polygon, loop)).toBeGreaterThan(1);
              // Above the cuff the cane stands against the plain frieze; below, the cuff hides it.
              for (const [x, y] of polygon) {
                if (y <= cuff.top) {
                  expect(x).toBeGreaterThanOrEqual(frieze.left);
                  expect(x).toBeLessThanOrEqual(frieze.right);
                  expect(y).toBeGreaterThanOrEqual(frieze.top);
                } else {
                  expect(x).toBeGreaterThanOrEqual(cuff.left);
                  expect(x).toBeLessThanOrEqual(cuff.right);
                  expect(y).toBeLessThan(cuff.bottom);
                }
              }
              for (const [[x1, y1], [x2, y2]] of edges(polygon)) {
                if ((y1 - cuff.top) * (y2 - cuff.top) >= 0) continue;
                const x = x1 + ((cuff.top - y1) / (y2 - y1)) * (x2 - x1);
                expect(x).toBeGreaterThan(cuff.left);
                expect(x).toBeLessThan(cuff.right);
              }
            }
            expect(bounds(outline(cane).flat()).top).toBeLessThan(cuff.top - 35);
          }
        }
        for (const [other, neighbour] of slots.entries()) {
          if (other === index) continue;
          expect(apart(fanEnvelope(slot), fanEnvelope(neighbour))).toBe(true);
          expect(apart(fanEnvelope(slot), units(neighbour.body))).toBe(true);
        }
      }
    }
    expect(() => caneFan(LAYOUTS[0][0], 0)).toThrow(RangeError);
    expect(() => caneFan(LAYOUTS[0][0], 6)).toThrow(RangeError);
    expect(() => caneFan(LAYOUTS[0][0], 2.5)).toThrow(RangeError);
  });

  it("keeps the toy pile on the floor, apart and clear of the stockings and the hearth", () => {
    expect(TOY_PILE_SLOTS).toHaveLength(8);
    for (const [i, slot] of TOY_PILE_SLOTS.entries()) {
      const toy = rect(slot);
      expect(toy.bottom).toBeLessThanOrEqual(H);
      expect(apart(toy, units(HEARTH))).toBe(true);
      for (const stocking of LAYOUTS.flat()) expect(apart(toy, rect(stocking.stocking))).toBe(true);
      for (const other of TOY_PILE_SLOTS.slice(0, i)) expect(apart(toy, rect(other))).toBe(true);
    }
    const opening = units(HEARTH_OPENING);
    const fire = rect(WHICH_STOCKING_FIXED.fire);
    expect((fire.left + fire.right) / 2).toBeCloseTo((opening.left + opening.right) / 2);
    expect(units(WHICH_STOCKING_FIXED.glow).left).toBeLessThanOrEqual(opening.left);
    expect(units(WHICH_STOCKING_FIXED.glow).right).toBeGreaterThanOrEqual(opening.right);
  });

  it("keeps stockings and canes large, and the whole mantel in the portrait crop", () => {
    for (const [width, height] of [
      [1440, 800],
      [390, 844],
    ]) {
      const { scale, left, right } = crop(width, height);
      const portrait = height > width;
      for (const slots of LAYOUTS) {
        for (const slot of slots) {
          const body = units(slot.body);
          expect((body.bottom - body.top) * scale).toBeGreaterThanOrEqual(portrait ? 100 : 120);
          for (const count of COUNTS) {
            for (const cane of caneFan(slot, count))
              expect(visibleLength(cane, slot) * scale).toBeGreaterThanOrEqual(40);
          }
          const five = caneFan(slot, 5);
          for (let i = 1; i < five.length; i++) {
            expect(caneGap(five[i - 1], five[i]) * scale).toBeGreaterThanOrEqual(4);
          }
          if (portrait) {
            for (const r of [rect(slot.stocking), fanEnvelope(slot)]) {
              expect(r.left).toBeGreaterThanOrEqual(left);
              expect(r.right).toBeLessThanOrEqual(right);
            }
          }
        }
      }
      if (portrait) {
        expect(right - left).toBeCloseTo(390 / (844 / 900));
        for (const r of [units(WHICH_STOCKING_FIXED.mantel), units(HEARTH_OPENING)]) {
          expect(r.left).toBeGreaterThanOrEqual(left);
          expect(r.right).toBeLessThanOrEqual(right);
        }
      }
    }
  });
});
