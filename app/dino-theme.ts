import { DINO_CAR_CRUNCH_LESSON } from "@/lib/lesson-runtime/dino-car-crunch-lesson";
import type { LessonNodeDefinition } from "@/lib/lesson-runtime/lesson-definition";
import type { LessonScreenTheme } from "./lesson-screen";

export function dinoSuccessLabel(node: LessonNodeDefinition): string {
  return `${node.presentation.answer} cars!`;
}

export const DINO_THEME: LessonScreenTheme = {
  lesson: DINO_CAR_CRUNCH_LESSON,
  copy: { welcome: "Rex is hungry! Let's count the cars.", ready: "Your turn!", complete: "Rex is full!" },
  successLabel: dinoSuccessLabel,
  palette: "pastel",
  progress: {
    base: "border-2 border-teal-800",
    done: "h-4 w-4 rounded-full bg-teal-600",
    current: "h-6 w-6 rounded-md bg-[#F0A04B] ring-2 ring-teal-800 ring-offset-2",
    upcoming: "h-4 w-4 rotate-45 rounded-sm bg-orange-100",
  },
};
