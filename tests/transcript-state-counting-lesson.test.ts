import { describe, expect, it } from "vitest";
import { validateLessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import {
  COUNTING_LESSON,
  COUNTING_LESSON_GRAPH,
  COUNTING_NODE_IDS,
  INITIAL_COUNTING_NODE_ID,
  isCountingNodeId,
  type CountingLessonNode,
  type CountingNodeId,
} from "../lib/lesson-runtime/counting-lesson";

describe("transcript-state spike authored lesson graph", () => {
  it("authors exactly the six adventure activities with stable content IDs", () => {
    expect(Object.keys(COUNTING_LESSON_GRAPH)).toEqual([...COUNTING_NODE_IDS]);
    expect(
      Object.values(COUNTING_LESSON_GRAPH).map(({ id, sceneId, object, quantity }) => ({
        id,
        sceneId,
        object,
        quantity,
      })),
    ).toEqual([
      { id: "count-1-duck", sceneId: "hello-duck", object: "duck", quantity: 1 },
      { id: "count-2-ducks", sceneId: "duck-friends", object: "duck", quantity: 2 },
      { id: "count-3-butterflies", sceneId: "butterfly-garden", object: "butterfly", quantity: 3 },
      { id: "count-3-ducklings", sceneId: "duckling-parade", object: "duck", quantity: 3 },
      { id: "count-4-flowers", sceneId: "flowers-bloom", object: "flower", quantity: 4 },
      { id: "count-3-moved-butterflies", sceneId: "butterflies-move", object: "butterfly", quantity: 3 },
    ]);
  });

  it("covers one through four, unique scenes, and a familiar quantity in a new arrangement", () => {
    const nodes = Object.values(COUNTING_LESSON_GRAPH);
    expect(new Set(nodes.map(node => node.quantity))).toEqual(new Set([1, 2, 3, 4]));
    expect(nodes.every(node => node.quantity >= 1 && node.quantity <= 4)).toBe(true);
    expect(new Set(nodes.map(node => node.sceneId)).size).toBe(nodes.length);
    const moved = COUNTING_LESSON_GRAPH["count-3-moved-butterflies"];
    const familiar = COUNTING_LESSON_GRAPH["count-3-butterflies"];
    expect({ object: moved.object, quantity: moved.quantity }).toEqual({
      object: familiar.object,
      quantity: familiar.quantity,
    });
    expect(moved.sceneId).not.toBe(familiar.sceneId);
  });

  it("validates the six-node graph and its terminal completion edge", () => {
    expect(validateLessonDefinition(COUNTING_LESSON)).toBe(COUNTING_LESSON);
    expect(Object.keys(COUNTING_LESSON.nodes)).toHaveLength(6);
    expect(Object.values(COUNTING_LESSON.nodes).filter(node => node.onSuccess.kind === "complete")).toEqual([
      expect.objectContaining({ id: "count-3-moved-butterflies" }),
    ]);
    // A lightweight completion screen needs no terminal recap node or new runtime capability.
    expect(Object.values(COUNTING_LESSON.nodes).some(node => node.completeAfterTutorOutput)).toBe(false);
    const broken = {
      ...COUNTING_LESSON,
      nodes: {
        ...COUNTING_LESSON.nodes,
        "count-4-flowers": {
          ...COUNTING_LESSON.nodes["count-4-flowers"],
          onSuccess: { kind: "node", nodeId: "count-5-flowers" },
        },
      },
    } as const;
    expect(() => validateLessonDefinition(broken)).toThrow(/unknown node/);
  });

  it.each(COUNTING_NODE_IDS)("provides authored guidance and a resolving success edge for %s", id => {
    const node: CountingLessonNode = COUNTING_LESSON_GRAPH[id];
    expect(node.id).toBe(id);
    expect(node.learningObjective.trim()).not.toBe("");
    expect(node.tutorBrief.trim()).not.toBe("");
    if (node.onSuccess.kind === "node") {
      expect(isCountingNodeId(node.onSuccess.nodeId)).toBe(true);
      expect(COUNTING_LESSON_GRAPH[node.onSuccess.nodeId].id).toBe(node.onSuccess.nodeId);
    } else {
      expect(id).toBe("count-3-moved-butterflies");
      expect(node.onSuccess).toEqual({ kind: "complete" });
    }
  });

  it("reaches all six nodes in authored order, without cycles, and terminates on final success", () => {
    let currentId: CountingNodeId = INITIAL_COUNTING_NODE_ID;
    const visited: CountingNodeId[] = [];
    for (let step = 0; step < COUNTING_NODE_IDS.length; step++) {
      expect(visited).not.toContain(currentId);
      visited.push(currentId);
      const node: CountingLessonNode = COUNTING_LESSON_GRAPH[currentId];
      if (node.onSuccess.kind === "complete") {
        expect(currentId).toBe("count-3-moved-butterflies");
        expect(visited).toEqual([...COUNTING_NODE_IDS]);
        return;
      }
      currentId = node.onSuccess.nodeId;
    }
    throw new Error("The authored lesson must terminate within its six nodes");
  });

  it.each(COUNTING_NODE_IDS)("accepts authored ID %s", id => {
    expect(isCountingNodeId(id)).toBe(true);
  });

  it.each([
    "count-4-ducks",
    "count-3-butterflies-moved",
    "duckling-parade",
    "hello-duck",
    "count-1-duck ",
    "COUNT-1-DUCK",
    "__proto__",
    "constructor",
    "",
    1,
    null,
    undefined,
    {},
  ])("rejects an unauthored node ID: %j", id => {
    expect(isCountingNodeId(id)).toBe(false);
  });
});
