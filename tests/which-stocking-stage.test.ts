import { expect, it } from "vitest";
import { whichStockingSuccessLabel } from "../app/which-stocking-theme";
import {
  HIGHLIGHT_LEAD_MS,
  PICK_CANE_MS,
  PICK_HOLD_MS,
  SWEEP_CANE_MS,
  SWEEP_GAP_MS,
  highlightSequence,
  litCanes,
  missHighlight,
  successTimeline,
  whichStockingMisses,
} from "../app/which-stocking-timeline";
import { stockingColourAliases, whichStockingLesson } from "../lib/lesson-runtime/which-stocking-lesson";
import type { LessonSnapshot } from "../lib/lesson-runtime/lesson-runtime";

const aliases = stockingColourAliases("gold");
// Seed 0: round 4 hangs pink 4, purple 5 and gold 2; gold is the answer.
const node = whichStockingLesson(0).nodes["stocking-4"];

it("only counts incorrect misses from the current confirmed visit", () => {
  const snapshot = {
    runtime: {
      nodeId: node.id,
      visitId: 2,
      pendingRender: null,
      difficulties: [
        { kind: "incorrect", source: { visitId: 1 } },
        { kind: "incorrect", source: { visitId: 2 } },
        { kind: "help", source: { visitId: 2 } },
      ],
    },
  } as unknown as LessonSnapshot;
  expect(whichStockingMisses(snapshot, node)).toBe(1);
  expect(
    whichStockingMisses({ ...snapshot, runtime: { ...snapshot.runtime!, pendingRender: {} as never } }, node),
  ).toBe(0);
  expect(whichStockingMisses(snapshot, whichStockingLesson(0).nodes["stocking-5"])).toBe(0);
  expect(whichStockingMisses(snapshot, null)).toBe(0);
});

it.each([
  ["Child: pink!", "pink"],
  ["Child: um the purple one", "purple"],
  ["Child: pink... no, purple", "purple"],
  ["Tutor: Two!\nChild: yellow", "gold"],
  ["Child: golden", "gold"],
  ["Child: pink\nTutor: That one has four. We want two.\nChild: purple", "purple"],
  ["Child: red", null],
  ["Child: blue", null],
  ["Child: that one", null],
  ["Child: two", null],
  ["Tutor: Pink has four.", null],
  ["", null],
])("reads her pick from %j", (transcript, colour) => {
  expect(missHighlight(1, transcript, node, aliases)).toEqual({ kind: "pick", miss: 1, colour });
});

it("sweeps every stocking on the second miss and lights her pick otherwise", () => {
  expect(missHighlight(2, "Child: pink", node, aliases)).toEqual({ kind: "sweep", miss: 2 });
  expect(missHighlight(3, "Child: pink", node, aliases)).toEqual({ kind: "pick", miss: 3, colour: "pink" });
});

it("lights her pick about once a second, and nothing when no colour is on screen", () => {
  const { steps, endMs } = highlightSequence({ kind: "pick", miss: 1, colour: "pink" }, node);
  expect(steps).toEqual([0, 1, 2, 3].map(cane => ({ colour: "pink", cane, atMs: HIGHLIGHT_LEAD_MS + cane * 1000 })));
  expect(PICK_CANE_MS).toBe(1000);
  expect(endMs).toBe(HIGHLIGHT_LEAD_MS + 3 * PICK_CANE_MS + PICK_HOLD_MS);
  expect(highlightSequence({ kind: "pick", miss: 1, colour: null }, node)).toEqual({ steps: [], endMs: 0 });
  expect(highlightSequence({ kind: "pick", miss: 1, colour: "blue" }, node)).toEqual({ steps: [], endMs: 0 });
  expect(litCanes(steps, 0)).toBeNull();
  expect(litCanes(steps, 3)).toEqual({ colour: "pink", count: 3 });
});

it("sweeps left to right with a gap between stockings, then ends where the glow starts", () => {
  const { steps, endMs } = highlightSequence({ kind: "sweep", miss: 2 }, node);
  expect(steps.map(step => step.colour)).toEqual([
    ...Array(4).fill("pink"),
    ...Array(5).fill("purple"),
    "gold",
    "gold",
  ]);
  expect(SWEEP_CANE_MS).toBe(800);
  expect(steps[0].atMs).toBe(HIGHLIGHT_LEAD_MS);
  expect(steps[1].atMs - steps[0].atMs).toBe(SWEEP_CANE_MS);
  // Purple's first cane follows pink's last cane and a short gap.
  expect(steps[4].atMs - steps[3].atMs).toBe(SWEEP_CANE_MS + SWEEP_GAP_MS);
  expect(steps[9].atMs - steps[8].atMs).toBe(SWEEP_CANE_MS + SWEEP_GAP_MS);
  expect(endMs).toBe(steps.at(-1)!.atMs + SWEEP_CANE_MS);
  // A counted stocking stays lit through the gap, and only one stocking is lit at a time.
  expect(litCanes(steps, 4)).toEqual({ colour: "pink", count: 4 });
  expect(litCanes(steps, 5)).toEqual({ colour: "purple", count: 1 });
  expect(litCanes(steps, steps.length)).toEqual({ colour: "gold", count: 2 });
});

it("fits the success sequence for five canes in the 5000 ms hold", () => {
  expect(whichStockingLesson(0).successHoldMs).toBe(5000);
  for (let count = 1; count <= 5; count++) {
    const { popAtMs, toyAtMs, endMs } = successTimeline(count);
    expect(popAtMs).toHaveLength(count);
    expect(popAtMs[0]).toBeGreaterThanOrEqual(400);
    popAtMs.slice(1).forEach((at, index) => expect(at - popAtMs[index]).toBe(750));
    expect(toyAtMs).toBeGreaterThan(popAtMs.at(-1)!);
    expect(endMs).toBeLessThanOrEqual(5000);
  }
  expect(successTimeline(5)).toEqual({ popAtMs: [400, 1150, 1900, 2650, 3400], toyAtMs: 4150, endMs: 4850 });
});

it.each([
  ["purple", 3, "Purple has 3!"],
  ["gold", 1, "Gold has 1!"],
])("labels a success as her colour and the target", (answer, target, label) => {
  expect(whichStockingSuccessLabel({ ...node, presentation: { ...node.presentation, answer, target } })).toBe(label);
});
