import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CountingStage } from "../app/counting-stage";
import { countingScene } from "../app/counting-scenes";
import { GARDEN_THEME } from "../app/counting-themes";
import { acceptsLearnerAnswerIndependently } from "../lib/lesson-runtime/counting-answer-policy";
import { buildCountingLesson, COUNTING_LESSON, COUNTING_NODE_IDS } from "../lib/lesson-runtime/counting-lesson";
import { lessonNodeOrder } from "../lib/lesson-runtime/lesson-definition";

describe("counting theme contracts", () => {
  it("derives garden order from the graph and rejects cycles", () => {
    expect(lessonNodeOrder(COUNTING_LESSON)).toEqual(COUNTING_NODE_IDS);
    const first = COUNTING_LESSON.nodes[COUNTING_LESSON.initialNodeId];
    expect(() =>
      lessonNodeOrder({
        ...COUNTING_LESSON,
        nodes: { ...COUNTING_LESSON.nodes, [first.id]: { ...first, onSuccess: { kind: "node", nodeId: first.id } } },
      }),
    ).toThrow();
  });

  it("is plain data a server page can pass to the client lesson", () => {
    expect(JSON.parse(JSON.stringify(GARDEN_THEME))).toEqual(GARDEN_THEME);
  });

  it("validates scenes against a theme and draws its raster artwork", () => {
    const theme = {
      ...GARDEN_THEME,
      assets: { ...GARDEN_THEME.assets, duck: { src: "/counting/halloween/duck.png", width: 100, height: 200 } },
    };
    const node = { id: "test", sceneId: "hello-duck", object: "duck", quantity: 1 };
    expect(() => countingScene({ ...node, quantity: 2 }, theme.scenes)).toThrow(/authored scene/);
    expect(() => countingScene({ ...node, object: "ghost" }, theme.scenes)).toThrow(/authored scene/);
    const markup = renderToStaticMarkup(createElement(CountingStage, { node, theme }));
    expect(markup).toContain(encodeURIComponent("/counting/halloween/duck.png"));
    expect(markup).toContain("aspect-ratio:100 / 200");
  });

  it("builds shared instructions with an authored single-item example", () => {
    const options = {
      id: COUNTING_LESSON.id,
      initialNodeId: COUNTING_LESSON.initialNodeId,
      nodes: COUNTING_LESSON.nodes,
    };
    expect(buildCountingLesson({ ...options, singleItemExample: "a single duck" })).toEqual(COUNTING_LESSON);
    const variant = buildCountingLesson({ ...options, id: "counting-halloween", singleItemExample: "a single ghost" });
    expect(variant.tutor.sessionGuidance).toContain('Even "start with one" reveals the answer for a single ghost.');
    expect(acceptsLearnerAnswerIndependently(variant)).toBe(true);
    expect(acceptsLearnerAnswerIndependently({ ...variant, id: "other" })).toBe(false);
    expect(acceptsLearnerAnswerIndependently({ ...variant, conversationFirst: true })).toBe(false);
    expect(acceptsLearnerAnswerIndependently({ ...variant, answerAcceptance: undefined })).toBe(false);
  });
});
