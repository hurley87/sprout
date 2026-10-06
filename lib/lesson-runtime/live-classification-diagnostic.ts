import {
  CLASSIFIER_VERSION,
  CONVERSATION_CLASSIFICATION_THRESHOLDS,
  normalizeConversationOutputs,
  type ConversationStateDecision,
  type ConversationStateOutputs,
} from "./conversation-observer-contract";
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
];

/** Closed diagnostic projection only; never provider text, commands, or identity authority. */
export function parseLiveClassificationDiagnostic(value: unknown): LiveClassificationDiagnostic | null {
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
  if (record(value.outputs))
    outputs = normalizeConversationOutputs({
      answers: Object.fromEntries(
        Object.entries(value.outputs).map(([id, output]) => [
          id,
          record(output) ? { ...output, type: "choice" } : output,
        ]),
      ),
    });
  else if (value.outputs !== null) return null;
  if (value.outputs !== null && !outputs) return null;
  if (value.decision === "accepted" && (!outputs || value.outcome === "unresolved")) return null;
  if (value.decision === "abstained" && value.outcome !== "unresolved") return null;
  const eligible =
    outputs?.objectiveState.choice === "completed" && outputs?.tutorState.choice === "confirmed_completion";
  if (
    value.labelCompletionEligible !== eligible ||
    (value.decision === "accepted" && (value.outcome === "allow_semantic_completion_evidence") !== eligible)
  )
    return null;
  return {
    classifierVersion: CLASSIFIER_VERSION,
    decision: value.decision as ConversationStateDecision["status"],
    outcome: value.outcome as ConversationStateDecision["outcome"],
    ...(value.reason ? { reason: value.reason as string } : {}),
    outputs,
    labelCompletionEligible: eligible,
    thresholds: { ...CONVERSATION_CLASSIFICATION_THRESHOLDS },
    nodeId: value.nodeId,
    transcriptRevision: value.transcriptRevision as number,
    elapsedMs: value.elapsedMs,
  };
}
