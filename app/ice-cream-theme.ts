import { ICE_CREAM_LESSON } from "@/lib/lesson-runtime/ice-cream-lesson";
import type { LessonNodeDefinition } from "@/lib/lesson-runtime/lesson-definition";
import type { LessonScreenTheme } from "./lesson-screen";

export function iceCreamSuccessLabel(node: LessonNodeDefinition): string {
  const { answerKind, answer, object, quantity } = node.presentation;
  if (answerKind === "count") return `${quantity} ${object}s!`;
  const colour = String(answer);
  return `${colour.charAt(0).toUpperCase()}${colour.slice(1)}!`;
}

export const ICE_CREAM_THEME: LessonScreenTheme = {
  lesson: ICE_CREAM_LESSON,
  copy: { welcome: "Come help at the ice cream shop!", complete: "The ice cream shop is ready!", ready: "Your turn!" },
  successLabel: iceCreamSuccessLabel,
  progress: {
    base: "border-2 border-rose-700",
    done: "h-4 w-4 rounded-full bg-rose-400",
    current: "h-6 w-6 rounded-md bg-amber-200 ring-2 ring-rose-800 ring-offset-2",
    upcoming: "h-4 w-4 rotate-45 rounded-sm bg-white",
  },
};
