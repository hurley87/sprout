import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CountingStage } from "../app/counting-stage";
import { GARDEN_THEME } from "../app/counting-themes";
import { gardenEffectKey, gardenEffectState } from "../app/garden-rescue-game";
import { GARDEN_RESCUE_LESSON, GARDEN_RESCUE_NODE_IDS } from "../lib/lesson-runtime/garden-rescue-lesson";
import { runtimeSource } from "../lib/lesson-runtime/lesson-runtime-reducer";
import type { LessonSnapshot } from "../lib/lesson-runtime/lesson-runtime";
import { createReducerHarness, prepareLearnerClassification } from "./helpers/runtime-harness";

function scenario() {
  const harness = createReducerHarness("run", { lesson: GARDEN_RESCUE_LESSON, quietDrainMs: 100 });
  const snapshot = (): LessonSnapshot => ({
    status: "live",
    error: null,
    awaitingSteering: false,
    transcript: "",
    diagnostics: [],
    display: { token: "run:initial", nodeId: GARDEN_RESCUE_NODE_IDS[0], sceneId: GARDEN_RESCUE_NODE_IDS[0] },
    runtime: harness.state,
  });
  const source = prepareLearnerClassification(harness, 1);
  harness.send({
    type: "proposal.received",
    source,
    proposal: {
      nodeId: source.nodeId,
      transcriptRevision: source.transcriptRevision,
      childActivity: "unknown",
      answerOutcome: "correct",
      answerCommitment: "committed",
      supportState: "none",
      tutorState: "listening",
    },
  });
  harness.send({ type: "output.activity", source: runtimeSource(harness.state), state: "active" });
  return { harness, snapshot };
}

describe("garden effect state", () => {
  it("plays only in the success window and resets on renewed speech", () => {
    expect(gardenEffectState(null)).toBe("before");
    const { harness, snapshot } = scenario();
    expect(gardenEffectState(snapshot())).toBe("playing");
    harness.send({ type: "child.turn.started", source: runtimeSource(harness.state) });
    expect(gardenEffectState(snapshot())).toBe("before");
  });

  it("holds only the displayed origin visit while rendering", () => {
    const { harness, snapshot } = scenario();
    const key = gardenEffectKey(snapshot());
    harness.send({ type: "output.activity", source: runtimeSource(harness.state), state: "quiet" });
    harness.send({ type: "clock.tick", source: runtimeSource(harness.state) }, 150);
    const rendering = snapshot();
    expect(rendering.runtime?.phase).toBe("rendering");
    expect(rendering.runtime?.visitId).toBe(2);
    expect(rendering.runtime?.pendingRender?.origin.visitId).toBe(1);
    expect(gardenEffectState(rendering)).toBe("held");
    expect(gardenEffectKey(rendering)).toBe(key);
    expect(
      gardenEffectState({ ...rendering, display: { ...rendering.display, nodeId: GARDEN_RESCUE_NODE_IDS[1] } }),
    ).toBe("before");
    expect(
      gardenEffectState({
        ...rendering,
        runtime: {
          ...rendering.runtime!,
          pendingRender: {
            ...rendering.runtime!.pendingRender!,
            origin: { ...rendering.runtime!.pendingRender!.origin, runtimeId: "stale-run" },
          },
        },
      }),
    ).toBe("before");
    expect(gardenEffectState({ ...rendering, error: "failure" })).toBe("before");
    expect(gardenEffectState({ ...rendering, status: "ended" })).toBe("before");
    harness.send({ type: "stop", runtimeId: "run" });
    expect(gardenEffectState(snapshot())).toBe("before");
    expect(gardenEffectKey({ ...rendering, runtime: { ...rendering.runtime!, runtimeId: "new-run" } })).not.toBe(key);
  });
});

describe("counting world effect layer", () => {
  it("is opt-in and keeps decorative props out of the artwork gate", () => {
    const node = { id: "test", sceneId: "test", object: "duck", quantity: 1 };
    const theme = {
      ...GARDEN_THEME,
      scenes: {
        test: {
          background: "pond",
          object: "duck",
          objects: [{ asset: "duck", x: 0.5, y: 0.5, width: 0.2 }],
          effect: { id: "crossing", props: [{ asset: "flower", x: 0.3, y: 0.4, width: 0.1 }] },
        },
      },
    };
    const render = (state?: "before" | "playing" | "held") =>
      renderToStaticMarkup(
        createElement(CountingStage, { theme, node, ...(state ? { effect: { state, key: "visit" } } : {}) }),
      );
    const plain = render();
    expect(plain).not.toMatch(/data-world-effect|data-world-prop|data-effect-state/);
    const before = render("before");
    expect(before).toContain('data-world-effect="crossing"');
    expect(before).not.toContain("data-world-prop");
    expect(before).toContain("/counting/flower.svg");
    for (const state of ["playing", "held"] as const) {
      const markup = render(state);
      expect(markup).toContain('data-world-prop="flower"');
      expect(markup.indexOf('data-world-prop="flower"')).toBeLessThan(markup.indexOf('data-counting-object="duck"'));
      expect(markup.match(/data-counting-object=/g)).toHaveLength(1);
      expect(markup).toContain('aria-busy="true"');
    }
  });
});
