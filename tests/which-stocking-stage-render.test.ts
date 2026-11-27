// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WhichStockingStage } from "../app/which-stocking-stage";
import { highlightSequence } from "../app/which-stocking-timeline";
import { whichStockingLesson } from "../lib/lesson-runtime/which-stocking-lesson";
import type { LessonSnapshot } from "../lib/lesson-runtime/lesson-runtime";
import type { StageMotion } from "../app/lesson-presentation";
vi.mock("next/image", () => ({ default: (props: React.ComponentProps<"img">) => createElement("img", props) }));

// Seed 0, round 4: pink 4, purple 5, gold 2 (the answer, target 2).
const lesson = whichStockingLesson(0);
const node = lesson.nodes["stocking-4"];
const numbers = /\d|\b(?:one|two|three|four|five)\b/i;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "debug").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Miss = { kind: string; source: { visitId: number } };
function snapshot(transcript: string, misses: number, nodeId = node.id): LessonSnapshot {
  const difficulties: Miss[] = Array.from({ length: misses }, () => ({ kind: "incorrect", source: { visitId: 4 } }));
  return {
    status: "live",
    awaitingSteering: false,
    transcript,
    runtime: { runtimeId: "session", nodeId, visitId: 4, phase: "active", pendingRender: null, difficulties },
  } as unknown as LessonSnapshot;
}
function render(state: LessonSnapshot, motion: StageMotion = "calm", current = node, token = "visit-4") {
  act(() =>
    root.render(
      createElement(WhichStockingStage, { node: current, renderToken: token, snapshot: state, sceneRef: null, motion }),
    ),
  );
}
const scene = () => container.querySelector('[role="img"]')!;
const stocking = (colour: string) => container.querySelector(`[data-colour="${colour}"]`)!;
const lit = (colour: string) => stocking(colour).querySelectorAll("[data-lit]").length;
function expectNoAnswerMarker() {
  expect(container.querySelector("[data-hint]")).toBeNull();
  expect(container.innerHTML).not.toMatch(/data-answer|jiggle|pop|drop/);
  expect(scene().getAttribute("aria-label")).not.toMatch(numbers);
  expect(scene().getAttribute("aria-label")).not.toMatch(/pink|purple|gold/i);
  const labels = [...container.querySelectorAll("[alt], [title], [aria-label]")].flatMap(element =>
    ["alt", "title", "aria-label"].map(attr => element.getAttribute(attr) ?? ""),
  );
  expect(labels.join(" ")).not.toMatch(/gold|\b2\b|two/i);
  expect(container.textContent).not.toMatch(/gold|\b2\b|two/i);
}

