/** Minimum application-authored content needed by the shared tutoring runtime. */
export type LessonNodeDefinition = {
  readonly id: string;
  readonly presentation: Readonly<Record<string, string | number | boolean>>;
  readonly learningObjective: string;
  readonly tutorBrief: string;
  readonly concepts?: readonly ConceptCriterionDefinition[];
  /** `allow_unresolved` is an explicit early-exit policy; unresolved concepts stay unresolved. */
  readonly completionPolicy?: "all_demonstrated" | "all_independent" | "allow_unresolved";
  readonly onSuccess:
    | { readonly kind: "node"; readonly nodeId: string; readonly carryForwardCriteria?: readonly string[] }
    | { readonly kind: "complete"; readonly carryForwardCriteria?: readonly string[] };
};

export type ConceptCriterionDefinition = {
  readonly id: string;
  readonly description: string;
};

export type LessonDefinition = {
  readonly id: string;
  readonly initialNodeId: string;
  /** Hold accepted scene transitions until the application confirms the reveal was reviewed. */
  readonly requirePresentationConfirmation?: boolean;
  /** Conversational closure advances independently of assessment/mastery. */
  readonly conversationFirst?: boolean;
  readonly nodes: Readonly<Record<string, LessonNodeDefinition>>;
  readonly recovery: {
    readonly supportClarificationInstruction: string;
    readonly answerRecoveryInstruction: string;
  };
  readonly tutor: {
    readonly persona: string;
    readonly sessionGuidance: string;
    readonly startInstruction: string;
    readonly nodeInstruction: string;
  };
  readonly classifier: {
    readonly objectiveInstructions: string;
    readonly objectiveCriteria: Readonly<Record<string, string>>;
    readonly tutorInstructions: string;
    readonly tutorCriteria: Readonly<Record<string, string>>;
  };
};

export const OBJECTIVE_CRITERIA_IDS = [
  "completed",
  "incorrect",
  "unclear_or_incomplete",
  "unresolved_help",
  "no_attempt",
] as const;
export const TUTOR_CRITERIA_IDS = ["confirmed_completion", "clarifying", "helping", "asking", "other"] as const;

export function validateLessonDefinition(value: LessonDefinition): LessonDefinition {
  if (!value.id || !Object.hasOwn(value.nodes, value.initialNodeId))
    throw new Error("Lesson needs an authored initial node");
  for (const [id, node] of Object.entries(value.nodes)) {
    if (id !== node.id) throw new Error(`Lesson node key does not match node identity: ${id}`);
    if (node.onSuccess.kind === "node" && !Object.hasOwn(value.nodes, node.onSuccess.nodeId))
      throw new Error(`Lesson edge from ${id} targets an unknown node`);
    if ((node.concepts?.length ?? 0) > 0 && !node.completionPolicy)
      throw new Error(`Lesson node ${id} needs an authored concept completion policy`);
    if (
      node.completionPolicy &&
      !["all_demonstrated", "all_independent", "allow_unresolved"].includes(node.completionPolicy)
    )
      throw new Error(`Lesson node ${id} has an unknown concept completion policy`);
    if (node.concepts && new Set(node.concepts.map(concept => concept.id)).size !== node.concepts.length)
      throw new Error(`Lesson node ${id} has duplicate concept criteria`);
    if (node.concepts?.some(concept => !/^[a-z0-9][a-z0-9_-]*$/i.test(concept.id) || !concept.description.trim()))
      throw new Error(`Lesson node ${id} has an invalid concept criterion`);
    if (new Set(node.onSuccess.carryForwardCriteria ?? []).size !== (node.onSuccess.carryForwardCriteria ?? []).length)
      throw new Error(`Lesson edge from ${id} repeats a carried concept criterion`);
    for (const criterionId of node.onSuccess.carryForwardCriteria ?? []) {
      if (!node.concepts?.some(concept => concept.id === criterionId))
        throw new Error(`Lesson edge from ${id} carries a concept not authored on its source node`);
      if (
        node.onSuccess.kind === "node" &&
        !value.nodes[node.onSuccess.nodeId].concepts?.some(concept => concept.id === criterionId)
      )
        throw new Error(`Lesson edge from ${id} carries a concept not authored on its target node`);
    }
  }
  if (!Object.keys(value.classifier.objectiveCriteria).length || !Object.keys(value.classifier.tutorCriteria).length)
    throw new Error("Lesson classifier criteria must be authored");
  if (
    JSON.stringify(Object.keys(value.classifier.objectiveCriteria)) !== JSON.stringify(OBJECTIVE_CRITERIA_IDS) ||
    JSON.stringify(Object.keys(value.classifier.tutorCriteria)) !== JSON.stringify(TUTOR_CRITERIA_IDS)
  )
    throw new Error("Lesson criteria must preserve the classifier's closed output labels");
  return value;
}

export function isLessonNodeId(lesson: LessonDefinition, value: unknown): value is string {
  return typeof value === "string" && Object.hasOwn(lesson.nodes, value);
}

/** Expose only current-node facts; authored edges and future nodes stay application-side. */
export function currentNodeContext(lesson: LessonDefinition, nodeId: string) {
  if (!isLessonNodeId(lesson, nodeId)) throw new Error("Unknown current lesson node");
  const node = lesson.nodes[nodeId];
  const { sceneId, ...sceneFacts } = node.presentation;
  return {
    nodeId: node.id,
    scene: { id: String(sceneId ?? node.id), ...sceneFacts },
    learningObjective: node.learningObjective,
    tutorBrief: node.tutorBrief,
    ...(node.concepts?.length ? {
      // Private assessment targets, not presentation/reveal payloads.
      completionCriteria: node.concepts,
      completionPolicy: node.completionPolicy,
    } : {}),
  };
}
