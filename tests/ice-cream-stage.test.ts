import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ICE_CREAM_LESSON } from "../lib/lesson-runtime/ice-cream-lesson";
import { ICE_CREAM_FINALE, ICE_CREAM_SCENES, iceCreamScene } from "../app/ice-cream-scenes";
import { IceCreamStage } from "../app/ice-cream-stage";
import { iceCreamSuccessLabel } from "../app/ice-cream-theme";

describe("ice cream artwork", () => {
  const nodes = Object.values(ICE_CREAM_LESSON.nodes);
  it.each(nodes)("validates $id and keeps its count out of the scene label", node => {
    const scene = iceCreamScene(node);
    const markup = renderToStaticMarkup(createElement(IceCreamStage, { node, renderToken: "token" }));
    expect(markup).toContain(`data-scene-id="${node.presentation.sceneId}"`);
    expect(markup).toContain('data-render-token="token"');
    if (node.presentation.answerKind === "count") {
      expect(scene.label).not.toMatch(/\b(?:two|three|2|3)\b/i);
      const object =
        node.presentation.object === "cone"
          ? "cone"
          : node.presentation.object === "pink scoop"
            ? "scoop-pink"
            : "scoop-";
      expect(scene.objects.filter(item => item.asset.startsWith(object) && !item.tub)).toHaveLength(
        Number(node.presentation.quantity),
      );
    }
  });
  it("rejects altered facts and object arrangements", () => {
    const node = ICE_CREAM_LESSON.nodes["count-pink"];
    expect(() => iceCreamScene({ ...node, presentation: { ...node.presentation, quantity: 3 } })).toThrow();
    expect(() =>
      iceCreamScene(node, { ...ICE_CREAM_SCENES, "pink-scoops": { ...ICE_CREAM_SCENES["pink-scoops"], objects: [] } }),
    ).toThrow();
    expect(() => iceCreamScene({ ...node, presentation: { ...node.presentation, sceneId: "missing" } })).toThrow();
  });
  it("matches colour and accepted order facts", () => {
    const scoops = (id: string) =>
      ICE_CREAM_SCENES[id].objects.filter(item => item.asset.startsWith("scoop-") && !item.tub).map(item => item.asset);
    expect(scoops("pink-scoop")).toEqual(["scoop-pink"]);
    expect(scoops("pink-scoops")).toEqual(["scoop-pink", "scoop-yellow", "scoop-pink"]);
    expect(scoops("build-first")).toEqual([]);
    expect(scoops("build-second")).toEqual(["scoop-pink"]);
    expect(scoops("tall-cone")).toEqual(["scoop-pink", "scoop-yellow", "scoop-chocolate"]);
  });
  it.each(nodes)("lands only accepted order scoops for $id", node => {
    const render = (motion: "calm" | "success") => renderToStaticMarkup(createElement(IceCreamStage, { node, motion }));
    expect(render("calm")).not.toContain("data-landing=");
    const success = render("success");
    expect(success.includes('data-landing="true"')).toBe(node.presentation.answerKind === "order_step");
    if (node.presentation.answerKind === "order_step")
      expect(success).toMatch(
        new RegExp(`data-scoop="${node.presentation.answer}"[^>]*data-placed="true"[^>]*data-landing="true"`),
      );
  });
  it("provides specific success labels and reduced motion", () => {
    expect(nodes.map(iceCreamSuccessLabel)).toEqual([
      "2 cones!",
      "Pink!",
      "2 pink scoops!",
      "Pink!",
      "Yellow!",
      "3 scoops!",
    ]);
    expect(readFileSync("app/ice-cream-stage.module.css", "utf8")).toMatch(
      /prefers-reduced-motion:[\s\S]*animation:\s*none/,
    );
  });
  it("ships safe local artwork", () => {
    const assets = new Set([
      "shop-counter",
      "shop-finale",
      ...Object.values(ICE_CREAM_SCENES).flatMap(scene => scene.objects.map(item => item.asset)),
      ...ICE_CREAM_FINALE.map(item => item.asset),
    ]);
    for (const asset of assets) {
      const path = `public/ice-cream/${asset}.svg`;
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, "utf8")).not.toMatch(
        /<\s*(?:script|foreignObject)\b|\son[a-z0-9_-]+\s*=|(?:href|xlink:href)\s*=\s*["'](?!#)/i,
      );
    }
  });
});
