// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DinoStage } from "../app/dino-stage";
import { DINO_CAR_CRUNCH_LESSON } from "../lib/lesson-runtime/dino-car-crunch-lesson";
import type { LessonSnapshot } from "../lib/lesson-runtime/lesson-runtime";

vi.mock("next/image", () => ({ default: () => null }));

describe("dino stage effects", () => {
  const node = DINO_CAR_CRUNCH_LESSON.nodes["twenty-three"];
  const play = vi.fn();
  const gate = vi.fn(() => true);
  const sfx = { play, unlock: vi.fn() };
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  function render(
    motion: "calm" | "success" | "celebrate",
    activity: string,
    token = "visit",
    finale = false,
    phase = finale ? "complete" : "active",
  ) {
    const snapshot = { runtime: { outputActivity: activity, phase } } as LessonSnapshot;
    act(() =>
      root.render(
        createElement(DinoStage, {
          node: finale ? null : node,
          renderToken: token,
          motion,
          snapshot,
          sfx,
          playEffect: gate,
        }),
      ),
    );
  }
  it("requests arrivals once and waits for quiet before chomping once per visit", () => {
    // The runtime refuses effects while the scene is still rendering, so the arrival waits for "active".
    render("calm", "quiet", "visit", false, "rendering");
    expect(play).not.toHaveBeenCalled();
    render("calm", "quiet");
    expect(play).toHaveBeenCalledExactlyOnceWith("truck-rumble", gate);
    render("success", "active");
    expect(container.firstElementChild?.getAttribute("data-chomp")).toBe("idle");
    expect(play).toHaveBeenCalledTimes(1);
    render("success", "quiet");
    expect(container.firstElementChild?.getAttribute("data-chomp")).toBe("eating");
    expect(play).toHaveBeenLastCalledWith("crunch", gate);
    render("success", "quiet");
    expect(play).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(1500));
    expect(container.firstElementChild?.getAttribute("data-chomp")).toBe("done");
    expect(container.firstElementChild?.getAttribute("data-rex")).toBe("hungry");
    render("success", "quiet", "next");
    expect(play).toHaveBeenCalledTimes(4);
  });
  it("requests the finale once", () => {
    render("celebrate", "active", "finale", true);
    expect(play).not.toHaveBeenCalled();
    render("celebrate", "quiet", "finale", true);
    render("celebrate", "quiet", "finale", true);
    expect(play).toHaveBeenCalledExactlyOnceWith("success", gate);
  });
});
