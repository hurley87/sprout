// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ASSET_VIEWBOXES,
  assetPath,
  BACKGROUND_ALIGNMENT,
  CHIMNEY_DROP,
  CHIMNEY_FIXED,
  fireplaceRow,
  HEARTH_OPENING,
  PILE_SLOTS,
  presentColour,
  type ChimneyPlacement,
} from "../app/down-the-chimney-scene";

function bounds(p: ChimneyPlacement) {
  const h = p.width * (16 / 9) * p.aspect;
  return { left: p.x - p.width / 2, right: p.x + p.width / 2, top: p.y - h / 2, bottom: p.y + h / 2 };
}
function separated(a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>) {
  return a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
}

describe("Down the Chimney scene", () => {
  it("references SVGs with their exact viewBoxes and placement aspects", () => {
    const placements = [
      ...Object.values(CHIMNEY_FIXED),
      ...Object.values(CHIMNEY_DROP),
      ...PILE_SLOTS,
      ...fireplaceRow(5),
    ];
    for (const [asset, size] of Object.entries(ASSET_VIEWBOXES)) {
      const path = assetPath(asset as keyof typeof ASSET_VIEWBOXES);
      const root = new DOMParser().parseFromString(
        readFileSync(`public${path}`, "utf8"),
        "image/svg+xml",
      ).documentElement;
      expect(root.localName, path).toBe("svg");
      expect(root.namespaceURI, path).toBe("http://www.w3.org/2000/svg");
      expect(root.getAttribute("viewBox")?.split(/\s+/).map(Number), path).toEqual([0, 0, ...size]);
      for (const p of placements.filter(p => p.asset === asset)) expect(p.aspect).toBeCloseTo(size[1] / size[0]);
    }
    for (const group of [
      ["santa", "santa-drop", "santa-dust", "santa-peer", "santa-wave"],
      ["chimney-back", "chimney-front"],
      ["present-pink", "present-gold", "present-red"],
    ] as const) {
      for (const asset of group) expect(ASSET_VIEWBOXES[asset]).toEqual(ASSET_VIEWBOXES[group[0]]);
    }
  });
  it("centres evenly spaced, nonoverlapping presents within the hearth", () => {
    for (let count = 1; count <= 5; count++) {
      const row = fireplaceRow(count);
      expect(row).toHaveLength(count);
      expect((row[0].x + row[count - 1].x) / 2).toBeCloseTo(CHIMNEY_FIXED.fireplace.x);
      for (const [i, p] of row.entries()) {
        const b = bounds(p);
        expect(b.left).toBeGreaterThanOrEqual(HEARTH_OPENING.left);
        expect(b.right).toBeLessThanOrEqual(HEARTH_OPENING.right);
        expect(b.top).toBeGreaterThanOrEqual(HEARTH_OPENING.top);
        expect(b.bottom).toBeLessThanOrEqual(HEARTH_OPENING.bottom);
        if (i) {
          expect(separated(bounds(row[i - 1]), b)).toBe(true);
          expect(p.x - row[i - 1].x).toBeCloseTo(81 / 1600);
        }
      }
    }
    expect(() => fireplaceRow(0)).toThrow(RangeError);
    expect(() => fireplaceRow(6)).toThrow(RangeError);
  });
  it("keeps the pile separate and chooses different neighbouring colours", () => {
    for (const [i, p] of PILE_SLOTS.entries()) {
      expect(separated(bounds(p), bounds(CHIMNEY_FIXED.fireplace))).toBe(true);
      for (const other of PILE_SLOTS.slice(0, i)) expect(separated(bounds(p), bounds(other))).toBe(true);
    }
    for (let round = 0; round < 8; round++)
      for (let i = 1; i < 5; i++) expect(presentColour(round, i)).not.toBe(presentColour(round, i - 1));
  });
  it("keeps the action large and critical elements in the portrait cover crop", () => {
    for (const [width, height, alignment] of [
      [1440, 800, BACKGROUND_ALIGNMENT.landscape],
      [390, 844, BACKGROUND_ALIGNMENT.portrait],
    ]) {
      const scale = Math.max(width / 1600, height / 900);
      const visibleLeft = ((1600 * scale - width) * alignment) / scale / 1600;
      const visibleRight = visibleLeft + width / scale / 1600;
      expect(CHIMNEY_DROP.start.width * 1600 * scale).toBeGreaterThanOrEqual(64);
      expect(CHIMNEY_FIXED.santa.width * 1600 * scale).toBeGreaterThanOrEqual(243);
      for (const p of fireplaceRow(5)) {
        expect(p.width * 1600 * scale).toBeGreaterThanOrEqual(width === 390 ? 56 : 70);
      }
      if (width === 390) {
        for (const p of [CHIMNEY_FIXED.santa, CHIMNEY_FIXED.chimneyFront, ...fireplaceRow(5)]) {
          expect(bounds(p).left).toBeGreaterThanOrEqual(visibleLeft);
          expect(bounds(p).right).toBeLessThanOrEqual(visibleRight);
        }
        expect(HEARTH_OPENING.left).toBeGreaterThanOrEqual(visibleLeft);
        expect(HEARTH_OPENING.right).toBeLessThanOrEqual(visibleRight);
      }
    }
  });
  it("hides the drop endpoint behind the solid front face", () => {
    const front = bounds(CHIMNEY_FIXED.chimneyFront);
    const end = bounds(CHIMNEY_DROP.end);
    // Front face begins at viewBox y=61 and spans x=20..140.
    expect(end.left).toBeGreaterThan(front.left + (CHIMNEY_FIXED.chimneyFront.width * 20) / 160);
    expect(end.right).toBeLessThan(front.left + (CHIMNEY_FIXED.chimneyFront.width * 140) / 160);
    expect(end.top).toBeGreaterThan(front.top + (CHIMNEY_FIXED.chimneyFront.width * (16 / 9) * 61) / 160);
    expect(end.bottom).toBeLessThan(front.bottom);
  });
});
