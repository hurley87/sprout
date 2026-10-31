import { existsSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CountingStage } from "../app/counting-stage";
import { countingScene } from "../app/counting-scenes";
import { HALLOWEEN_THEME } from "../app/halloween-theme";
import {
  COUNTING_HALLOWEEN_LESSON,
  COUNTING_HALLOWEEN_NODE_IDS,
} from "../lib/lesson-runtime/counting-halloween-lesson";
import { COUNTING_LESSON } from "../lib/lesson-runtime/counting-lesson";
import { lessonNodeOrder, validateLessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import { resolveLessonDefinition } from "../lib/lesson-runtime/lesson-registry";
import { acceptsLearnerAnswerIndependently } from "../lib/lesson-runtime/counting-answer-policy";

describe("Halloween counting adventure", () => {
  it("validates its graph, registry and serialisable theme", () => {
    expect(validateLessonDefinition(COUNTING_HALLOWEEN_LESSON)).toEqual(COUNTING_HALLOWEEN_LESSON);
    expect(lessonNodeOrder(COUNTING_HALLOWEEN_LESSON)).toEqual(COUNTING_HALLOWEEN_NODE_IDS);
    expect(COUNTING_HALLOWEEN_NODE_IDS.map(id => COUNTING_HALLOWEEN_LESSON.nodes[id].presentation.quantity)).toEqual([
      1, 2, 3, 3, 4, 5, 6,
    ]);
    expect(resolveLessonDefinition("counting-halloween")).toBe(COUNTING_HALLOWEEN_LESSON);
    expect(resolveLessonDefinition("counting")).toBe(COUNTING_LESSON);
    expect(acceptsLearnerAnswerIndependently(COUNTING_HALLOWEEN_LESSON)).toBe(true);
    expect(JSON.parse(JSON.stringify(HALLOWEEN_THEME))).toEqual(HALLOWEEN_THEME);
  });

  it("renders the authored count without revealing answers", () => {
    for (const node of Object.values(COUNTING_HALLOWEEN_LESSON.nodes)) {
      const presentation = node.presentation as { sceneId: string; object: string; quantity: number };
      const scene = countingScene(presentation, HALLOWEEN_THEME.scenes);
      for (const asset of [scene.background, ...scene.objects.map(object => object.asset)]) {
        expect(HALLOWEEN_THEME.assets[asset]).toBeDefined();
        expect(existsSync(`public${HALLOWEEN_THEME.assets[asset].src}`)).toBe(true);
      }
      expect(scene).toMatchObject({ background: "porch" });
      expect(scene.plainBackdrop).toBeUndefined();
      expect(node.tutorBrief.replace(/one by one|one at a time/gi, "")).not.toMatch(
        /\d|\b(?:one|two|three|four|five|six)\b/i,
      );
      for (const motion of ["idle", "success"] as const) {
        const markup = renderToStaticMarkup(
          createElement(CountingStage, { theme: HALLOWEEN_THEME, node: { id: node.id, ...presentation }, motion }),
        );
        expect(markup.match(/data-counting-object=/g)).toHaveLength(presentation.quantity);
        expect(markup.includes("data-success-numeral")).toBe(motion === "success");
      }
    }
    const celebration = renderToStaticMarkup(createElement(CountingStage, { theme: HALLOWEEN_THEME, node: null }));
    expect(celebration).not.toContain("data-counting-object=");
    expect(Object.keys(HALLOWEEN_THEME.assets).sort()).toEqual(
      ["bat", "ghost", "lantern", "party-yard", "porch", "pumpkin"].sort(),
    );
    expect(HALLOWEEN_THEME.celebration.message).not.toMatch(/\d|\b(?:one|two|three|four|five|six)\b/i);
  });
});
