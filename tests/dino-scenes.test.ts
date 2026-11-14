import { describe, expect, it } from "vitest";
import { DINO_ART } from "../app/dino-art";
import { DINO_FINALE, DINO_SCENES, dinoScene, dinoSceneCarCount } from "../app/dino-scenes";
import { DINO_CAR_CRUNCH_LESSON } from "../lib/lesson-runtime/dino-car-crunch-lesson";

const nodes = Object.values(DINO_CAR_CRUNCH_LESSON.nodes);
const numberWords =
  /\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/i;

describe("dino scenes", () => {
  it.each(nodes)("matches the lesson facts and artwork for $id", node => {
    const scene = dinoScene(node);
    const warmUp = node.presentation.sceneId === "warm-up";
    expect(scene.trucks).toHaveLength(warmUp ? 0 : Number(node.presentation.trucks));
    for (const truck of scene.trucks) {
      expect(truck).toHaveLength(10);
      for (const [index, colour] of truck.entries()) {
        expect(DINO_ART.car.colours).toContain(colour);
        if (index % 5 !== 0) expect(colour).not.toBe(truck[index - 1]);
      }
    }
    expect(scene.loose).toHaveLength(Number(warmUp ? node.presentation.firstCars : node.presentation.looseCars));
    expect(scene.arriving).toHaveLength(warmUp ? Number(node.presentation.moreCars) : 0);
    for (const colour of [...scene.loose, ...scene.arriving]) expect(DINO_ART.car.colours).toContain(colour);
    expect(dinoSceneCarCount(scene)).toBe(node.presentation.answer);
    expect(scene.label).not.toMatch(numberWords);
  });

  it("provides an empty finale without a count in its label", () => {
    expect(DINO_FINALE.label).not.toMatch(numberWords);
    expect(DINO_FINALE.trucks).toHaveLength(0);
    expect(dinoSceneCarCount(DINO_FINALE)).toBe(0);
  });

  it("rejects mismatched facts, missing scenes and incorrect car arrangements", () => {
    const node = DINO_CAR_CRUNCH_LESSON.nodes["fifty-six"];
    const fail = `Dino artwork does not match authored scene: fifty-six`;
    const changes: Record<string, string | number | boolean>[] = [
      { trucks: 4 },
      { looseCars: 7 },
      { object: "truck" },
      { extra: true },
    ];
    for (const change of changes) {
      expect(() => dinoScene({ ...node, presentation: { ...node.presentation, ...change } })).toThrow(fail);
    }
    const scene = DINO_SCENES["fifty-six"];
    expect(() =>
      dinoScene(node, {
        ...DINO_SCENES,
        "fifty-six": { ...scene, trucks: [scene.trucks[0].slice(1), ...scene.trucks.slice(1)] },
      }),
    ).toThrow(fail);
    expect(() => dinoScene({ ...node, presentation: { ...node.presentation, sceneId: "missing" } })).toThrow(
      "Dino artwork does not match authored scene: missing",
    );
    const warmUp = DINO_CAR_CRUNCH_LESSON.nodes["warm-up"];
    expect(() =>
      dinoScene(warmUp, {
        ...DINO_SCENES,
        "warm-up": { ...DINO_SCENES["warm-up"], arriving: ["red", "blue", "yellow", "red", "blue"] },
      }),
    ).toThrow("Dino artwork does not match authored scene: warm-up");
  });
});
