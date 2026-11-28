// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SnowflakeShowdownStage } from "../app/snowflake-showdown-stage";
import {
  FLIP_MS,
  PAIRING_LEAD_MS,
  PAIRING_STEP_MS,
  SILENCE_WIGGLE_MS,
  WIGGLE_MS,
  successTimeline,
} from "../app/snowflake-showdown-timeline";
import { snowflakeShowdownLesson } from "../lib/lesson-runtime/snowflake-showdown-lesson";
import type { LessonSnapshot } from "../lib/lesson-runtime/lesson-runtime";
import type { LessonRuntimeState } from "../lib/lesson-runtime/lesson-runtime-reducer";
import type { StageMotion } from "../app/lesson-presentation";
vi.mock("next/image", () => ({ default: (props: React.ComponentProps<"img">) => createElement("img", props) }));

// Seed 0, round 5: blue 5, pink 3. Blue has more; pairing leaves blue slots 3 and 7 over.
const seed = 0;
const lesson = snowflakeShowdownLesson(seed);
const node = lesson.nodes["showdown-5"];
const numbers = /\d|\b(?:one|two|three|four|five|six)\b/i;
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

type Runtime = Partial<LessonRuntimeState> & { misses?: number };
function snapshot({ misses = 0, ...runtime }: Runtime = {}, nodeId = node.id): LessonSnapshot {
  const visitId = runtime.visitId ?? 5;
  return {
    status: "live",
    awaitingSteering: false,
    transcript: "",
    runtime: {
      runtimeId: "session",
      nodeId,
      visitId,
      phase: "active",
      pendingRender: null,
      outputActivity: "quiet",
      childSpeaking: false,
      childCandidate: null,
      childTurnId: 0,
      difficulties: Array.from({ length: misses }, () => ({ kind: "incorrect", source: { visitId } })),
      ...runtime,
    },
  } as unknown as LessonSnapshot;
}
function render(state: LessonSnapshot | null, motion: StageMotion = "calm", current = node, token?: string) {
  act(() =>
    root.render(
      createElement(SnowflakeShowdownStage, {
        seed,
        node: current,
        renderToken: token,
        snapshot: state,
        sceneRef: null,
        motion,
      }),
    ),
  );
}
const loadArt = () => act(() => container.querySelectorAll("img").forEach(img => img.dispatchEvent(new Event("load"))));
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const scene = () => container.querySelector('[role="img"]')!;
const mitten = (colour: string) => container.querySelector(`[data-colour="${colour}"]`)!;
const goldStars = () => container.querySelectorAll('[data-star="gold"]').length;
const lines = () => container.querySelectorAll("[data-line]").length;

