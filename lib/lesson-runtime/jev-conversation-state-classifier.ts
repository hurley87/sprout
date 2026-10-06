/** Canonical server-only conversation-state classifier. One request per snapshot; no fallback or retry. */
import { JEV_MODEL } from "../jev";
import type { ConversationStateClassifierInput } from "./conversation-state-classifier";
import {
  conversationStateQuestions,
  conversationObserverState,
  abstain,
  normalizeConversationOutputs,
  mapConversationObservation,
  type ConversationStateDecision,
} from "./conversation-observer-contract";
export * from "./conversation-observer-contract";

/** One provider request per current-node snapshot. No retries. */
export async function classifyConversationStateWithDiagnostics(
  input: ConversationStateClassifierInput,
  signal: AbortSignal,
): Promise<ConversationStateDecision> {
  if (!input.lesson) return abstain("invalid_input");
  return executeConversationObserver(input, signal, {
    model: JEV_MODEL,
    state: conversationObserverState(input),
    questions: conversationStateQuestions(input.lesson),
  });
}

/** Explicit request execution shared with offline comparisons; never retries or falls back. */
export async function executeConversationObserver(
  input: ConversationStateClassifierInput,
  signal: AbortSignal,
  request: {
    model: typeof JEV_MODEL;
    state: unknown;
    questions: {
      [K in "objectiveState" | "tutorState"]: {
        type: "choice";
        instructions: string;
        criteria: Readonly<Record<string, string>>;
      };
    };
  } | null,
): Promise<ConversationStateDecision> {
  // Capture before awaiting; provider and later caller mutations never choose identity.
  const snapshot = { ...input, lesson: input.lesson, nodeId: input.nodeId, transcriptRevision: input.transcriptRevision, transcript: input.transcript };
  if (!request?.state || !conversationObserverState(snapshot)) return abstain("invalid_input");
  if (signal.aborted) return abstain("cancelled");
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return abstain("provider_unconfigured");
  try {
    const response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
    if (signal.aborted) return abstain("cancelled");
    if (!response.ok) return abstain("provider_rejected");
    const body: unknown = await response.json().catch(() => null);
    if (signal.aborted) return abstain("cancelled");
    // Never accept a silently substituted model.
    if (!body || typeof body !== "object" || !("model" in body) || body.model !== JEV_MODEL)
      return abstain("provider_model_mismatch");
    const outputs = normalizeConversationOutputs(body);
    return outputs ? mapConversationObservation(snapshot, outputs) : abstain("provider_unreadable");
  } catch {
    return abstain(signal.aborted ? "cancelled" : "provider_unreachable");
  }
}

export const jevConversationStateClassifier = {
  async classify(input: ConversationStateClassifierInput, signal: AbortSignal) {
    return (await classifyConversationStateWithDiagnostics(input, signal)).proposal;
  },
};
