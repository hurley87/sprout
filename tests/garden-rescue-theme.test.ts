import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { countingScene } from "../app/counting-scenes";
import { GARDEN_RESCUE_THEME } from "../app/garden-rescue-theme";

describe("Garden Rescue theme", () => {
  it("matches every authored lesson node to its scene", () => {
    for (const node of Object.values(GARDEN_RESCUE_THEME.lesson.nodes)) {
      const presentation = node.presentation as { sceneId: string; object: string; quantity: number };
      expect(() => countingScene(presentation, GARDEN_RESCUE_THEME.scenes)).not.toThrow();
    }
  });

  it("ships every asset", () => {
    for (const asset of Object.values(GARDEN_RESCUE_THEME.assets)) {
      expect(existsSync(join(process.cwd(), "public", asset.src))).toBe(true);
    }
  });

  it("uses a fresh scattered butterfly layout", () => {
    const familiar = GARDEN_RESCUE_THEME.scenes["wake-butterflies"].objects;
    const fresh = GARDEN_RESCUE_THEME.scenes["fresh-challenge"].objects;
    for (const object of fresh) {
      expect(familiar.some(other => other.x === object.x && other.y === object.y)).toBe(false);
    }
  });

  it("uses a plain backdrop for countable flowers", () => {
    expect(GARDEN_RESCUE_THEME.scenes["grow-flowers"].plainBackdrop).toBe("meadow");
  });
});
