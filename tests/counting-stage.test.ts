import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { CountingStage } from "../app/counting-stage";
import { COUNTING_SCENES, countingScene } from "../app/counting-scenes";
import { COUNTING_LESSON_GRAPH } from "../lib/lesson-runtime/counting-lesson";

describe("authored counting artwork", () => {
  it.each(Object.values(COUNTING_LESSON_GRAPH))("matches $id without displaying its answer", node => {
    const markup = renderToStaticMarkup(createElement(CountingStage, { node, renderToken: "exact-token" }));
    expect(markup.match(/data-counting-object=/g)).toHaveLength(node.quantity);
    expect(markup.match(new RegExp(`data-counting-object="${node.object}"`, "g"))).toHaveLength(node.quantity);
    expect(markup).toContain(`data-node-id="${node.id}"`);
    expect(markup).toContain(`data-scene-id="${node.sceneId}"`);
    expect(markup).toContain('data-render-token="exact-token"');
    expect(markup).toContain('data-counting-objects="true"');
    expect(markup).toContain(`data-background="${node.object === "duck" ? "pond" : "garden"}"`);
    expect(markup).toContain(`aria-label="${node.quantity} ${node.object}${node.quantity === 1 ? "" : "s"} to count"`);
    expect(markup.replace(/<[^>]*>/g, "")).not.toMatch(/\d|one|two|three|four/i);
    expect(markup).not.toMatch(/🦆|🦋|<button|\/Downloads\//);
    const images = markup.match(/<img\b[^>]*>/g)!;
    // The flower meadow is drawn in CSS so no baked-in flowers compete with the counted ones.
    expect(images).toHaveLength(node.quantity + (node.sceneId === "flowers-bloom" ? 0 : 1));
    for (const image of images) expect(image).toContain('alt=""');
  });

  it("keeps all character boxes in bounds and apart in the normalized stage", () => {
    for (const scene of Object.values(COUNTING_SCENES)) {
      const boxes = scene.objects.map(object => {
        const height = object.width * (object.asset === "flower" ? 320 / 280 : 1) * (8 / 5);
        return {
          left: object.x - object.width / 2,
          right: object.x + object.width / 2,
          top: object.y - height / 2,
          bottom: object.y + height / 2,
        };
      });
      for (const [index, box] of boxes.entries()) {
        expect(Math.min(box.left, box.top)).toBeGreaterThanOrEqual(0);
        expect(Math.max(box.right, box.bottom)).toBeLessThanOrEqual(1);
        for (const other of boxes.slice(index + 1)) {
          expect(
            box.right <= other.left || other.right <= box.left || box.bottom <= other.top || other.bottom <= box.top,
          ).toBe(true);
        }
      }
    }
  });

  it("shows four separate flowers on the flower node without baked-in decorative flowers", () => {
    const node = COUNTING_LESSON_GRAPH["count-4-flowers"];
    const markup = renderToStaticMarkup(createElement(CountingStage, { node }));
    expect(markup.match(/data-counting-object="flower"/g)).toHaveLength(4);
    expect(markup.match(/src="\/counting\/flower.svg"/g)).toHaveLength(4);
    expect(markup).toContain('data-flower-free="true"');
    expect(markup).not.toContain("/counting/garden.svg");
  });

  it("authors exactly one layout per lesson scene, with matching kind and quantity", () => {
    const nodes = Object.values(COUNTING_LESSON_GRAPH);
    expect(Object.keys(COUNTING_SCENES).sort()).toEqual(nodes.map(node => node.sceneId).sort());
    for (const node of nodes) {
      const scene = countingScene(node);
      expect(scene.object).toBe(node.object);
      expect(scene.objects).toHaveLength(node.quantity);
    }
  });

  it("rearranges the familiar butterfly group rather than reusing its layout", () => {
    const familiar = countingScene(COUNTING_LESSON_GRAPH["count-3-butterflies"]);
    const moved = countingScene(COUNTING_LESSON_GRAPH["count-3-moved-butterflies"]);
    expect(moved.objects).toHaveLength(familiar.objects.length);
    for (const object of moved.objects)
      expect(familiar.objects.some(other => other.x === object.x && other.y === object.y)).toBe(false);
    const ducklings = countingScene(COUNTING_LESSON_GRAPH["count-3-ducklings"]);
    const friends = countingScene(COUNTING_LESSON_GRAPH["count-2-ducks"]);
    expect(ducklings.background).toBe("pond");
    for (const object of ducklings.objects)
      expect(friends.objects.some(other => other.x === object.x && other.y === object.y)).toBe(false);
  });

  it("rejects missing artwork or quantity/kind drift instead of silently showing the wrong count", () => {
    expect(() => countingScene({ sceneId: "unknown", object: "duck", quantity: 1 })).toThrow(/authored scene/);
    expect(() => countingScene({ sceneId: "hello-duck", object: "duck", quantity: 2 })).toThrow(/authored scene/);
    expect(() => countingScene({ sceneId: "hello-duck", object: "flower", quantity: 1 })).toThrow(/authored scene/);
  });

  it("ships each independent asset and keeps completion free of countable objects", () => {
    for (const asset of [
      "duck",
      "butterfly-coral",
      "butterfly-sky",
      "butterfly-lavender",
      "flower",
      "pond",
      "garden",
    ]) {
      expect(readFileSync(`public/counting/${asset}.svg`, "utf8")).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    }
    const markup = renderToStaticMarkup(createElement(CountingStage, { node: null }));
    expect(markup).toContain("Garden celebration!");
    expect(markup).toContain('aria-label="Lesson complete"');
    expect(markup).toContain('data-background="garden"');
    expect(markup).not.toContain("data-counting-object");
    expect(markup.match(/data-celebration-flower=/g)).toHaveLength(4);
    expect(markup.replace(/<[^>]*>/g, "")).not.toMatch(/\d|one|two|three|four/i);
  });

  it("renders the authored numeral only during success", () => {
    for (const node of Object.values(COUNTING_LESSON_GRAPH)) {
      for (const motion of ["idle", "calm", "success"] as const) {
        const markup = renderToStaticMarkup(createElement(CountingStage, { node, motion }));
        if (motion === "success") expect(markup).toContain(`data-success-numeral="true">${node.quantity}</div>`);
        else expect(markup).not.toContain("data-success-numeral");
      }
    }
  });
});
