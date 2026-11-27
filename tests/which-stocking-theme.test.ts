import { expect, it } from "vitest";
import { whichStockingSuccessLabel, whichStockingTheme } from "../app/which-stocking-theme";
import { whichStockingLesson } from "../lib/lesson-runtime/which-stocking-lesson";
it("uses the seeded lesson, glow cue, pastel palette and requested copy", () => {
  const theme = whichStockingTheme(0);
  expect(theme.lesson).toBe(whichStockingLesson(0));
  expect(theme.statusCue).toBe("glow");
  expect(theme.palette).toBe("pastel");
  expect(theme.copy).toEqual({
    welcome: "Let's find the stocking!",
    ready: "Your turn!",
    complete: "Every stocking is full!",
  });
  expect(Object.keys(theme.lesson.nodes)).toHaveLength(8);
  expect(theme.successLabel).toBe(whichStockingSuccessLabel);
});
it("labels the answer colour and target", () => {
  const node = whichStockingLesson(0).nodes["stocking-1"];
  expect(
    whichStockingSuccessLabel({ ...node, presentation: { ...node.presentation, answer: "purple", target: 3 } }),
  ).toBe("Purple has 3!");
});
