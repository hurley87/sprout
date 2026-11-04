import { expect, it } from "vitest";
import { COUNTING_CONCERT_LESSON, COUNTING_CONCERT_NODE_IDS } from "../lib/lesson-runtime/counting-concert-lesson";
import { lessonNodeOrder, validateLessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import { resolveLessonDefinition } from "../lib/lesson-runtime/lesson-registry";

it("registers the concert graph with its intended counts", () => {
  expect(validateLessonDefinition(COUNTING_CONCERT_LESSON)).toEqual(COUNTING_CONCERT_LESSON);
  expect(lessonNodeOrder(COUNTING_CONCERT_LESSON)).toEqual(COUNTING_CONCERT_NODE_IDS);
  expect(COUNTING_CONCERT_NODE_IDS.map(id => COUNTING_CONCERT_LESSON.nodes[id].presentation.quantity)).toEqual([
    1, 2, 3, 3, 4, 5, 6,
  ]);
  expect(resolveLessonDefinition("counting-concert")).toBe(COUNTING_CONCERT_LESSON);
  expect(COUNTING_CONCERT_LESSON.transitionQuietMs).toBe(1000);
});
