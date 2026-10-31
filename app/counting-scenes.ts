export type CountingPlacement = {
  readonly asset: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly flipped?: boolean;
};

export type CountingScene = {
  readonly background: string;
  /** CSS-module backdrop class drawn instead of the background artwork, so nothing behind the
   * countable objects can be mistaken for one of them. */
  readonly plainBackdrop?: string;
  readonly object: string;
  readonly objects: readonly CountingPlacement[];
};

export const COUNTING_SCENES = {
  "hello-duck": {
    background: "pond",
    object: "duck",
    objects: [{ asset: "duck", x: 0.5, y: 0.6, width: 0.32 }],
  },
  "duck-friends": {
    background: "pond",
    object: "duck",
    objects: [
      { asset: "duck", x: 0.32, y: 0.6, width: 0.3 },
      { asset: "duck", x: 0.68, y: 0.6, width: 0.3, flipped: true },
    ],
  },
  "butterfly-garden": {
    background: "garden",
    object: "butterfly",
    objects: [
      { asset: "butterfly-coral", x: 0.21, y: 0.5, width: 0.27 },
      { asset: "butterfly-sky", x: 0.5, y: 0.32, width: 0.27 },
      { asset: "butterfly-lavender", x: 0.79, y: 0.52, width: 0.27 },
    ],
  },
  "duckling-parade": {
    background: "pond",
    object: "duck",
    objects: [
      { asset: "duck", x: 0.24, y: 0.66, width: 0.2 },
      { asset: "duck", x: 0.5, y: 0.72, width: 0.2 },
      { asset: "duck", x: 0.76, y: 0.78, width: 0.2 },
    ],
  },
  "flowers-bloom": {
    background: "garden",
    object: "flower",
    plainBackdrop: "meadow",
    objects: [
      { asset: "flower", x: 0.16, y: 0.62, width: 0.22 },
      { asset: "flower", x: 0.39, y: 0.48, width: 0.22 },
      { asset: "flower", x: 0.62, y: 0.62, width: 0.22 },
      { asset: "flower", x: 0.85, y: 0.48, width: 0.22 },
    ],
  },
  "butterflies-move": {
    background: "garden",
    object: "butterfly",
    objects: [
      { asset: "butterfly-sky", x: 0.3, y: 0.3, width: 0.24, flipped: true },
      { asset: "butterfly-lavender", x: 0.62, y: 0.42, width: 0.24 },
      { asset: "butterfly-coral", x: 0.34, y: 0.74, width: 0.24, flipped: true },
    ],
  },
} as const satisfies Record<string, CountingScene>;

export function countingScene(
  presentation: { sceneId: string; object: string; quantity: number },
  scenes: Readonly<Record<string, CountingScene>> = COUNTING_SCENES,
): CountingScene {
  const scene = Object.hasOwn(scenes, presentation.sceneId) ? scenes[presentation.sceneId] : undefined;
  if (!scene || scene.object !== presentation.object || scene.objects.length !== presentation.quantity) {
    throw new Error(`Counting artwork does not match authored scene: ${presentation.sceneId}`);
  }
  return scene;
}
