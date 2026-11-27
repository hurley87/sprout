// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DownTheChimneyStage } from "../app/down-the-chimney-stage";
import { countAlongDuration } from "../app/down-the-chimney-timeline";
import { downTheChimneyLesson } from "../lib/lesson-runtime/down-the-chimney-lesson";
import type { LessonSnapshot } from "../lib/lesson-runtime/lesson-runtime";
vi.mock("next/image", () => ({ default: (props: React.ComponentProps<"img">) => createElement("img", props) }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("gates drops on render and quiet, protects labels, and requests the count-along window", () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const node = downTheChimneyLesson(0).nodes["chimney-2"];
  const begin = vi.fn(() => true);
  const snapshot = {
    status: "live",
    awaitingSteering: false,
    runtime: {
      runtimeId: "session",
      nodeId: node.id,
      visitId: 2,
      phase: "active",
      outputActivity: "quiet",
      pendingRender: null,
      childTurnId: 0,
      transcriptRevision: 0,
    },
  } as unknown as LessonSnapshot;
  act(() =>
    root.render(
      createElement(DownTheChimneyStage, {
        node,
        renderToken: "visit",
        snapshot,
        sceneRef: null,
        motion: "calm",
        beginCountAlong: begin,
      }),
    ),
  );
  const stage = container.querySelector('[role="img"]')!;
  expect(stage.getAttribute("aria-label")).not.toMatch(/\d|\bone\b|\btwo\b|\bthree\b/i);
  expect(begin).not.toHaveBeenCalled();
  act(() => {
    container.querySelectorAll("img").forEach(img => img.dispatchEvent(new Event("load")));
  });
  act(() => vi.advanceTimersByTime(1000));
  expect(begin).toHaveBeenCalledExactlyOnceWith("drops", countAlongDuration(Number(node.presentation.quantity), 1500));
  expect(container.querySelector('[data-phase="dropping"]')).not.toBeNull();
  const second = downTheChimneyLesson(0).nodes["chimney-3"];
  act(() =>
    root.render(
      createElement(DownTheChimneyStage, {
        node: second,
        renderToken: "visit-2",
        snapshot: { ...snapshot, runtime: { ...snapshot.runtime!, nodeId: second.id } },
        sceneRef: null,
        motion: "calm",
        beginCountAlong: begin,
      }),
    ),
  );
  expect(container.querySelector('[role="img"]')?.getAttribute("aria-busy")).toBe("false");
  expect(container.textContent).not.toContain("Getting the picture ready");
  act(() => root.unmount());
  container.remove();
});

it("restarts silence after an unclear child turn and after tutor output", () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const node = downTheChimneyLesson(0).nodes["chimney-2"];
  let runtime = {
    runtimeId: "silence",
    nodeId: node.id,
    visitId: 2,
    phase: "active",
    outputActivity: "quiet",
    pendingRender: null,
    childTurnId: 0,
    transcriptRevision: 0,
    childSpeaking: false,
  };
  const render = () =>
    root.render(
      createElement(DownTheChimneyStage, {
        node,
        renderToken: "visit",
        snapshot: { status: "live", awaitingSteering: false, runtime } as unknown as LessonSnapshot,
        sceneRef: null,
        motion: "calm",
        beginCountAlong: () => true,
      }),
    );
  const phase = () => container.querySelector('[role="img"]')?.getAttribute("data-phase");
  act(render);
  act(() => container.querySelectorAll("img").forEach(img => img.dispatchEvent(new Event("load"))));
  act(() => vi.advanceTimersByTime(1000));
  act(() => vi.advanceTimersByTime(countAlongDuration(Number(node.presentation.quantity), 1500)));
  expect(phase()).toBe("waiting");
  act(() => vi.advanceTimersByTime(5000));
  act(() => {
    runtime = { ...runtime, childSpeaking: true, childTurnId: 1, transcriptRevision: 1 };
    render();
  });
  act(() => vi.advanceTimersByTime(2000));
  act(() => {
    runtime = { ...runtime, childSpeaking: false };
    render();
  });
  act(() => vi.advanceTimersByTime(5000));
  expect(phase()).toBe("waiting");
  act(() => {
    runtime = { ...runtime, outputActivity: "active" };
    render();
  });
  act(() => vi.advanceTimersByTime(2000));
  act(() => {
    runtime = { ...runtime, outputActivity: "quiet" };
    render();
  });
  act(() => vi.advanceTimersByTime(5999));
  expect(phase()).toBe("waiting");
  act(() => vi.advanceTimersByTime(1));
  expect(phase()).toBe("peering");
  act(() => root.unmount());
  container.remove();
});