/** Before success nothing names the side with more: no answer data, motion classes, labels or text. */
function expectNoAnswerMarker() {
  expect(scene().getAttribute("data-motion")).not.toBe("success");
  expect(container.innerHTML).not.toMatch(/data-answer|data-more|data-gap|_dance_|_flight_|_flurry_|_landed_|_react_/);
  const label = scene().getAttribute("aria-label") ?? "";
  expect(label).not.toMatch(numbers);
  expect(label).not.toMatch(/blue|pink|more|snowman's|yours/i);
  const labels = [...container.querySelectorAll("[alt], [title], [aria-label]")]
    .flatMap(element => ["alt", "title", "aria-label"].map(attr => element.getAttribute(attr) ?? ""))
    .join(" ");
  expect(labels).not.toMatch(/blue|pink|more|\d/i);
  expect(container.textContent).not.toMatch(/blue|pink|more|\d/i);
  // The snowman stays in his idle pose.
  expect(container.querySelector('[class*="layer"] img[src*="snowman"]')?.getAttribute("src")).toBe(
    "/snowflake-showdown/snowman.svg",
  );
}

it("shows round one's backs before Play, then flips both mittens together once the round renders", () => {
  render(null, "idle", lesson.nodes["showdown-1"]);
  expect(scene().getAttribute("aria-busy")).toBe("true");
  loadArt();
  expect(scene().getAttribute("aria-busy")).toBe("false");
  expect(mitten("blue").getAttribute("data-face")).toBe("back");
  expect(mitten("pink").getAttribute("data-face")).toBe("back");
  expect(container.querySelectorAll('[class*="layer"] img[src$="snowflake.svg"]')).toHaveLength(0);
  expectNoAnswerMarker();

  render(snapshot({ visitId: 1 }, "showdown-1"), "idle", lesson.nodes["showdown-1"], "visit-1");
  expect(mitten("blue").getAttribute("data-face")).toBe("turning");
  expect(mitten("pink").getAttribute("data-face")).toBe("turning");
  advance(FLIP_MS);
  expect(mitten("blue").getAttribute("data-face")).toBe("palm");
  expect(mitten("pink").getAttribute("data-face")).toBe("palm");
  // Seed 0 round 1: blue 1, pink 4.
  expect([mitten("blue").getAttribute("data-count"), mitten("pink").getAttribute("data-count")]).toEqual(["1", "4"]);
  expect(mitten("pink").querySelectorAll('img[src$="snowflake.svg"]')).toHaveLength(4);
  expectNoAnswerMarker();
});

it("pairs the snowflakes off after a miss, glows the leftovers and keeps it all through a second miss", () => {
  render(snapshot(), "idle", node, "visit-5");
  loadArt();
  advance(FLIP_MS);
  expect(scene().hasAttribute("data-pairing")).toBe(false);
  expect(lines()).toBe(0);
  expectNoAnswerMarker();

  render(snapshot({ misses: 1 }), "idle", node, "visit-5");
  expect(scene().getAttribute("data-pairing")).toBe("running");
  advance(PAIRING_LEAD_MS);
  expect(lines()).toBe(1);
  expect(container.querySelectorAll('[data-pair="0"]')).toHaveLength(2);
  expect(mitten("blue").querySelectorAll("[data-pair]")).toHaveLength(1);
  expect(mitten("pink").querySelectorAll("[data-pair]")).toHaveLength(1);
  expect(container.querySelector("[data-leftover]")).toBeNull();
  advance(PAIRING_STEP_MS);
  expect(lines()).toBe(2);
  advance(PAIRING_STEP_MS);
  expect(lines()).toBe(3);
  expect(scene().getAttribute("data-pairing")).toBe("running");
  advance(PAIRING_STEP_MS);
  expect(scene().getAttribute("data-pairing")).toBe("done");
  expect([...container.querySelectorAll("[data-leftover]")].map(item => item.closest("[data-colour]"))).toEqual([
    mitten("blue"),
    mitten("blue"),
  ]);
  expect(container.querySelectorAll("[data-pair]")).toHaveLength(6);
  // The pairing never names the side: only the on-screen leftovers carry a marker.
  expectNoAnswerMarker();

  // A second miss keeps the pairing where it is while the tutor counts both.
  render(snapshot({ misses: 2 }), "idle", node, "visit-5");
  expect(scene().getAttribute("data-pairing")).toBe("done");
  expect(lines()).toBe(3);
  expect(container.querySelectorAll("[data-leftover]")).toHaveLength(2);
  advance(5_000);
  expect(lines()).toBe(3);
});

it("wiggles both mittens after five quiet seconds, restarting the wait on activity, at most three times", () => {
  render(snapshot(), "idle", node, "visit-5");
  loadArt();
  advance(FLIP_MS);
  advance(SILENCE_WIGGLE_MS - 1_000);
  // The tutor speaks, then goes quiet: the wait starts over.
  render(snapshot({ outputActivity: "active" }), "idle", node, "visit-5");
  advance(2_000);
  render(snapshot({ outputActivity: "quiet" }), "idle", node, "visit-5");
  advance(SILENCE_WIGGLE_MS - 1);
  expect(scene().hasAttribute("data-wiggle")).toBe(false);
  advance(1);
  expect(scene().getAttribute("data-wiggle")).toBe("1");
  expect(mitten("blue").className).toMatch(/wiggle/);
  expect(mitten("pink").className).toMatch(/wiggle/);
  advance(WIGGLE_MS);
  expect(scene().hasAttribute("data-wiggle")).toBe(false);

  // Her speech cancels the next one; it comes five seconds after her turn ends.
  advance(3_000);
  render(snapshot({ childSpeaking: true, childTurnId: 1 }), "calm", node, "visit-5");
  advance(4_000);
  render(snapshot({ childTurnId: 1 }), "idle", node, "visit-5");
  advance(SILENCE_WIGGLE_MS - 1);
  expect(scene().hasAttribute("data-wiggle")).toBe(false);
  advance(1);
  expect(scene().getAttribute("data-wiggle")).toBe("2");
  advance(SILENCE_WIGGLE_MS);
  expect(scene().getAttribute("data-wiggle")).toBe("3");
  advance(SILENCE_WIGGLE_MS * 3);
  expect(scene().hasAttribute("data-wiggle")).toBe(false);
});

it("dances the mitten with more, flies the star in and turns it gold, and keeps the next round loaded", () => {
  render(snapshot(), "idle", node, "visit-5");
  loadArt();
  advance(FLIP_MS);
  expect(goldStars()).toBe(4);

  render(snapshot(), "success", node, "visit-5");
  expect(scene().getAttribute("data-motion")).toBe("success");
  expect(mitten("blue").className).toMatch(/dance/);
  expect(mitten("pink").className).not.toMatch(/dance/);
  // Blue has more: the snowman claps.
  expect(container.querySelector('[class*="layer"] img[src*="snowman"]')?.getAttribute("src")).toBe(
    "/snowflake-showdown/snowman-clap.svg",
  );
  expect(container.querySelectorAll('[class*="flight"]')).toHaveLength(1);
  expect(goldStars()).toBe(4);
  advance(successTimeline().starGoldAtMs);
  expect(goldStars()).toBe(5);
  expect(container.querySelectorAll('[class*="flight"]')).toHaveLength(0);
  expect(container.querySelectorAll('[class*="landed"]')).toHaveLength(1);
  // Only the third clean round in a row has a flurry.
  expect(container.querySelector('[class*="flurry"]')).toBeNull();

  const next = lesson.nodes["showdown-6"];
  render(snapshot({ visitId: 6 }, next.id), "idle", next, "visit-6");
  expect(scene().getAttribute("data-node-id")).toBe("showdown-6");
  expect(scene().getAttribute("aria-busy")).toBe("false");
  expect(container.textContent).not.toContain("Getting the picture ready");
  expect(goldStars()).toBe(5);
  expect(mitten("blue").getAttribute("data-face")).toBe("turning");
});

it("blows a flurry during the third clean success in a row, and the snowman shrugs when pink has more", () => {
  const play = (round: number, motion: StageMotion) => {
    const current = lesson.nodes[`showdown-${round}`];
    render(snapshot({ visitId: round }, current.id), motion, current, `visit-${round}`);
  };
  play(1, "idle");
  loadArt();
  for (const round of [1, 2, 3]) {
    play(round, "idle");
    advance(FLIP_MS);
    play(round, "success");
    if (round < 3) expect(container.querySelector('[class*="flurry"]')).toBeNull();
  }
  expect(container.querySelectorAll('[class*="flurry"]')).toHaveLength(1);
  // Seed 0 round 3 is blue 4, pink 1; round 2 was pink 6, blue 1.
  play(4, "idle");
  advance(FLIP_MS);
  play(4, "success");
  expect(container.querySelector('[class*="layer"] img[src*="snowman"]')?.getAttribute("src")).toBe(
    "/snowflake-showdown/snowman-shrug.svg",
  );
  expect(mitten("pink").className).toMatch(/dance/);
  expect(container.querySelector('[class*="flurry"]')).toBeNull();
});

it("renders the finale with every star gold, the big snowflake, dancing and a caption", () => {
  render(snapshot(), "celebrate", null as never, "done");
  loadArt();
  expect(scene().getAttribute("data-node-id")).toBe("complete");
  expect(scene().getAttribute("data-scene-id")).toBe("complete");
  expect(scene().getAttribute("aria-busy")).toBe("false");
  expect(goldStars()).toBe(10);
  expect(container.querySelectorAll('[data-star="pale"]')).toHaveLength(0);
  expect(mitten("blue").className).toMatch(/party/);
  expect(mitten("pink").className).toMatch(/party/);
  expect(container.querySelector('[class*="layer"] img[src*="snowman"]')?.getAttribute("src")).toBe(
    "/snowflake-showdown/snowman-dance.svg",
  );
  expect(container.querySelectorAll('[class*="bigFlake"]')).toHaveLength(1);
  expect(container.textContent).toContain("All ten stars are yours!");
});
