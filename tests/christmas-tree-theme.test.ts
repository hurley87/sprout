import { describe, expect, it } from "vitest";
import { christmasTreeSuccessLabel, christmasTreeTheme } from "../app/christmas-tree-theme";
import { christmasTreeLesson } from "../lib/lesson-runtime/christmas-tree-lesson";

describe("Christmas tree theme", () => {
  it.each([0, 1, 99])("uses the memoised lesson and Christmas tree copy for seed %i", seed => {
    const theme = christmasTreeTheme(seed);
    expect(theme.lesson).toBe(christmasTreeLesson(seed));
    expect(theme.copy).toEqual({
      welcome: "Let's count on the Christmas tree!",
      ready: "Your turn!",
      complete: "The tree is all counted!",
    });
    expect(theme.statusCue).toBe("glow");
    expect(theme.successLabel).toBe(christmasTreeSuccessLabel);
  });

  it.each([
    ["bauble", "bauble", "baubles"],
    ["candy-cane", "candy cane", "candy canes"],
    ["gingerbread", "gingerbread man", "gingerbread men"],
    ["present", "present", "presents"],
  ])("uses the correct singular and plural for %s", (kind, object, objects) => {
    const node = christmasTreeLesson(0).nodes["round-1"];
    expect(
      christmasTreeSuccessLabel({
        ...node,
        presentation: { ...node.presentation, kind, quantity: 1, object, objects },
      }),
    ).toBe(`1 ${object}!`);
    expect(
      christmasTreeSuccessLabel({
        ...node,
        presentation: { ...node.presentation, kind, quantity: 3, object, objects },
      }),
    ).toBe(`3 ${objects}!`);
  });
});
