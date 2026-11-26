// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CHRISTMAS_TREE_ICONS, christmasTreePlacements } from "../app/christmas-tree-scene";
import { ChristmasTreeStage } from "../app/christmas-tree-stage";
import {
  CHRISTMAS_TREE_KINDS,
  christmasTreeArrangement,
  type ChristmasTreeKind,
} from "../lib/lesson-runtime/christmas-tree-arrangement";
import {
  CHRISTMAS_TREE_NAMES,
  CHRISTMAS_TREE_NODE_IDS,
  christmasTreeLesson,
} from "../lib/lesson-runtime/christmas-tree-lesson";
import type { LessonNodeDefinition } from "../lib/lesson-runtime/lesson-definition";

const numbers =
  /\d|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen)\b/i;

function renderStage(seed: number, node: LessonNodeDefinition | null) {
  const markup = renderToStaticMarkup(
    createElement(ChristmasTreeStage, { seed, node, renderToken: "round-token", motion: node ? "calm" : "celebrate" }),
  );
  const document = new DOMParser().parseFromString(markup, "text/html");
  return { document, stage: document.querySelector<HTMLDivElement>('[role="img"]')! };
}

describe.each([0, 1, 42, 99])("Christmas tree stage with seed %i", seed => {
  const arrangement = christmasTreeArrangement(seed);
  const { nodes } = christmasTreeLesson(seed);

  it.each([...CHRISTMAS_TREE_NODE_IDS, null])("renders the whole scene and render identity for %s", nodeId => {
    const node = nodeId ? nodes[nodeId] : null;
    const { document, stage } = renderStage(seed, node);

    expect(stage.dataset.renderToken).toBe("round-token");
    expect(stage.dataset.nodeId).toBe(nodeId ?? "complete");
    expect(stage.dataset.sceneId).toBe(node ? "christmas-tree" : "complete");
    expect(stage.dataset.motion).toBe(node ? "calm" : "celebrate");
    expect(stage.getAttribute("aria-busy")).toBe("true");
    expect(stage.querySelector('[data-artwork-state="loading"]')).toBeTruthy();

    for (const kind of CHRISTMAS_TREE_KINDS) {
      const items = Array.from(stage.querySelectorAll<HTMLElement>(`[data-kind="${kind}"]`));
      expect(items).toHaveLength(arrangement.counts[kind]);
      expect(items.map(item => Number(item.dataset.slot))).toEqual(arrangement.slots[kind]);
      expect(items.every(item => item.dataset.asked === String(kind === node?.presentation.kind))).toBe(true);
    }

    const cue = document.querySelector("[data-picture-cue]");
    if (node) {
      const kind = node.presentation.kind as ChristmasTreeKind;
      expect(cue?.getAttribute("data-picture-cue")).toBe(kind);
      expect(cue?.hasAttribute("data-opening-cue")).toBe(nodeId === CHRISTMAS_TREE_NODE_IDS[0]);
      const icon = cue?.querySelector(`img[src="/christmas-tree/${CHRISTMAS_TREE_ICONS[kind]}.svg"]`);
      expect(icon?.getAttribute("alt")).toBe(CHRISTMAS_TREE_NAMES[kind].plural);
      const asked = christmasTreePlacements(arrangement)
        .filter(item => item.kind === kind)
        .sort((a, b) => a.placement.y - b.placement.y || a.placement.x - b.placement.x);
      for (const [index, { slot }] of asked.entries()) {
        const item = stage.querySelector<HTMLElement>(`[data-asked="true"][data-slot="${slot}"]`);
        expect(item?.style.getPropertyValue("--order")).toBe(String(index));
      }
    } else {
      expect(cue).toBeNull();
      expect(stage.querySelector("p")?.textContent).toBe("Beautiful work!");
    }

    expect(stage.getAttribute("aria-label")).toBe(
      node
        ? "A decorated Christmas tree in a living room with baubles, candy canes, gingerbread men and presents"
        : "The decorated Christmas tree with a shining star and a snowy living room window",
    );
    expect(document.body.textContent).not.toMatch(numbers);
    for (const labelled of document.querySelectorAll("[aria-label], [alt]")) {
      expect(labelled.getAttribute("aria-label") ?? labelled.getAttribute("alt")).not.toMatch(numbers);
    }
    expect(stage.querySelector("[data-answer], [data-count], [data-counts], [data-quantity]")).toBeNull();
  });
});
