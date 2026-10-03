import { describe, expect, it } from "vitest";
import { COUNTING_GRAPH, type CountingNode, type CountingNodeId } from "../lib/counting-graph";
import { countingTutorContext, countingTutorInstructions } from "../lib/counting-graph-tutor";

describe("authored counting graph", () => {
  it("has consistent stable IDs, complete teaching content, and only existing success targets", () => {
    const nodes = COUNTING_GRAPH.nodes;
    expect(nodes).toHaveProperty(COUNTING_GRAPH.entry);
    expect(new Set(Object.values(nodes).map(node => node.scene.id)).size).toBe(3);
    for (const [id, node] of Object.entries(nodes) as [CountingNodeId, CountingNode][]) {
      expect(node.id).toBe(id);
      expect(node.objective.trim().length).toBeGreaterThan(0);
      expect(node.tutorBrief.trim().length).toBeGreaterThan(0);
      expect(node.scene.id.trim().length).toBeGreaterThan(0);
      expect(node.scene.emoji.trim().length).toBeGreaterThan(0);
      expect(Number.isInteger(node.scene.quantity)).toBe(true);
      expect(node.scene.quantity).toBeGreaterThan(0);
      if (node.success.type === "node") expect(nodes).toHaveProperty(node.success.nodeId);
    }
  });

  it("follows exactly the three authored groups and completes without another teaching node", () => {
    const visited: CountingNodeId[] = [];
    const groups: [string, number][] = [];
    let node: CountingNode = COUNTING_GRAPH.nodes[COUNTING_GRAPH.entry];
    while (true) {
      expect(visited).not.toContain(node.id); // Reject cycles rather than hanging.
      visited.push(node.id);
      groups.push([node.scene.object, node.scene.quantity]);
      if (node.success.type === "complete") break;
      node = COUNTING_GRAPH.nodes[node.success.nodeId];
    }
    expect(visited).toEqual(["count-1-duck", "count-2-ducks", "count-3-butterflies"]);
    expect(groups).toEqual([
      ["duck", 1],
      ["duck", 2],
      ["butterfly", 3],
    ]);
    expect(new Set(visited)).toEqual(new Set(Object.keys(COUNTING_GRAPH.nodes)));
    expect(node.success).toEqual({ type: "complete" });
    expect(COUNTING_GRAPH.completion).toEqual({ scene: "retain-current", tutor: "brief-goodbye-then-silent" });
  });
});

describe("current-node tutor isolation", () => {
  it.each(Object.keys(COUNTING_GRAPH.nodes) as CountingNodeId[])("exposes only teaching facts for %s", id => {
    const node = COUNTING_GRAPH.nodes[id];
    const context = countingTutorContext(id);
    expect(context).toEqual({ id, scene: node.scene, objective: node.objective, tutorBrief: node.tutorBrief });
    expect(Object.keys(context).sort()).toEqual(["id", "objective", "scene", "tutorBrief"]);
    const instructions = countingTutorInstructions(id);
    expect(instructions).toContain(JSON.stringify(context));
    for (const other of Object.values(COUNTING_GRAPH.nodes).filter(other => other.id !== id)) {
      for (const privateFact of [other.id, other.scene.id, other.objective, other.tutorBrief]) {
        expect(instructions).not.toContain(privateFact);
      }
    }
    // No references handed to the tutor projection can mutate the authored scene.
    expect(context.scene).not.toBe(node.scene);
  });
});
