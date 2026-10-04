/** Explicit experimental provider execution. Offline tools only construct requests. */
import { JEV_MODEL } from "../../jev";
import type { ConversationStateClassifierInput } from "../../lesson-runtime/conversation-state-classifier";
import {
  SIMPLIFIED_QUESTIONS,
  simplifiedObserverState,
  abstain,
  normalizeSimplifiedOutputs,
  mapSimplifiedObservation,
  type SimplifiedDecision,
} from "./simplified-observer-contract";
export * from "./simplified-observer-contract";

/** One paid call only when explicitly invoked after separate authorization. No retries. */
export async function classifySimplifiedObserver(
  input: ConversationStateClassifierInput,
  signal: AbortSignal,
): Promise<SimplifiedDecision> {
  return executeSimplifiedObserver(input, signal, {
    model: JEV_MODEL,
    state: simplifiedObserverState(input),
    questions: SIMPLIFIED_QUESTIONS,
  });
}

/** Selected experimental request only; never retries or falls back to the legacy observer. */
export async function executeSimplifiedObserver(
  input: ConversationStateClassifierInput,
  signal: AbortSignal,
  request: {
    model: typeof JEV_MODEL;
    state: unknown;
    questions: {
      [K in keyof typeof SIMPLIFIED_QUESTIONS]: {
        type: "choice";
        instructions: string;
        criteria: (typeof SIMPLIFIED_QUESTIONS)[K]["criteria"];
      };
    };
  } | null,
): Promise<SimplifiedDecision> {
  // Capture before awaiting; provider and later caller mutations never choose identity.
  const snapshot = { nodeId: input.nodeId, transcriptRevision: input.transcriptRevision, transcript: input.transcript };
  if (!request?.state || !simplifiedObserverState(snapshot)) return abstain("invalid_input");
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
    // Never accept a silently substituted model in this pinned comparison.
    if (!body || typeof body !== "object" || !("model" in body) || body.model !== JEV_MODEL)
      return abstain("provider_model_mismatch");
    const outputs = normalizeSimplifiedOutputs(body);
    return outputs ? mapSimplifiedObservation(snapshot, outputs) : abstain("provider_unreadable");
  } catch {
    return abstain(signal.aborted ? "cancelled" : "provider_unreachable");
  }
}
