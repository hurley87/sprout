import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DINO_CAR_CRUNCH_LESSON } from "../lib/lesson-runtime/dino-car-crunch-lesson";
import { dinoScene } from "../app/dino-scenes";
import { DinoStage } from "../app/dino-stage";

const count = (markup: string, pattern: RegExp) => [...markup.matchAll(pattern)].length;

describe("dino stage", () => {
  it.each(Object.values(DINO_CAR_CRUNCH_LESSON.nodes))("renders the authored cars for $id", node => {
    const scene = dinoScene(node);
    const markup = renderToStaticMarkup(createElement(DinoStage, { node, renderToken: "token", motion: "calm" }));
    expect(markup).toContain(`data-scene-id="${node.presentation.sceneId}"`);
    expect(markup).toContain('data-render-token="token"');
    expect(markup).toContain('data-rex="hungry"');
    expect(markup).not.toContain("data-eaten=");
    expect(scene.label).not.toMatch(
      /\b(?:\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)\b/i,
    );
    expect(count(markup, /data-car="true"/g)).toBe(node.presentation.answer);
    expect(count(markup, /data-truck="true"/g)).toBe(scene.trucks.length);
    expect(count(markup, /data-in="truck"/g)).toBe(scene.trucks.length * 10);
    expect(count(markup, /data-in="loose"/g)).toBe(scene.loose.length);
    expect(count(markup, /data-in="arriving"/g)).toBe(scene.arriving.length);
    const trucks = markup.split('data-truck="true"').slice(1);
    for (const truck of trucks) expect(count(truck.split("</div></div>")[0], /data-in="truck"/g)).toBe(10);
    const success = renderToStaticMarkup(createElement(DinoStage, { node, motion: "success" }));
    expect(success).toContain('data-rex="chomp"');
    expect(count(success, /data-eaten="true"/g)).toBe(node.presentation.answer);
    // Both poses are always in the page so the chomp image is already loaded when it is shown.
    for (const [html, shown] of [
      [markup, "hungry"],
      [success, "chomp"],
    ] as const) {
      expect(count(html, /data-pose="(?:hungry|chomp)"/g)).toBe(2);
      expect(html).toMatch(new RegExp(`data-pose="${shown}"[^>]*data-shown="true"`));
      expect(count(html, /data-shown="true"/g)).toBe(1);
    }
  });
  it("shows the empty finale and supports reduced motion", () => {
    const markup = renderToStaticMarkup(createElement(DinoStage, { node: null }));
    expect(markup).toContain('data-rex="full"');
    expect(markup).toContain("car-park-empty");
    expect(markup).not.toContain("data-car=");
    expect(readFileSync("app/dino-stage.module.css", "utf8")).toMatch(
      /prefers-reduced-motion:[\s\S]*animation:\s*none/,
    );
  });
});
