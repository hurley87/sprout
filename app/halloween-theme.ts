import { COUNTING_HALLOWEEN_LESSON } from "@/lib/lesson-runtime/counting-halloween-lesson";
import type { CountingTheme } from "./counting-themes";

const character = (name: string) => ({ src: `/counting/halloween/${name}.png`, width: 640, height: 640 });
const background = (name: string) => ({ src: `/counting/halloween/${name}.jpg`, width: 1619, height: 971 });

// Every counting scene uses the porch. It has a big jack-o'-lantern by the steps (bottom left), small
// pumpkin lights in the tree (top right) and a porch lamp (top left), so counted pumpkins and lanterns
// stay in the open middle, away from those decorations.
export const HALLOWEEN_THEME: CountingTheme = {
  lesson: COUNTING_HALLOWEEN_LESSON,
  assets: {
    bat: character("bat"),
    pumpkin: character("pumpkin"),
    lantern: character("lantern"),
    ghost: character("ghost"),
    porch: background("porch"),
    "party-yard": background("party-yard"),
  },
  scenes: {
    "ghost-peeks": {
      background: "porch",
      object: "ghost",
      objects: [{ asset: "ghost", x: 0.5, y: 0.52, width: 0.26 }],
    },
    "bat-friends": {
      background: "porch",
      object: "bat",
      objects: [
        { asset: "bat", x: 0.33, y: 0.4, width: 0.26 },
        { asset: "bat", x: 0.67, y: 0.44, width: 0.26, flipped: true },
      ],
    },
    "pumpkin-path": {
      background: "porch",
      object: "pumpkin",
      objects: [
        { asset: "pumpkin", x: 0.3, y: 0.7, width: 0.2 },
        { asset: "pumpkin", x: 0.5, y: 0.7, width: 0.2 },
        { asset: "pumpkin", x: 0.7, y: 0.7, width: 0.2 },
      ],
    },
    "ghosts-float": {
      background: "porch",
      object: "ghost",
      objects: [
        { asset: "ghost", x: 0.3, y: 0.62, width: 0.22 },
        { asset: "ghost", x: 0.5, y: 0.34, width: 0.22 },
        { asset: "ghost", x: 0.7, y: 0.62, width: 0.22, flipped: true },
      ],
    },
    "party-lanterns": {
      background: "porch",
      object: "lantern",
      objects: [
        { asset: "lantern", x: 0.24, y: 0.55, width: 0.17 },
        { asset: "lantern", x: 0.42, y: 0.63, width: 0.17 },
        { asset: "lantern", x: 0.58, y: 0.63, width: 0.17 },
        { asset: "lantern", x: 0.76, y: 0.55, width: 0.17 },
      ],
    },
    "bats-swoop": {
      background: "porch",
      object: "bat",
      objects: [
        { asset: "bat", x: 0.16, y: 0.48, width: 0.17 },
        { asset: "bat", x: 0.33, y: 0.3, width: 0.17, flipped: true },
        { asset: "bat", x: 0.5, y: 0.52, width: 0.17 },
        { asset: "bat", x: 0.67, y: 0.3, width: 0.17, flipped: true },
        { asset: "bat", x: 0.84, y: 0.48, width: 0.17 },
      ],
    },
    "ghost-party": {
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
      { asset: "pumpkin", x: 0.12, y: 0.74, width: 0.14 },
      { asset: "lantern", x: 0.88, y: 0.72, width: 0.13 },
      { asset: "bat", x: 0.04, y: 0.55, width: 0.1 },
      { asset: "ghost", x: 0.96, y: 0.55, width: 0.1 },
    ],
    message: "Halloween party time! Thanks for counting with Sprout.",
  },
  statusCue: "glow",
  copy: { welcome: "Come count Halloween friends with Sprout!", complete: "Our Halloween counting party is complete!" },
  progress: {
    base: "rounded-full border-2 border-orange-800",
    done: "h-4 w-4 bg-orange-600",
    current: "h-6 w-6 bg-orange-300 ring-2 ring-orange-800 ring-offset-2",
    upcoming: "h-4 w-4",
  },
};
