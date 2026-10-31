/** Minimum application-authored content needed by the shared tutoring runtime. */
export type LessonNodeDefinition = {
  readonly id: string;
  readonly presentation: Readonly<Record<string, string | number | boolean>>;
  readonly learningObjective: string;
  readonly tutorBrief: string;
  /** Assess the saved conversation when this scene's render is confirmed, before steering. */
  readonly assessConversationOnEntry?: boolean;
  /** Terminal presentation: complete after observed tutor output drains, without a learner answer. */
  readonly completeAfterTutorOutput?: boolean;
  /** Opt in to current spoken-rewrite selection, separate from cumulative mastery. */
  readonly currentRewrite?: boolean;
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

export type QuestionGroupDefinition = {
  readonly questionId: string;
  readonly nodeIds: readonly string[];
};

export type LessonDefinition = {
  readonly id: string;
  readonly initialNodeId: string;
  /** Mathematical actions use a separate reviewed path; generic closure cannot advance. */
  readonly calculus?: true;
  /** Hold accepted scene transitions until the application confirms the reveal was reviewed. */
  readonly requirePresentationConfirmation?: boolean;
  /** Conversational closure advances independently of assessment/mastery. */
  readonly conversationFirst?: boolean;
  /** Opt in to ordered subpart/parent navigation and counted question progress. */
  readonly questionGroups?: readonly QuestionGroupDefinition[];
  /** Counting may accept learner answers independently of tutor confirmation. */
  readonly answerAcceptance?: "learner_evidence";
  /** Sustained tutor-audio quiet before an accepted scene transition. It must outlast the tutor's
   * pauses between sentences: audio that resumes during an unconfirmed render ends the attempt. */
  readonly transitionQuietMs?: number;
  /** Greet the learner by the server-configured first name (SPROUT_CHILD_NAME), when one is set. */
  readonly addressLearnerByName?: boolean;
  /** Concise topic labels for an accepted-evidence terminal close. No answer text. */
  readonly recapTopics?: Readonly<Record<string, string>>;
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
    if (node.completeAfterTutorOutput && (node.onSuccess.kind !== "complete" || node.concepts?.length))
      throw new Error(`Lesson node ${id} must be terminal and have no criteria to complete after tutor output`);
    if (
      node.currentRewrite &&
      (node.currentRewrite !== true ||
        typeof node.presentation.sourceText !== "string" ||
        !node.presentation.sourceText.trim() ||
        ["meaning", "concise", "grammatical"].some(id => !node.concepts?.some(concept => concept.id === id)))
    )
      throw new Error(`Lesson node ${id} needs a source sentence and three authored rewrite criteria`);
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
  if (
    value.transitionQuietMs !== undefined &&
    (!Number.isSafeInteger(value.transitionQuietMs) || value.transitionQuietMs <= 0 || value.transitionQuietMs > 5_000)
  )
    throw new Error("Transition quiet must be a positive whole number of milliseconds up to 5000");
  if (value.questionGroups) {
    const groups = value.questionGroups;
    const ids = groups.flatMap(group => group.nodeIds);
    if (
      !value.conversationFirst ||
      !groups.length ||
      new Set(groups.map(group => group.questionId)).size !== groups.length ||
      groups.some(group => !group.questionId || !group.nodeIds.length) ||
      new Set(ids).size !== ids.length ||
      ids.some(id => !value.nodes[id] || value.nodes[id].completeAfterTutorOutput) ||
      ids[0] !== value.initialNodeId ||
      Object.values(value.nodes).some(node => !node.completeAfterTutorOutput && !ids.includes(node.id))
    )
      throw new Error("Question groups must partition the authored conversation nodes in order");
    for (const [index, id] of ids.entries()) {
      const edge = value.nodes[id].onSuccess;
      if (
        edge.kind !== "node" ||
        (ids[index + 1] ? edge.nodeId !== ids[index + 1] : !value.nodes[edge.nodeId].completeAfterTutorOutput)
      )
        throw new Error("Question groups must follow the authored node edges to a terminal recap");
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
    ...(node.concepts?.length
      ? {
          // Private assessment targets, not presentation/reveal payloads.
          completionCriteria: node.concepts,
          completionPolicy: node.completionPolicy,
        }
      : {}),
  };
}

/** One counted parent question across every subpart; recap is not another question. */
export function authoredQuestionProgress(lesson: LessonDefinition, nodeId: string) {
  const groups = lesson.questionGroups;
  if (!groups) return null;
  const index = groups.findIndex(group => group.nodeIds.includes(nodeId));
  if (index < 0) return null;
  const group = groups[index];
  return {
    questionId: group.questionId,
    questionNumber: index + 1,
    questionCount: groups.length,
    subpartNumber: group.nodeIds.indexOf(nodeId) + 1,
    subpartCount: group.nodeIds.length,
  };
}

/** Authored node order: follow success edges from the initial node to completion. */
export function lessonNodeOrder(lesson: LessonDefinition): string[] {
  const ids: string[] = [];
  for (let id = lesson.initialNodeId; ;) {
    const node = lesson.nodes[id];
    if (!isLessonNodeId(lesson, id) || ids.includes(id)) throw new Error(`Invalid lesson graph at ${id}`);
    ids.push(id);
    if (node.onSuccess.kind === "complete") return ids;
    id = node.onSuccess.nodeId;
  }
}
