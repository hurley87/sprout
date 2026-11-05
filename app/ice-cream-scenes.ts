import type { LessonNodeDefinition } from "@/lib/lesson-runtime/lesson-definition";

export type ScoopColour = "pink" | "yellow" | "chocolate";
export type IceCreamObject = {
  readonly asset: "cone" | `scoop-${ScoopColour}` | "cherry" | "sprinkles";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly placed?: boolean;
  readonly tub?: boolean;
};
export type IceCreamScene = {
  readonly label: string;
  readonly facts: Readonly<Record<string, string | number | boolean>>;
  readonly objects: readonly IceCreamObject[];
};

const cone = (x: number, y: number, width: number): IceCreamObject => ({ asset: "cone", x, y, width });
const scoop = (
  colour: ScoopColour,
  x: number,
  y: number,
  width: number,
  extra: { placed?: boolean; tub?: boolean } = {},
): IceCreamObject => ({ asset: `scoop-${colour}`, x, y, width, ...extra });
const tubs = [scoop("pink", 0.17, 0.7, 0.22, { tub: true }), scoop("yellow", 0.83, 0.7, 0.22, { tub: true })];

export const ICE_CREAM_SCENES: Readonly<Record<string, IceCreamScene>> = {
  "open-shop": {
    label: "Ice cream counter with empty cones",
    facts: { answerKind: "count", answer: 2, object: "cone", quantity: 2 },
    objects: [cone(0.3, 0.59, 0.31), cone(0.7, 0.59, 0.31)],
  },
  "pink-scoop": {
    label: "A pink strawberry scoop",
    facts: { answerKind: "colour", answer: "pink", choices: "pink or yellow" },
    objects: [scoop("pink", 0.5, 0.5, 0.48)],
  },
  "pink-scoops": {
    label: "Pink strawberry and yellow lemon scoops on display",
    facts: { answerKind: "count", answer: 2, object: "pink scoop", quantity: 2, distractor: "one yellow scoop" },
    objects: [scoop("pink", 0.18, 0.51, 0.34), scoop("yellow", 0.5, 0.51, 0.34), scoop("pink", 0.82, 0.51, 0.34)],
  },
  "build-first": {
    label: "An empty cone with pink strawberry and yellow lemon tubs",
    facts: { answerKind: "order_step", answer: "pink", step: 1, steps: 2, order: "pink first, then yellow" },
    objects: [cone(0.5, 0.72, 0.29), ...tubs],
  },
  "build-second": {
    label: "A cone with a pink strawberry scoop and pink strawberry and yellow lemon tubs",
    facts: { answerKind: "order_step", answer: "yellow", step: 2, steps: 2, order: "pink first, then yellow" },
    objects: [cone(0.5, 0.72, 0.29), scoop("pink", 0.5, 0.51, 0.27, { placed: true }), ...tubs],
  },
  "tall-cone": {
    label: "A tall cone with pink strawberry, yellow lemon, and chocolate chip scoops",
    facts: { answerKind: "count", answer: 3, object: "scoop", quantity: 3 },
    objects: [
      cone(0.5, 0.78, 0.27),
      scoop("pink", 0.5, 0.59, 0.25, { placed: true }),
      scoop("yellow", 0.5, 0.4, 0.25, { placed: true }),
      scoop("chocolate", 0.5, 0.21, 0.25, { placed: true }),
    ],
  },
};

export const ICE_CREAM_FINALE: readonly IceCreamObject[] = [
  cone(0.3, 0.77, 0.25),
  scoop("pink", 0.3, 0.59, 0.23, { placed: true }),
  scoop("yellow", 0.3, 0.41, 0.23, { placed: true }),
  cone(0.7, 0.77, 0.25),
  scoop("pink", 0.7, 0.59, 0.23, { placed: true }),
  scoop("yellow", 0.7, 0.41, 0.23, { placed: true }),
  scoop("chocolate", 0.7, 0.23, 0.23, { placed: true }),
  { asset: "cherry", x: 0.3, y: 0.27, width: 0.09 },
  { asset: "sprinkles", x: 0.7, y: 0.23, width: 0.17 },
];

export function iceCreamScene(
  node: LessonNodeDefinition,
  scenes: Readonly<Record<string, IceCreamScene>> = ICE_CREAM_SCENES,
): IceCreamScene {
  const id = String(node.presentation.sceneId);
  const scene = Object.hasOwn(scenes, id) ? scenes[id] : undefined;
  const count = (asset: string) => scene?.objects.filter(object => object.asset === asset && !object.tub).length ?? 0;
  const placed = scene?.objects
    .filter(object => object.placed)
    .map(object => object.asset)
    .join(",");
  const validObjects =
    id === "open-shop"
      ? count("cone") === 2 && scene?.objects.length === 2
      : id === "pink-scoop"
        ? count("scoop-pink") === 1 && scene?.objects.length === 1
        : id === "pink-scoops"
          ? count("scoop-pink") === 2 && count("scoop-yellow") === 1 && scene?.objects.length === 3
          : id === "build-first"
            ? count("cone") === 1 && placed === "" && scene?.objects.length === 3
            : id === "build-second"
              ? count("cone") === 1 && placed === "scoop-pink" && scene?.objects.length === 4
              : id === "tall-cone" &&
                count("cone") === 1 &&
                scene?.objects.length === 4 &&
                placed === "scoop-pink,scoop-yellow,scoop-chocolate";
  if (
    !scene ||
    Object.entries(ICE_CREAM_SCENES[id]?.facts ?? {}).some(
      ([key, value]) => node.presentation[key] !== value || scene.facts[key] !== value,
    ) ||
    !validObjects ||
    ((id === "build-first" || id === "build-second") &&
      scene.objects
        .filter(object => object.tub)
        .map(object => object.asset)
        .join(",") !== "scoop-pink,scoop-yellow")
  )
    throw new Error(`Ice cream artwork does not match authored scene: ${id}`);
  return scene;
}
