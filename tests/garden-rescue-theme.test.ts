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

  it("celebrates the restored world with bounded, registered artwork", () => {
    const { celebration, assets, progressIcons } = GARDEN_RESCUE_THEME;
    expect(celebration.friends.filter(friend => friend.asset === "duckling")).toHaveLength(3);
    expect(celebration.friends.filter(friend => friend.asset === "lily-pad")).toHaveLength(3);
    expect(celebration.friends.filter(friend => friend.asset === "butterfly-awake")).toHaveLength(3);
    expect(celebration.decorations.filter(decoration => decoration.asset === "flower-bloomed")).toHaveLength(4);
    expect(assets).toHaveProperty(celebration.background);
    for (const friend of celebration.friends) {
      expect(assets).toHaveProperty(friend.asset);
      for (const value of [friend.x, friend.y, friend.width]) expect(value).toBeGreaterThanOrEqual(0);
      for (const value of [friend.x, friend.y, friend.width]) expect(value).toBeLessThanOrEqual(1);
    }
    for (const decoration of celebration.decorations) {
      expect(assets).toHaveProperty(decoration.asset);
      expect(decoration.left).toBeGreaterThanOrEqual(0);
      expect(decoration.left).toBeLessThanOrEqual(100);
    }
    for (const src of Object.values(progressIcons ?? {})) {
      expect(Object.values(assets).some(asset => asset.src === src)).toBe(true);
    }
  });

  it("uses known assets and normalized placements for duckling crossing props", () => {
    const effect = GARDEN_RESCUE_THEME.scenes["rescue-ducklings"].effect;
    expect(effect?.id).toBe("ducklings.crossed");
    expect(effect?.props.length).toBeGreaterThanOrEqual(3);
    for (const prop of effect!.props) {
      expect(GARDEN_RESCUE_THEME.assets).toHaveProperty(prop.asset);
      for (const value of [prop.x, prop.y, prop.width]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("uses a fresh scattered butterfly layout", () => {
    const familiar = GARDEN_RESCUE_THEME.scenes["wake-butterflies"].objects;
    const fresh = GARDEN_RESCUE_THEME.scenes["fresh-challenge"].objects;
    for (const object of fresh) {
      expect(familiar.some(other => other.x === object.x && other.y === object.y)).toBe(false);
    }
  });

  it("softens the garden behind countable flowers so its decorative flowers recede", () => {
    expect(GARDEN_RESCUE_THEME.scenes["grow-flowers"]).toMatchObject({ background: "garden", softBackdrop: true });
  });

  it("uses the abstract glow status cue", () => {
    expect(GARDEN_RESCUE_THEME.statusCue).toBe("glow");
  });
});
