/** Issue #55 experiment only; not the production lesson sequence. */
export type CountingNodeId = "count-1-duck" | "count-2-ducks" | "count-3-butterflies";

export type CountingNode = {
  readonly id: CountingNodeId;
  readonly scene: {
    readonly id: string;
    readonly object: "duck" | "butterfly";
    readonly quantity: number;
    readonly emoji: string;
  };
  readonly objective: string;
  readonly tutorBrief: string;
  readonly success: { readonly type: "node"; readonly nodeId: CountingNodeId } | { readonly type: "complete" };
};

export const COUNTING_GRAPH = {
  entry: "count-1-duck",
  nodes: {
    "count-1-duck": {
      id: "count-1-duck",
      scene: { id: "hello-duck", object: "duck", quantity: 1, emoji: "🦆" },
      objective: "The child identifies that there is one duck in the displayed group.",
      tutorBrief: "Invite the child to count the displayed duck. Give time to answer and clarify if needed.",
      success: { type: "node", nodeId: "count-2-ducks" },
    },
    "count-2-ducks": {
      id: "count-2-ducks",
      scene: { id: "duck-friends", object: "duck", quantity: 2, emoji: "🦆" },
      objective: "The child identifies that there are two ducks in the displayed group.",
      tutorBrief: "Invite the child to count the displayed ducks. Support counting one at a time if needed.",
      success: { type: "node", nodeId: "count-3-butterflies" },
    },
    "count-3-butterflies": {
      id: "count-3-butterflies",
      scene: { id: "butterfly-garden", object: "butterfly", quantity: 3, emoji: "🦋" },
      objective: "The child identifies that there are three butterflies in the displayed group.",
      tutorBrief: "Invite the child to count the displayed butterflies. Allow a complete count and self-correction.",
      success: { type: "complete" },
    },
  },
  // Application-owned terminal behavior, not an additional teaching node.
  // Applied only after the same validated completion/speech-drain gate as a node edge.
  completion: { scene: "retain-current", tutor: "brief-goodbye-then-silent" },
} as const satisfies {
  entry: CountingNodeId;
  nodes: Readonly<Record<CountingNodeId, CountingNode>>;
  completion: { scene: "retain-current"; tutor: "brief-goodbye-then-silent" };
};
