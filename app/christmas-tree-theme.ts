import { christmasTreeLesson } from "@/lib/lesson-runtime/christmas-tree-lesson";
import type { LessonNodeDefinition } from "@/lib/lesson-runtime/lesson-definition";
import type { LessonScreenTheme } from "./lesson-screen";

export function christmasTreeSuccessLabel(node: LessonNodeDefinition): string {
  const { quantity, object, objects } = node.presentation;
  return `${quantity} ${quantity === 1 ? object : objects}!`;
}

export function christmasTreeTheme(seed: number): LessonScreenTheme {
  return {
    lesson: christmasTreeLesson(seed),
    copy: {
      welcome: "Let's count on the Christmas tree!",
      ready: "Your turn!",
      complete: "The tree is all counted!",
    },
    successLabel: christmasTreeSuccessLabel,
    statusCue: "glow",
    palette: "pastel",
    progress: {
      base: "border-2 border-emerald-800",
      done: "h-4 w-4 rounded-full bg-emerald-600",
      current: "h-6 w-6 rounded-md bg-amber-300 ring-2 ring-emerald-800 ring-offset-2",
      upcoming: "h-4 w-4 rotate-45 rounded-sm bg-pink-200",
    },
  };
}
