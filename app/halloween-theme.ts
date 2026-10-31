import { COUNTING_HALLOWEEN_LESSON } from "@/lib/lesson-runtime/counting-halloween-lesson";
import type { CountingTheme } from "./counting-themes";

const character = (name: string) => ({ src: `/counting/halloween/${name}.png`, width: 640, height: 640 });
const background = (name: string) => ({ src: `/counting/halloween/${name}.jpg`, width: 1619, height: 971 });

export const HALLOWEEN_THEME: CountingTheme = {
  lesson: COUNTING_HALLOWEEN_LESSON,
  assets: {
    "helper-pumpkin": character("helper-pumpkin"),
    "helper-vampire": character("helper-vampire"),
    bat: character("bat"),
    pumpkin: character("pumpkin"),
    lantern: character("lantern"),
    ghost: character("ghost"),
    porch: background("porch"),
    "party-yard": background("party-yard"),
  },
  scenes: {
    "helper-arrives": {
      background: "porch",
      object: "helper",
      objects: [{ asset: "helper-pumpkin", x: 0.5, y: 0.62, width: 0.3 }],
    },
    "helper-friend": {
      background: "porch",
      object: "helper",
      objects: [
        { asset: "helper-pumpkin", x: 0.33, y: 0.62, width: 0.28 },
        { asset: "helper-vampire", x: 0.67, y: 0.62, width: 0.28 },
      ],
    },
    "friendly-bats": {
      background: "porch",
      object: "bat",
      objects: [
        { asset: "bat", x: 0.2, y: 0.37, width: 0.23 },
        { asset: "bat", x: 0.5, y: 0.28, width: 0.23, flipped: true },
        { asset: "bat", x: 0.8, y: 0.4, width: 0.23 },
      ],
    },
    "pumpkin-path": {
      background: "porch",
      plainBackdrop: "twilight",
      object: "pumpkin",
      objects: [
        { asset: "pumpkin", x: 0.2, y: 0.65, width: 0.25 },
        { asset: "pumpkin", x: 0.5, y: 0.65, width: 0.25 },
        { asset: "pumpkin", x: 0.8, y: 0.65, width: 0.25 },
      ],
    },
    "party-lanterns": {
      background: "porch",
      plainBackdrop: "twilight",
      object: "lantern",
      objects: [
        { asset: "lantern", x: 0.14, y: 0.48, width: 0.2 },
        { asset: "lantern", x: 0.38, y: 0.57, width: 0.2 },
        { asset: "lantern", x: 0.62, y: 0.57, width: 0.2 },
        { asset: "lantern", x: 0.86, y: 0.48, width: 0.2 },
      ],
    },
    "helpers-gather": {
      background: "porch",
      object: "helper",
      objects: [
        { asset: "helper-pumpkin", x: 0.16, y: 0.65, width: 0.15 },
        { asset: "helper-vampire", x: 0.33, y: 0.6, width: 0.15, flipped: true },
        { asset: "helper-pumpkin", x: 0.5, y: 0.65, width: 0.15 },
        { asset: "helper-vampire", x: 0.67, y: 0.6, width: 0.15 },
        { asset: "helper-pumpkin", x: 0.84, y: 0.65, width: 0.15, flipped: true },
      ],
    },
    "shy-ghosts": {
      background: "porch",
      object: "ghost",
      objects: [
        { asset: "ghost", x: 0.22, y: 0.34, width: 0.2 },
        { asset: "ghost", x: 0.5, y: 0.3, width: 0.2 },
        { asset: "ghost", x: 0.78, y: 0.34, width: 0.2 },
        { asset: "ghost", x: 0.3, y: 0.68, width: 0.2 },
        { asset: "ghost", x: 0.58, y: 0.64, width: 0.2 },
        { asset: "ghost", x: 0.86, y: 0.68, width: 0.2 },
      ],
    },
  },
  celebration: {
    background: "party-yard",
    decorations: [],
    friends: [
      { asset: "helper-pumpkin", x: 0.12, y: 0.72, width: 0.16 },
      { asset: "helper-vampire", x: 0.88, y: 0.72, width: 0.16 },
      { asset: "bat", x: 0.04, y: 0.55, width: 0.1 },
      { asset: "ghost", x: 0.96, y: 0.55, width: 0.1 },
    ],
    message: "Halloween party time! Thanks for counting with Sprout.",
  },
  copy: { welcome: "Come count Halloween friends with Sprout!", complete: "Our Halloween counting party is complete!" },
  progress: {
    base: "rounded-full border-2 border-orange-800",
    done: "h-4 w-4 bg-orange-600",
    current: "h-6 w-6 bg-orange-300 ring-2 ring-orange-800 ring-offset-2",
    upcoming: "h-4 w-4",
  },
};
