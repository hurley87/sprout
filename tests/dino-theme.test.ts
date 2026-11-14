import { describe, expect, it } from "vitest";
import { DINO_THEME, dinoSuccessLabel } from "../app/dino-theme";
import { DINO_CAR_CRUNCH_LESSON, DINO_CAR_CRUNCH_NODE_IDS } from "../lib/lesson-runtime/dino-car-crunch-lesson";

describe("Dino Car Crunch theme", () => {
  it("uses the lesson and welcome, ready, and completion copy", () => {
    expect(DINO_THEME.lesson).toBe(DINO_CAR_CRUNCH_LESSON);
    expect(DINO_THEME.copy).toEqual({
      welcome: "Rex is hungry! Let's count the cars.",
      ready: "Your turn!",
      complete: "Rex is full!",
    });
    // Same voice indicator as /halloween: the glow replaces the "Sprout is talking…" pill.
    expect(DINO_THEME.statusCue).toBe("glow");
  });

  it("labels success with each node's answer", () => {
    expect(DINO_CAR_CRUNCH_NODE_IDS.map(id => dinoSuccessLabel(DINO_CAR_CRUNCH_LESSON.nodes[id]))).toEqual([
      "7 cars!",
      "23 cars!",
      "42 cars!",
      "56 cars!",
      "35 cars!",
      "29 cars!",
    ]);
  });
});
