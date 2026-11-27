import { expect, it } from "vitest";
import { downTheChimneySuccessLabel, downTheChimneyTheme } from "../app/down-the-chimney-theme";
import { downTheChimneyLesson } from "../lib/lesson-runtime/down-the-chimney-lesson";
it("uses the seeded lesson, glow cue and requested copy", () => {
  const theme = downTheChimneyTheme(0);
  expect(theme.lesson).toBe(downTheChimneyLesson(0));
  expect(theme.statusCue).toBe("glow");
  expect(theme.copy).toEqual({
    welcome: "Let's count Santa's presents!",
    ready: "Your turn!",
    complete: "All the presents are under the tree!",
  });
});
it.each([
  [1, "1 present!"],
  [3, "3 presents!"],
])("formats a successful count", (quantity, label) => {
  const node = downTheChimneyLesson(0).nodes["chimney-1"];
  expect(downTheChimneySuccessLabel({ ...node, presentation: { ...node.presentation, quantity } })).toBe(label);
});
