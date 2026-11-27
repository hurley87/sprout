// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CHRISTMAS_TREE_FIXED,
  CHRISTMAS_TREE_ICONS,
  CHRISTMAS_TREE_SLOTS,
  christmasTreePlacements,
  type ChristmasTreePlacement,
} from "../app/christmas-tree-scene";
import {
  CHRISTMAS_TREE_KINDS,
  CHRISTMAS_TREE_SEED_MAX,
  CHRISTMAS_TREE_SEED_MIN,
  CHRISTMAS_TREE_SLOTS_PER_KIND,
  christmasTreeArrangement,
} from "../lib/lesson-runtime/christmas-tree-arrangement";

const BOX_ASPECT = 8 / 5;
const FLOOR_TOP = 0.8;
const SLOT_GAP = 4 / 800;
const slots = Object.values(CHRISTMAS_TREE_SLOTS).flat();

function bounds({ x, y, width, aspect }: ChristmasTreePlacement) {
  const height = width * BOX_ASPECT * aspect;
  return { left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2 };
}

function separated(a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>, gap = 0) {
  return (
    a.right + gap <= b.left ||
    b.right + gap <= a.left ||
    a.bottom + gap * BOX_ASPECT <= b.top ||
    b.bottom + gap * BOX_ASPECT <= a.top
  );
}

function readSvg(asset: string) {
  const source = readFileSync(`public/christmas-tree/${asset}.svg`, "utf8");
  const { documentElement } = new DOMParser().parseFromString(source, "image/svg+xml");
  expect(documentElement.localName, asset).toBe("svg");
  expect(documentElement.namespaceURI, asset).toBe("http://www.w3.org/2000/svg");
  const viewBox = (documentElement.getAttribute("viewBox") ?? "").trim().split(/\s+/).map(Number);
  expect(viewBox, asset).toHaveLength(4);
  expect(viewBox.every(Number.isFinite), asset).toBe(true);
  const [, , width, height] = viewBox;
  expect(width, asset).toBeGreaterThan(0);
  expect(height, asset).toBeGreaterThan(0);
  return { documentElement, width, height };
}

describe("Christmas tree scene", () => {
  it("has six slots for each kind", () => {
    for (const kind of CHRISTMAS_TREE_KINDS) {
      expect(CHRISTMAS_TREE_SLOTS[kind], kind).toHaveLength(CHRISTMAS_TREE_SLOTS_PER_KIND);
    }
  });

  it("keeps every item within the box and in its own band", () => {
    for (const kind of CHRISTMAS_TREE_KINDS) {
      for (const placement of CHRISTMAS_TREE_SLOTS[kind]) {
        const { left, right, top, bottom } = bounds(placement);
        expect(left, kind).toBeGreaterThanOrEqual(0);
        expect(right, kind).toBeLessThanOrEqual(1);
        expect(top, kind).toBeGreaterThanOrEqual(0);
        expect(bottom, kind).toBeLessThanOrEqual(1);
        if (kind === "present") {
          expect(top).toBeGreaterThanOrEqual(FLOOR_TOP);
        } else {
          expect(bottom, kind).toBeLessThanOrEqual(FLOOR_TOP);
        }
      }
    }
  });

  it("leaves a gap between every pair of slots and keeps the star clear", () => {
    const star = bounds(CHRISTMAS_TREE_FIXED.star);
    const boxes = slots.map(bounds);
    for (const [index, box] of boxes.entries()) {
      expect(separated(box, star, SLOT_GAP), `slot ${index} and star`).toBe(true);
      for (const [otherIndex, other] of boxes.slice(0, index).entries()) {
        expect(separated(box, other, SLOT_GAP), `slots ${index} and ${otherIndex}`).toBe(true);
      }
    }
  });

  it("keeps the light bulbs outside the item boxes", () => {
    const { documentElement, width, height } = readSvg(CHRISTMAS_TREE_FIXED.lights.asset);
    const bulbs = documentElement.querySelectorAll("#bulbs rect");
    expect(bulbs.length).toBeGreaterThan(0);
    for (const bulb of bulbs) {
      const x = Number(bulb.getAttribute("x"));
      const y = Number(bulb.getAttribute("y"));
      const right = x + Number(bulb.getAttribute("width"));
      const bottom = y + Number(bulb.getAttribute("height"));
      const box = { left: x / width, right: right / width, top: y / height, bottom: bottom / height };
      for (const placement of slots) {
        expect(separated(bounds(placement), box), `${placement.asset} and bulb at ${x}, ${y}`).toBe(true);
      }
    }
  });

  it("references valid SVGs whose viewBoxes match the placement aspects", () => {
    const placements = [...slots, ...Object.values(CHRISTMAS_TREE_FIXED)];
    const assets = new Set([
      ...placements.map(placement => placement.asset),
      ...Object.values(CHRISTMAS_TREE_ICONS),
      "living-room",
      "snow",
      "present-pink-bow",
      "present-gold-bow",
    ]);
    for (const asset of assets) {
      const { documentElement, width, height } = readSvg(asset);
      for (const placement of placements.filter(placement => placement.asset === asset)) {
        expect(placement.aspect, asset).toBeCloseTo(height / width);
      }
      if (asset.endsWith("-bow")) {
        const body = readSvg(asset.slice(0, -4));
        expect(documentElement.querySelector("g#bow"), asset).not.toBeNull();
        expect(body.documentElement.querySelector("g#bow"), asset).toBeNull();
        expect([width, height], asset).toEqual([body.width, body.height]);
      }
    }
  });

  it("returns each selected slot in kind and slot order for every seed", () => {
    for (let seed = CHRISTMAS_TREE_SEED_MIN; seed <= CHRISTMAS_TREE_SEED_MAX; seed++) {
      const arrangement = christmasTreeArrangement(seed);
      const placed = christmasTreePlacements(arrangement);
      expect(placed.map(({ kind }) => kind)).toEqual(
        CHRISTMAS_TREE_KINDS.flatMap(kind => Array.from({ length: arrangement.counts[kind] }, () => kind)),
      );
      for (const kind of CHRISTMAS_TREE_KINDS) {
        const selected = placed.filter(item => item.kind === kind);
        expect(selected.map(item => item.slot)).toEqual(arrangement.slots[kind]);
        for (const { slot, placement } of selected) {
          expect(placement).toBe(CHRISTMAS_TREE_SLOTS[kind][slot]);
        }
      }
    }
  });
});
