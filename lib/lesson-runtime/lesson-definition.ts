/** Minimum application-authored content needed by the shared tutoring runtime. */
export type LessonNodeDefinition = {
  readonly id: string;
  readonly presentation: Readonly<Record<string, string | number | boolean>>;
  readonly learningObjective: string;
  readonly tutorBrief: string;
  readonly onSuccess: { readonly kind: "node"; readonly nodeId: string } | { readonly kind: "complete" };
};

export type LessonDefinition = {
  readonly id: string;
  readonly initialNodeId: string;
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

export const OBJECTIVE_CRITERIA_IDS = ["completed", "incorrect", "unclear_or_incomplete", "unresolved_help", "no_attempt"] as const;
export const TUTOR_CRITERIA_IDS = ["confirmed_completion", "clarifying", "helping", "asking", "other"] as const;

export function validateLessonDefinition(value: LessonDefinition): LessonDefinition {
  if (!value.id || !Object.hasOwn(value.nodes, value.initialNodeId)) throw new Error("Lesson needs an authored initial node");
  for (const [id, node] of Object.entries(value.nodes)) {
    if (id !== node.id) throw new Error(`Lesson node key does not match node identity: ${id}`);
    if (node.onSuccess.kind === "node" && !Object.hasOwn(value.nodes, node.onSuccess.nodeId))
      throw new Error(`Lesson edge from ${id} targets an unknown node`);
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
  };
}
