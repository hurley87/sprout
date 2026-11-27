import { downTheChimneyLesson } from "@/lib/lesson-runtime/down-the-chimney-lesson";
import type { LessonNodeDefinition } from "@/lib/lesson-runtime/lesson-definition";
import type { LessonScreenTheme } from "./lesson-screen";

export function downTheChimneySuccessLabel(node: LessonNodeDefinition): string {
  const { quantity, object, objects } = node.presentation;
  return `${quantity} ${quantity === 1 ? object : objects}!`;
}
export function downTheChimneyTheme(seed: number): LessonScreenTheme {
  return {
    lesson: downTheChimneyLesson(seed),
    copy: {
      welcome: "Let's count Santa's presents!",
      ready: "Your turn!",
      complete: "All the presents are under the tree!",
    },
    successLabel: downTheChimneySuccessLabel,
    statusCue: "glow",
    palette: "pastel",
    progress: {
      base: "border-2 border-purple-800",
      done: "h-4 w-4 rounded-full bg-purple-600",
      current: "h-6 w-6 rounded-full bg-amber-300 ring-2 ring-purple-800 ring-offset-2",
      upcoming: "h-4 w-4 rounded-full bg-pink-200",
    },
  };
}
