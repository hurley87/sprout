import { buildCountingLesson } from "./counting-lesson";

/** Authored quest order. One fixed order for v1; quests never change skill or difficulty at runtime. */
export const GARDEN_RESCUE_NODE_IDS = [
  "rescue-ducklings",
  "wake-butterflies",
  "grow-flowers",
  "fresh-challenge",
] as const;
export type GardenRescueNodeId = (typeof GARDEN_RESCUE_NODE_IDS)[number];

const quests = [
  {
    object: "duckling",
    quantity: 3,
    objective: "Identify the total of three displayed ducklings.",
    brief:
      "Rescue the ducklings: little ducklings are waiting to cross the pond to the garden. How many ducklings are waiting? If help is needed, invite pointing to each duckling. Success story idea: the ducklings are ready to paddle across.",
  },
  {
    object: "butterfly",
    quantity: 3,
    objective: "Identify the total of three displayed sleeping butterflies.",
    brief:
      "Wake the butterflies: some butterflies are fast asleep in the garden. How many sleeping butterflies do you see? Success story idea: counting them gently wakes them up.",
  },
  {
    object: "sprout",
    quantity: 4,
    objective: "Identify the total of four displayed sprouts.",
    brief:
      "Grow the flowers: little sprouts are waiting to bloom. How many little sprouts are waiting? Give extra time. Success story idea: counting the sprouts helps them bloom into flowers.",
  },
  {
    object: "butterfly",
    quantity: 4,
    objective: "Identify the total of four displayed butterflies in an arrangement not seen before.",
    brief:
      "A fresh counting challenge: the butterflies are awake and flying all around the garden. How many butterflies are flying now? Count only what is shown now; do not refer to earlier scenes. Success story idea: the garden is full of life again; warmly thank the child for helping the animals.",
  },
] as const;

export const GARDEN_RESCUE_LESSON = buildCountingLesson({
  id: "garden-rescue",
  initialNodeId: GARDEN_RESCUE_NODE_IDS[0],
  singleItemExample: "a single duckling",
  addressLearnerByName: true,
  nodes: Object.fromEntries(
    quests.map((quest, index) => {
      const id = GARDEN_RESCUE_NODE_IDS[index];
      return [
        id,
        {
          id,
          presentation: { sceneId: id, object: quest.object, quantity: quest.quantity },
          learningObjective: quest.objective,
          tutorBrief: quest.brief,
          onSuccess:
            index === quests.length - 1
              ? { kind: "complete" as const }
              : { kind: "node" as const, nodeId: GARDEN_RESCUE_NODE_IDS[index + 1] },
        },
      ];
    }),
  ),
});
