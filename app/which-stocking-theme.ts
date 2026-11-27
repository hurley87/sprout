import { whichStockingLesson } from "@/lib/lesson-runtime/which-stocking-lesson";
import type { LessonNodeDefinition } from "@/lib/lesson-runtime/lesson-definition";
import type { LessonScreenTheme } from "./lesson-screen";

/** "Purple has 3!": the answer colour and the target. Shown only once the round has succeeded. */
export function whichStockingSuccessLabel(node: LessonNodeDefinition): string {
  const colour = String(node.presentation.answer);
  return `${colour.charAt(0).toUpperCase()}${colour.slice(1)} has ${node.presentation.target}!`;
}
export function whichStockingTheme(seed: number): LessonScreenTheme {
  return {
    lesson: whichStockingLesson(seed),
    copy: {
      welcome: "Let's find the stocking!",
      ready: "Your turn!",
      complete: "Every stocking is full!",
    },
    successLabel: whichStockingSuccessLabel,
    statusCue: "glow",
    palette: "pastel",
    progress: {
      base: "border-2 border-rose-800",
      done: "h-4 w-4 rounded-full bg-rose-500",
      current: "h-6 w-6 rounded-full bg-amber-300 ring-2 ring-rose-800 ring-offset-2",
      upcoming: "h-4 w-4 rounded-full bg-pink-200",
    },
  };
}
