import { snowflakeShowdownLesson } from "@/lib/lesson-runtime/snowflake-showdown-lesson";
import type { LessonNodeDefinition } from "@/lib/lesson-runtime/lesson-definition";
import type { LessonScreenTheme } from "./lesson-screen";

/** "Pink has more!": the answer colour. Shown only once the round has succeeded. */
export function snowflakeShowdownSuccessLabel(node: LessonNodeDefinition): string {
  const colour = String(node.presentation.answer);
  return `${colour.charAt(0).toUpperCase()}${colour.slice(1)} has more!`;
}

/**
 * The stage's star row is the main progress: one gold star per completed round. The shared progress
 * list stays for screen readers ("Scene 3, playing now") and keeps the Stop button's place, but is
 * styled down to small frosty dots so it doesn't compete with the stars.
 */
export function snowflakeShowdownTheme(seed: number): LessonScreenTheme {
  return {
    lesson: snowflakeShowdownLesson(seed),
    copy: {
      welcome: "Let's see who has more!",
      ready: "Your turn!",
      complete: "All ten stars are yours!",
    },
    successLabel: snowflakeShowdownSuccessLabel,
    statusCue: "glow",
    palette: "pastel",
    progress: {
      base: "border border-sky-300",
      done: "h-2.5 w-2.5 rounded-full bg-sky-300",
      current: "h-3 w-3 rounded-full bg-pink-200 ring-1 ring-sky-400 ring-offset-1",
      upcoming: "h-2.5 w-2.5 rounded-full bg-white",
    },
  };
}
