export const COUNTING_NODE_IDS = ["count-1-duck", "count-2-ducks", "count-3-butterflies"] as const;
export type CountingNodeId = (typeof COUNTING_NODE_IDS)[number];

/** Authored application behavior on success; never part of a ConversationStateProposal. */
export type CountingSuccessEdge =
  { readonly kind: "node"; readonly nodeId: CountingNodeId } | { readonly kind: "complete" };

export type CountingLessonNode = {
  readonly id: CountingNodeId;
  readonly sceneId: "hello-duck" | "duck-friends" | "butterfly-garden";
  readonly object: "duck" | "butterfly";
  readonly quantity: 1 | 2 | 3;
  readonly learningObjective: string;
  readonly tutorBrief: string;
  readonly onSuccess: CountingSuccessEdge;
};

export const INITIAL_COUNTING_NODE_ID: CountingNodeId = "count-1-duck";

/** Authored graph used by the root lesson; scene IDs identify its counting content. */
export const COUNTING_LESSON_GRAPH = {
  "count-1-duck": {
    id: "count-1-duck",
    sceneId: "hello-duck",
    object: "duck",
    quantity: 1,
    learningObjective: "Identify the total of one displayed duck.",
    tutorBrief:
      "Ask how many ducks the child sees. Allow thinking time and clarify unclear speech. For help, invite the child to point to the duck and count it themselves, then wait. Do not supply a counting word: starting the count reveals the total on this scene.",
    onSuccess: { kind: "node", nodeId: "count-2-ducks" },
  },
  "count-2-ducks": {
    id: "count-2-ducks",
    sceneId: "duck-friends",
    object: "duck",
    quantity: 2,
    learningObjective: "Identify the total of two displayed ducks.",
    tutorBrief:
      "Ask how many ducks the child sees. If help is needed, invite the child to point to each duck and say the counting words themselves, then wait without starting or finishing the count or giving the total.",
    onSuccess: { kind: "node", nodeId: "count-3-butterflies" },
  },
  "count-3-butterflies": {
    id: "count-3-butterflies",
    sceneId: "butterfly-garden",
    object: "butterfly",
    quantity: 3,
    learningObjective: "Identify the total of three displayed butterflies.",
    tutorBrief:
      "Ask how many butterflies the child sees. Allow counting. For help, invite the child to point to each butterfly and say the counting words themselves, then wait without starting or finishing the count or giving the total.",
    // Successful completion ends this lesson; there is no next node or wrap-up scene.
    onSuccess: { kind: "complete" },
  },
} as const satisfies Readonly<Record<CountingNodeId, CountingLessonNode>>;

export function isCountingNodeId(value: unknown): value is CountingNodeId {
  return typeof value === "string" && COUNTING_NODE_IDS.includes(value as CountingNodeId);
}
