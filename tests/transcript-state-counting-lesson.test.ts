import { describe, expect, it } from "vitest";
import {
  COUNTING_LESSON_GRAPH,
  COUNTING_NODE_IDS,
  INITIAL_COUNTING_NODE_ID,
  isCountingNodeId,
  type CountingLessonNode,
  type CountingNodeId,
} from "../lib/lesson-runtime/counting-lesson";

describe("transcript-state spike authored lesson graph", () => {
  it("authors exactly the three requested activities with stable content IDs", () => {
    expect(Object.keys(COUNTING_LESSON_GRAPH)).toEqual(["count-1-duck", "count-2-ducks", "count-3-butterflies"]);
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
    ]);
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
      expect(id).toBe("count-3-butterflies");
      expect(node.onSuccess).toEqual({ kind: "complete" });
    }
  });

  it("reaches all three nodes in order, without cycles, and terminates on final success", () => {
    let currentId: CountingNodeId = INITIAL_COUNTING_NODE_ID;
    const visited: CountingNodeId[] = [];
    for (let step = 0; step < COUNTING_NODE_IDS.length; step++) {
      expect(visited).not.toContain(currentId);
      visited.push(currentId);
      const node: CountingLessonNode = COUNTING_LESSON_GRAPH[currentId];
      if (node.onSuccess.kind === "complete") {
        expect(currentId).toBe("count-3-butterflies");
        expect(visited).toEqual(["count-1-duck", "count-2-ducks", "count-3-butterflies"]);
        return;
      }
      currentId = node.onSuccess.nodeId;
    }
    throw new Error("The authored lesson must terminate within its three nodes");
  });

  it.each(COUNTING_NODE_IDS)("accepts authored ID %s", id => {
    expect(isCountingNodeId(id)).toBe(true);
  });

  it.each([
    "count-4-ducks",
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