it("marks nothing before two misses, then lights her pick and later glows only the right stocking", () => {
  render(snapshot("", 0));
  expect(scene().getAttribute("data-scene-id")).toBe("which-stocking");
  expect([...container.querySelectorAll("[data-colour]")].map(item => item.getAttribute("data-colour"))).toEqual([
    "pink",
    "purple",
    "gold",
  ]);
  expect([...container.querySelectorAll("[data-count]")].map(item => item.getAttribute("data-count"))).toEqual([
    "4",
    "5",
    "2",
  ]);
  expectNoAnswerMarker();

  // First miss: she said purple. Its canes light about once a second; data-picked marks her pick only.
  render(snapshot("Tutor: Two!\nChild: purple", 1));
  expect(stocking("purple").getAttribute("data-picked")).toBe("purple");
  expect(container.querySelectorAll("[data-picked]")).toHaveLength(1);
  expectNoAnswerMarker();
  act(() => vi.advanceTimersByTime(500));
  expect(lit("purple")).toBe(1);
  act(() => vi.advanceTimersByTime(2000));
  expect(lit("purple")).toBe(3);
  expect(lit("pink") + lit("gold")).toBe(0);
  // The tutor's reply naming her pick does not change the highlight.
  render(snapshot("Tutor: Two!\nChild: purple\nTutor: Purple has five.", 1));
  expect(stocking("purple").getAttribute("data-picked")).toBe("purple");
  act(() => vi.advanceTimersByTime(4000));
  expect(container.querySelector("[data-picked]")).toBeNull();
  expect(container.querySelector("[data-lit]")).toBeNull();
  expectNoAnswerMarker();

  // Second miss: each stocking in turn, left to right, then the right one glows.
  render(snapshot("Tutor: Two!\nChild: purple\nTutor: Purple has five.\nChild: pink", 2));
  expect(container.querySelector("[data-picked]")).toBeNull();
  expect(container.querySelector("[data-hint]")).toBeNull();
  const { steps, endMs } = highlightSequence({ kind: "sweep", miss: 2 }, node);
  act(() => vi.advanceTimersByTime(steps[3].atMs));
  expect([lit("pink"), lit("purple"), lit("gold")]).toEqual([4, 0, 0]);
  act(() => vi.advanceTimersByTime(steps[4].atMs - steps[3].atMs));
  expect([lit("pink"), lit("purple"), lit("gold")]).toEqual([0, 1, 0]);
  expect(container.querySelector("[data-hint]")).toBeNull();
  act(() => vi.advanceTimersByTime(endMs - steps[4].atMs));
  expect(container.querySelectorAll('[data-hint="glow"]')).toHaveLength(1);
  expect(stocking("gold").getAttribute("data-hint")).toBe("glow");
  expect(container.querySelector("[data-lit]")).toBeNull();
});

it("shows no highlight when she names a colour that is not on screen", () => {
  render(snapshot("", 0));
  render(snapshot("Child: blue", 1));
  act(() => vi.advanceTimersByTime(3000));
  expect(container.querySelector("[data-picked]")).toBeNull();
  expect(container.querySelector("[data-lit]")).toBeNull();
  expect(scene().hasAttribute("data-highlight")).toBe(false);
  expect(console.debug).toHaveBeenCalledWith(expect.stringContaining("no stocking"), { miss: 1 });
});

it("pops the right stocking on success and keeps a second round's render free of the loading cover", () => {
  render(snapshot("", 0));
  expect(scene().getAttribute("aria-busy")).toBe("true");
  expect(container.textContent).toContain("Getting the picture ready");
  act(() => container.querySelectorAll("img").forEach(img => img.dispatchEvent(new Event("load"))));
  expect(scene().getAttribute("aria-busy")).toBe("false");
  render(snapshot("Child: gold", 0), "success");
  expect(scene().getAttribute("data-motion")).toBe("success");
  expect(stocking("gold").className).toMatch(/jiggle/);
  expect(stocking("gold").querySelectorAll('[class*="pop"]')).toHaveLength(2);
  expect(stocking("pink").className).not.toMatch(/jiggle/);
  expect(container.querySelectorAll('[class*="drop"]')).toHaveLength(1);

  const next = lesson.nodes["stocking-5"];
  render(snapshot("", 0, next.id), "calm", next, "visit-5");
  expect(scene().getAttribute("data-node-id")).toBe("stocking-5");
  expect(scene().getAttribute("aria-busy")).toBe("false");
  expect(container.textContent).not.toContain("Getting the picture ready");
});

it("renders the finale with full stockings, the whole pile and a caption", () => {
  render(snapshot("", 0), "celebrate", null as never, "done");
  act(() => container.querySelectorAll("img").forEach(img => img.dispatchEvent(new Event("load"))));
  expect(scene().getAttribute("data-node-id")).toBe("complete");
  expect(scene().getAttribute("data-scene-id")).toBe("complete");
  expect([...container.querySelectorAll("[data-count]")].map(item => item.getAttribute("data-count"))).toEqual([
    "5",
    "5",
    "5",
  ]);
  expect(container.querySelectorAll('[class*="layer"] img[src*="toy-"]')).toHaveLength(8);
  expect(container.textContent).toContain("Every stocking is full!");
  expect(scene().getAttribute("aria-busy")).toBe("false");
});
