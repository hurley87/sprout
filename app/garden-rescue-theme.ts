import { GARDEN_RESCUE_LESSON } from "@/lib/lesson-runtime/garden-rescue-lesson";
import type { CountingTheme } from "./counting-themes";

const image = (name: string, extension: "jpg" | "png", width: number, height: number) => ({
  src: `/garden-rescue/${name}.${extension}`,
  width,
  height,
});

export const GARDEN_RESCUE_THEME: CountingTheme = {
  lesson: GARDEN_RESCUE_LESSON,
  assets: {
    pond: image("pond", "jpg", 1672, 941),
    garden: image("garden", "jpg", 1672, 941),
    duckling: image("duckling", "png", 512, 512),
    "butterfly-sleeping": image("butterfly-sleeping", "png", 512, 512),
    "butterfly-awake": image("butterfly-awake", "png", 512, 512),
    "flower-bloomed": image("flower-bloomed", "png", 512, 512),
    "lily-pad": image("lily-pad", "png", 512, 512),
  },
  scenes: {
    "rescue-ducklings": {
      background: "pond",
      object: "duckling",
      objects: [
        // On the water, clear of the pre-Play button: a short staggered line waiting to cross.
        { asset: "duckling", x: 0.24, y: 0.72, width: 0.2 },
        { asset: "duckling", x: 0.5, y: 0.76, width: 0.2 },
        { asset: "duckling", x: 0.76, y: 0.72, width: 0.2 },
      ],
      effect: {
        id: "ducklings.crossed",
        props: [
          { asset: "lily-pad", x: 0.24, y: 0.59, width: 0.16 },
          { asset: "lily-pad", x: 0.5, y: 0.63, width: 0.16 },
          { asset: "lily-pad", x: 0.76, y: 0.59, width: 0.16 },
        ],
      },
    },
    "wake-butterflies": {
      background: "garden",
      object: "butterfly",
      objects: [
        { asset: "butterfly-sleeping", x: 0.23, y: 0.58, width: 0.22 },
        { asset: "butterfly-sleeping", x: 0.5, y: 0.58, width: 0.22 },
        { asset: "butterfly-sleeping", x: 0.77, y: 0.58, width: 0.22 },
      ],
      effect: {
        id: "butterflies.awakened",
        props: [
          { asset: "butterfly-awake", x: 0.23, y: 0.58, width: 0.22 },
          { asset: "butterfly-awake", x: 0.5, y: 0.58, width: 0.22 },
          { asset: "butterfly-awake", x: 0.77, y: 0.58, width: 0.22 },
        ],
      },
    },
    "grow-flowers": {
      background: "garden",
      softBackdrop: true,
      object: "flower",
      objects: [
        { asset: "flower-bloomed", x: 0.16, y: 0.5, width: 0.2 },
        { asset: "flower-bloomed", x: 0.39, y: 0.5, width: 0.2 },
        { asset: "flower-bloomed", x: 0.62, y: 0.5, width: 0.2 },
        { asset: "flower-bloomed", x: 0.85, y: 0.5, width: 0.2 },
      ],
    },
    "fresh-challenge": {
      background: "garden",
      object: "butterfly",
      objects: [
        { asset: "butterfly-awake", x: 0.2, y: 0.3, width: 0.19, flipped: true },
        { asset: "butterfly-awake", x: 0.68, y: 0.26, width: 0.19 },
        { asset: "butterfly-awake", x: 0.38, y: 0.7, width: 0.19 },
        { asset: "butterfly-awake", x: 0.82, y: 0.68, width: 0.19, flipped: true },
      ],
    },
  },
  celebration: {
    background: "garden",
    decorations: [10, 36, 64, 90].map(left => ({ asset: "flower-bloomed", left })),
    friends: [
      { asset: "lily-pad", x: 0.24, y: 0.78, width: 0.17 },
      { asset: "lily-pad", x: 0.5, y: 0.78, width: 0.17 },
      { asset: "lily-pad", x: 0.76, y: 0.78, width: 0.17 },
      { asset: "duckling", x: 0.24, y: 0.63, width: 0.15 },
      { asset: "duckling", x: 0.5, y: 0.63, width: 0.15 },
      { asset: "duckling", x: 0.76, y: 0.63, width: 0.15 },
      { asset: "butterfly-awake", x: 0.15, y: 0.4, width: 0.13 },
      { asset: "butterfly-awake", x: 0.5, y: 0.4, width: 0.13 },
      { asset: "butterfly-awake", x: 0.85, y: 0.4, width: 0.13 },
    ],
    message: "The garden is back to life! Thank you for helping the animals.",
  },
  statusCue: "glow",
  progressIcons: {
    "rescue-ducklings": "/garden-rescue/lily-pad.png",
    "wake-butterflies": "/garden-rescue/butterfly-awake.png",
    "grow-flowers": "/garden-rescue/flower-bloomed.png",
  },
  copy: {
    welcome: "Help the animals bring the garden back to life.",
    complete: "The garden is back to life!",
    plurals: { butterfly: "butterflies" },
  },
  progress: {
    base: "rounded-[0_80%] border-2 border-emerald-700",
    done: "h-4 w-4 bg-emerald-600",
    current: "h-6 w-6 bg-emerald-300 ring-2 ring-emerald-800 ring-offset-2",
    upcoming: "h-4 w-4",
  },
};
