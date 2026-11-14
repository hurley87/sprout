import type { LessonNodeDefinition } from "@/lib/lesson-runtime/lesson-definition";
import { DINO_ART, type DinoCarColour } from "./dino-art";

export type DinoScene = {
  readonly label: string;
  readonly facts: Readonly<Record<string, string | number | boolean>>;
  readonly trucks: readonly (readonly DinoCarColour[])[];
  readonly loose: readonly DinoCarColour[];
  readonly arriving: readonly DinoCarColour[];
};

const cars = (count: number, offset = 0): DinoCarColour[] =>
  Array.from({ length: count }, (_, index) => DINO_ART.car.colours[(index + offset) % DINO_ART.car.colours.length]);
const trucks = (count: number): DinoCarColour[][] => Array.from({ length: count }, (_, index) => cars(10, index));
const truckLabel = "Rex beside car-carrier trucks carrying cars, with loose cars nearby";

export const DINO_SCENES: Readonly<Record<string, DinoScene>> = {
  "warm-up": {
    label: "Rex watching a few cars, with more cars arriving",
    facts: { answerKind: "count", answer: 7, object: "car", firstCars: 3, moreCars: 4 },
    trucks: [],
    loose: cars(3),
    arriving: cars(4, 3),
  },
  "twenty-three": {
    label: truckLabel,
    facts: { answerKind: "count", answer: 23, object: "car", trucks: 2, looseCars: 3 },
    trucks: trucks(2),
    loose: cars(3),
    arriving: [],
  },
  "forty-two": {
    label: truckLabel,
    facts: { answerKind: "count", answer: 42, object: "car", trucks: 4, looseCars: 2 },
    trucks: trucks(4),
    loose: cars(2),
    arriving: [],
  },
  "fifty-six": {
    label: truckLabel,
    facts: { answerKind: "count", answer: 56, object: "car", trucks: 5, looseCars: 6 },
    trucks: trucks(5),
    loose: cars(6),
    arriving: [],
  },
  "thirty-five": {
    label: truckLabel,
    facts: { answerKind: "count", answer: 35, object: "car", trucks: 3, looseCars: 5 },
    trucks: trucks(3),
    loose: cars(5),
    arriving: [],
  },
  "twenty-nine": {
    label: truckLabel,
    facts: { answerKind: "count", answer: 29, object: "car", trucks: 2, looseCars: 9 },
    trucks: trucks(2),
    loose: cars(9),
    arriving: [],
  },
};

export const DINO_FINALE: DinoScene = {
  label: "Rex sitting happily with a full tummy beside an empty car park",
  facts: {},
  trucks: [],
  loose: [],
  arriving: [],
};

export function dinoSceneCarCount(scene: DinoScene): number {
  return scene.trucks.reduce((total, truck) => total + truck.length, 0) + scene.loose.length + scene.arriving.length;
}

export function dinoScene(
  node: LessonNodeDefinition,
  scenes: Readonly<Record<string, DinoScene>> = DINO_SCENES,
): DinoScene {
  const { sceneId, ...facts } = node.presentation;
  const id = String(sceneId);
  const scene = Object.hasOwn(scenes, id) ? scenes[id] : undefined;
  const warmUp = id === "warm-up";
  if (
    !scene ||
    Object.keys(facts).length !== Object.keys(scene.facts).length ||
    Object.entries(facts).some(([key, value]) => !Object.hasOwn(scene.facts, key) || scene.facts[key] !== value) ||
    scene.trucks.length !== (warmUp ? 0 : facts.trucks) ||
    scene.trucks.some(truck => truck.length !== 10) ||
    scene.loose.length !== (warmUp ? facts.firstCars : facts.looseCars) ||
    scene.arriving.length !== (warmUp ? facts.moreCars : 0) ||
    dinoSceneCarCount(scene) !== facts.answer
  )
    throw new Error(`Dino artwork does not match authored scene: ${id}`);
  return scene;
}
