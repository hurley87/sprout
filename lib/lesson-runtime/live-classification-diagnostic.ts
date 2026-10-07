import {
  CLASSIFIER_VERSION,
  CONVERSATION_CLASSIFICATION_THRESHOLDS,
  normalizeConversationOutputs,
  interpretConversationOutputs,
  type ConversationStateDecision,
  type ConversationStateOutputs,
} from "./conversation-observer-contract";
import { isLessonNodeId, type LessonDefinition } from "./lesson-definition";
export type LiveClassificationDiagnostic = {
  classifierVersion: typeof CLASSIFIER_VERSION;
  decision: ConversationStateDecision["status"];
  outcome: ConversationStateDecision["outcome"];
  reason?: string;
  outputs: ConversationStateOutputs | null;
  labelCompletionEligible: boolean;
  thresholds: typeof CONVERSATION_CLASSIFICATION_THRESHOLDS;
  nodeId: string;
  transcriptRevision: number;
  elapsedMs: number;
};
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const reasons = [
  "invalid_input",
  "invalid_outputs",
  "cancelled",
  "provider_unconfigured",
  "provider_rejected",
  "provider_unreadable",
  "provider_unreachable",
  "provider_model_mismatch",
  "objectiveState_no_winner",
  "tutorState_no_winner",
  "objectiveState_competing_options",
  "tutorState_competing_options",
  "confirmation_without_completion",
  "no_confident_concept_observation",
];

/** Closed diagnostic projection only; never provider text, commands, or identity authority. */
export function parseLiveClassificationDiagnostic(
  value: unknown,
  lesson?: LessonDefinition,
  currentNodeId?: string,
): LiveClassificationDiagnostic | null {
  if (!record(value)) return null;
  if (
    value.classifierVersion !== CLASSIFIER_VERSION ||
    typeof value.nodeId !== "string" ||
    !Number.isSafeInteger(value.transcriptRevision) ||
    (value.transcriptRevision as number) < 0 ||
    typeof value.elapsedMs !== "number" ||
    !Number.isFinite(value.elapsedMs) ||
    value.elapsedMs < 0 ||
    !record(value.thresholds) ||
    Object.entries(CONVERSATION_CLASSIFICATION_THRESHOLDS).some(
      ([key, expected]) => (value.thresholds as Record<string, unknown>)[key] !== expected,
    )
  )
    return null;
  if (lesson && (!isLessonNodeId(lesson, value.nodeId) || (currentNodeId !== undefined && currentNodeId !== value.nodeId)))
    return null;
  if (
    !["accepted", "abstained"].includes(value.decision as string) ||
    !["allow_semantic_completion_evidence", "hold_scene", "unresolved"].includes(value.outcome as string) ||
    typeof value.labelCompletionEligible !== "boolean"
  )
    return null;
  if (value.decision === "abstained" && (typeof value.reason !== "string" || !reasons.includes(value.reason)))
    return null;
  if (value.decision === "accepted" && value.reason !== undefined) return null;
  let outputs: ConversationStateOutputs | null = null;
  if (record(value.outputs)) {
    if (
      Object.keys(value.outputs).some(key => !["objectiveState", "tutorState", "concepts", "sources"].includes(key)) ||
      (!lesson && value.outputs.concepts !== undefined)
    )
      return null;
    const authoredConcepts = lesson && isLessonNodeId(lesson, value.nodeId) ? lesson.nodes[value.nodeId].concepts ?? [] : [];
    const concepts = value.outputs.concepts;
    if (concepts !== undefined && !record(concepts)) return null;
    if ((authoredConcepts.length > 0) !== (concepts !== undefined)) return null;
    if (concepts && Object.keys(concepts).some(id => !authoredConcepts.some(concept => `concept_${concept.id}` === id))) return null;
    const answers: Record<string, unknown> = {};
    for (const id of ["objectiveState", "tutorState"]) {
      const output = value.outputs[id];
      answers[id] = record(output) ? { ...output, type: "choice" } : output;
    }
    if (concepts)
      for (const [id, output] of Object.entries(concepts))
        answers[id] = record(output) ? { ...output, type: "choice" } : output;
    if (value.outputs.sources !== undefined) {
      if (!record(value.outputs.sources)) return null;
      for (const [id, output] of Object.entries(value.outputs.sources))
        answers[id] = record(output) ? { ...output, type: "choice" } : output;
    }
    outputs = normalizeConversationOutputs({ answers }, lesson, lesson ? value.nodeId as string : undefined);
  }
  else if (value.outputs !== null) return null;
  if (value.outputs !== null && !outputs) return null;
  if (value.decision === "accepted" && (!outputs || value.outcome === "unresolved")) return null;
  if (value.decision === "abstained" && value.outcome !== "unresolved") return null;
  const interpretation = outputs ? interpretConversationOutputs(outputs, lesson, value.nodeId) : null;
  const labelCompletionEligible = interpretation?.labelCompletionEligible ?? false;
  const completionEligible = interpretation?.completionEligible ?? false;
  const genericConfident = interpretation?.genericConfident ?? false;
  const hasConceptQuestions = interpretation?.hasConceptQuestions ?? false;
  const confidentConcepts = !!interpretation?.conceptObservations.length;
  if (
    value.labelCompletionEligible !== labelCompletionEligible ||
    (value.decision === "accepted" &&
      (!outputs || (hasConceptQuestions ? (!completionEligible && !confidentConcepts) : !genericConfident) ||
        (value.outcome === "allow_semantic_completion_evidence") !== completionEligible ||
        (value.outcome === "hold_scene") !== !completionEligible)) ||
    (value.decision === "abstained" && value.reason === "no_confident_concept_observation" &&
      (!outputs?.concepts || completionEligible || confidentConcepts))
  )
    return null;
  return {
    classifierVersion: CLASSIFIER_VERSION,
    decision: value.decision as ConversationStateDecision["status"],
    outcome: value.outcome as ConversationStateDecision["outcome"],
    ...(value.reason ? { reason: value.reason as string } : {}),
    outputs,
    labelCompletionEligible,
    thresholds: { ...CONVERSATION_CLASSIFICATION_THRESHOLDS },
    nodeId: value.nodeId,
    transcriptRevision: value.transcriptRevision as number,
    elapsedMs: value.elapsedMs,
  };
}
