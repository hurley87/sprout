import { expect, it } from "vitest";
import { snowflakeShowdownSuccessLabel, snowflakeShowdownTheme } from "../app/snowflake-showdown-theme";
import { snowflakeShowdownLesson } from "../lib/lesson-runtime/snowflake-showdown-lesson";

it("uses the seeded lesson, glow cue, pastel palette and requested copy", () => {
  const theme = snowflakeShowdownTheme(0);
  expect(theme.lesson).toBe(snowflakeShowdownLesson(0));
  expect(theme.statusCue).toBe("glow");
  expect(theme.palette).toBe("pastel");
  expect(theme.copy).toEqual({
    welcome: "Let's see who has more!",
    ready: "Your turn!",
    complete: "All ten stars are yours!",
  });
  expect(Object.keys(theme.lesson.nodes)).toHaveLength(10);
  expect(theme.successLabel).toBe(snowflakeShowdownSuccessLabel);
});

it("labels the colour with more", () => {
  const node = snowflakeShowdownLesson(0).nodes["showdown-1"];
  expect(snowflakeShowdownSuccessLabel({ ...node, presentation: { ...node.presentation, answer: "pink" } })).toBe(
    "Pink has more!",
  );
  expect(snowflakeShowdownSuccessLabel({ ...node, presentation: { ...node.presentation, answer: "blue" } })).toBe(
    "Blue has more!",
  );
});
