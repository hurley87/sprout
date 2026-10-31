import { COUNTING_LESSON } from "@/lib/lesson-runtime/counting-lesson";
import type { LessonDefinition } from "@/lib/lesson-runtime/lesson-definition";
import { COUNTING_SCENES, type CountingPlacement, type CountingScene } from "./counting-scenes";
import { GARDEN_COPY, type PresentationCopy } from "./lesson-presentation";

/** Plain, serialisable data, so a server page can hand a theme straight to the client lesson. */
export type CountingTheme = {
  readonly lesson: LessonDefinition;
  readonly scenes: Readonly<Record<string, CountingScene>>;
  /** Every background and character the theme draws, by name. */
  readonly assets: Readonly<Record<string, { readonly src: string; readonly width: number; readonly height: number }>>;
  /** Nothing here is counted. */
  readonly celebration: {
    readonly background: string;
    /** Bottom-anchored row that sways during the celebration (the garden's flowers). */
    readonly decorations: readonly { readonly asset: string; readonly left: number }[];
    readonly friends: readonly CountingPlacement[];
    readonly message: string;
  };
  readonly copy: PresentationCopy;
  /** "glow": during the conversation an abstract moon glow replaces the talking/listening pill, held
   * through brief gaps in tutor audio; the words remain for screen readers. Default: the pill. */
  readonly statusCue?: "glow";
  /** "night": dark controls that sit with a night-time scene. Default: the garden's light controls. */
  readonly palette?: "night";
  /** Tailwind classes; shape and size, not only colour, distinguish finished, current and upcoming scenes. */
  readonly progress: {
    readonly base: string;
    readonly done: string;
    readonly current: string;
    readonly upcoming: string;
  };
};

const svg = (name: string, width = 320, height = 320) => ({ src: `/counting/${name}.svg`, width, height });

export const GARDEN_THEME: CountingTheme = {
  lesson: COUNTING_LESSON,
  scenes: COUNTING_SCENES,
  assets: {
    pond: svg("pond", 960, 600),
    garden: svg("garden", 960, 600),
    duck: svg("duck"),
    "butterfly-coral": svg("butterfly-coral"),
    "butterfly-sky": svg("butterfly-sky"),
    "butterfly-lavender": svg("butterfly-lavender"),
    flower: svg("flower", 280, 320),
  },
  celebration: {
    background: "garden",
    // Right of the duck friend, so no flower hides behind it.
    decorations: [36, 52, 68, 84].map(left => ({ asset: "flower", left })),
    friends: [
      { asset: "duck", x: 0.2, y: 0.72, width: 0.2 },
      { asset: "butterfly-coral", x: 0.16, y: 0.3, width: 0.15 },
      { asset: "butterfly-sky", x: 0.84, y: 0.5, width: 0.15 },
    ],
    message: "Garden celebration! Thanks for counting with Sprout.",
  },
  copy: GARDEN_COPY,
  progress: {
    base: "rounded-[0_80%] border-2 border-emerald-700",
    done: "h-4 w-4 bg-emerald-600",
    current: "h-6 w-6 bg-emerald-300 ring-2 ring-emerald-800 ring-offset-2",
    upcoming: "h-4 w-4",
  },
};
