import { COUNTING_CONCERT_LESSON } from "@/lib/lesson-runtime/counting-concert-lesson";
import type { CountingTheme } from "./counting-themes";

const objectNames = [
  "microphone",
  "guitar-pink",
  "guitar-lavender",
  "bracelet-pink",
  "bracelet-blue",
  "bracelet-gold",
  "star",
  "stage-light-pink",
  "stage-light-lavender",
  "stage-light-blue",
  "stage-light-yellow",
  "bead-pink",
  "bead-lavender",
  "bead-blue",
  "bead-yellow",
  "bead-mint",
  "butterfly-pink",
  "butterfly-lavender",
  "butterfly-blue",
];
const assets = Object.fromEntries(
  [...objectNames, "concert-stage", "concert-finale"].map(name => [
    name,
    {
      src: `/counting/concert/${name}.svg`,
      width: name.startsWith("concert-") ? 1600 : 320,
      height: name.startsWith("concert-") ? 900 : 320,
    },
  ]),
);
const placement = (asset: string, x: number, y: number, width: number) => ({ asset, x, y, width });
const scene = (object: string, objects: ReturnType<typeof placement>[]) => ({
  background: "concert-stage",
  object,
  objects,
});

export const CONCERT_THEME: CountingTheme = {
  lesson: COUNTING_CONCERT_LESSON,
  assets,
  scenes: {
    "count-1-microphone": scene("microphone", [placement("microphone", 0.5, 0.5, 0.28)]),
    "count-2-guitars": scene("guitar", [
      placement("guitar-pink", 0.33, 0.5, 0.26),
      placement("guitar-lavender", 0.67, 0.5, 0.26),
    ]),
    "count-3-bracelets": scene("bracelet", [
      placement("bracelet-pink", 0.25, 0.52, 0.22),
      placement("bracelet-blue", 0.5, 0.52, 0.22),
      placement("bracelet-gold", 0.75, 0.52, 0.22),
    ]),
    "count-3-stars": scene("star", [
      placement("star", 0.5, 0.27, 0.22),
      placement("star", 0.3, 0.7, 0.22),
      placement("star", 0.7, 0.7, 0.22),
    ]),
    "count-4-lights": scene("light", [
      placement("stage-light-pink", 0.2, 0.37, 0.17),
      placement("stage-light-lavender", 0.4, 0.37, 0.17),
      placement("stage-light-blue", 0.6, 0.37, 0.17),
      placement("stage-light-yellow", 0.8, 0.37, 0.17),
    ]),
    // Two rows (3 + 2) keep each bead large on a narrow phone.
    "count-5-beads": scene("bead", [
      placement("bead-pink", 0.22, 0.32, 0.22),
      placement("bead-lavender", 0.5, 0.32, 0.22),
      placement("bead-blue", 0.78, 0.32, 0.22),
      placement("bead-yellow", 0.36, 0.7, 0.22),
      placement("bead-mint", 0.64, 0.7, 0.22),
    ]),
    "count-6-butterflies": scene("concert-butterfly", [
      placement("butterfly-pink", 0.22, 0.3, 0.2),
      placement("butterfly-lavender", 0.5, 0.3, 0.2),
      placement("butterfly-blue", 0.78, 0.3, 0.2),
      placement("butterfly-lavender", 0.22, 0.7, 0.2),
      placement("butterfly-blue", 0.5, 0.7, 0.2),
      placement("butterfly-pink", 0.78, 0.7, 0.2),
    ]),
  },
  celebration: {
    confetti: true,
    background: "concert-finale",
    decorations: [],
    friends: [
      placement("microphone", 0.12, 0.74, 0.14),
      placement("guitar-pink", 0.88, 0.74, 0.14),
      placement("star", 0.12, 0.45, 0.1),
      placement("butterfly-lavender", 0.88, 0.45, 0.1),
    ],
    message: "The concert is ready! You're a superstar!",
  },
  statusCue: "glow",
  palette: "pastel",
  copy: { welcome: "Come help get the concert ready!", complete: "Our concert is ready!" },
  progress: {
    base: "rounded-full border-2 border-purple-800",
    done: "h-4 w-4 bg-pink-600",
    current: "h-6 w-6 bg-pink-200 ring-2 ring-purple-800 ring-offset-2",
    upcoming: "h-4 w-4",
  },
};
