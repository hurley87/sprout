/** Experiment-local authored answer text; does not interpret learner evidence. */
export function formatExpectedCountingAnswer(scene: {
  readonly quantity?: unknown;
  readonly object?: unknown;
}): string {
  if (scene.quantity === 1 && scene.object === "duck") return "one duck";
  if (scene.quantity === 2 && scene.object === "duck") return "two ducks";
  if (scene.quantity === 3 && scene.object === "butterfly") return "three butterflies";
  throw new Error("Unsupported counting scene");
}
