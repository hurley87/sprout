/** Browser-safe experiment contract. No provider transport or credentials. */
export type AcknowledgmentMode = "grok-only" | "grok-jev";
export const ACK_MODEL = "jev-1.14.0";
// Diagnostic recognition threshold, not empirically calibrated and never a progression gate.
export const ACK_THRESHOLD = 0.95;
export const ACK_DEADLINE_MS = 5000;
export type AckInput = {
  nodeId: string;
  expectedAnswer: string;
  learner: string;
  tutor: string;
  requestId: string;
};
export const ACK_REASONS = [
  "confirmed",
  "not-confirmed",
  "low-confidence",
  "unconfigured",
  "rejected",
  "unreadable",
  "unreachable",
  "cancelled",
  "model_mismatch",
  "timeout",
] as const;
export type AckReason = (typeof ACK_REASONS)[number];
export type AckDecision = {
  requestId: string;
  outcome: "acknowledging" | "abstain";
  reason: AckReason;
  modelValidated: boolean;
};
export type AckClassifier = (input: AckInput, signal: AbortSignal) => Promise<AckDecision>;
export const requestAcknowledgment: AckClassifier = async (input, signal) => {
  const response = await fetch("/api/experiments/grok-counting/acknowledgment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  const body: unknown = await response.json();
  if (!response.ok || !body || typeof body !== "object") throw new Error("unreadable");
  const value = body as AckDecision;
  if (
    value.requestId !== input.requestId ||
    !ACK_REASONS.includes(value.reason) ||
    typeof value.modelValidated !== "boolean" ||
    !["acknowledging", "abstain"].includes(value.outcome) ||
    (value.outcome === "acknowledging" && (!value.modelValidated || value.reason !== "confirmed"))
  )
    throw new Error("unreadable");
  return {
    requestId: value.requestId,
    outcome: value.outcome,
    reason: value.reason,
    modelValidated: value.modelValidated,
  };
};

/** Historical Grok-only grammar retained for the frozen offline benchmark comparison only. */
export function grokOnlyAcknowledges(
  text: string,
  node: { readonly quantity?: unknown; readonly object?: unknown },
): boolean {
  const number = ["zero", "one", "two", "three"][Number(node.quantity)];
  const object = node.object === "duck" ? "ducks?" : "butterfl(?:y|ies)";
  // Full utterance recognition is intentionally conservative. Generic praise,
  // questions, hints and a count supplied before the learner do not qualify.
  const acknowledgment = new RegExp(
    `^(?:(?:yes|correct|that's right|that is right|well done|great)[,! .]+)?(?:there (?:is|are) |you (?:saw|counted) )?(?:${number}|${node.quantity}) ${object}[.!]*$`,
    "i",
  );
  return acknowledgment.test(text.trim());
}
