/** Shared request construction for the offline ablation and explicit live Issue #57 arm. */
import { JEV_MODEL } from "../../jev";
import type { ConversationStateClassifierInput } from "../../lesson-runtime/conversation-state-classifier";
import { SIMPLIFIED_QUESTIONS, simplifiedObserverState, type SimplifiedDecision } from "./simplified-observer-contract";

export type ProjectionArm = "A" | "B";

/** Only the evidence locator changes, identically in both arms. All semantic criteria stay frozen. */
export {
  CONVERSATION_STATE_QUESTIONS as CONTEXT_PROJECTION_QUESTIONS,
  conversationObserverState as fullTranscriptObserverState,
} from "../../lesson-runtime/conversation-observer-contract";
import {
  CONVERSATION_STATE_QUESTIONS as CONTEXT_PROJECTION_QUESTIONS,
  conversationObserverState as fullTranscriptObserverState,
} from "../../lesson-runtime/conversation-observer-contract";

/** Explicit closed request plan only. This function cannot make provider calls. */
export function contextProjectionRequest(input: ConversationStateClassifierInput, arm: ProjectionArm) {
  if (arm !== "A" && arm !== "B") return null;
  // Capture identity and transcript, dropping any caller-supplied graph or future context.
  const snapshot = { nodeId: input.nodeId, transcriptRevision: input.transcriptRevision, transcript: input.transcript };
  const state = arm === "A" ? simplifiedObserverState(snapshot) : fullTranscriptObserverState(snapshot);
  return state ? ({ model: JEV_MODEL, state, questions: CONTEXT_PROJECTION_QUESTIONS } as const) : null;
}

export type ProjectionComparison = {
  classification: "improved" | "regressed" | "unchanged" | "still ambiguous";
  reason: string;
  /** Extra-history contamination requires human review, not score-based causal inference. */
  contamination: null;
};
export type ReviewedProjectionExpectation = {
  objectiveState: keyof typeof SIMPLIFIED_QUESTIONS.objectiveState.criteria;
  tutorState: keyof typeof SIMPLIFIED_QUESTIONS.tutorState.criteria;
};

const signature = (d: SimplifiedDecision) =>
  JSON.stringify([
    d.status,
    d.outcome,
    d.reason ?? null,
    d.outputs?.objectiveState.choice,
    d.outputs?.tutorState.choice,
  ]);
/** Compare measured decisions against explicit reviewed enums, never transcript heuristics. */
export function compareProjectionDecisions(
  a: SimplifiedDecision | null,
  b: SimplifiedDecision | null,
  expected: ReviewedProjectionExpectation | null,
): ProjectionComparison {
  const result = (classification: ProjectionComparison["classification"], reason: string): ProjectionComparison => ({
    classification,
    reason,
    contamination: null,
  });
  if (!a || !b) return result("still ambiguous", "unmeasured: paired outputs are missing");
  if (!a.outputs || !b.outputs)
    return result("still ambiguous", "provider/validation failure; no paired semantic judgments");
  if (signature(a) === signature(b))
    return a.status === "abstained"
      ? result("still ambiguous", "both arms abstained with the same mapped judgment")
      : result("unchanged", "same mapped states and outcome; raw probabilities may differ");
  if (!expected)
    return result("still ambiguous", "different mapped judgments without a frozen human-adjudicated expectation");
  const matches = (d: SimplifiedDecision) =>
    d.status === "accepted" &&
    d.outputs?.objectiveState.choice === expected.objectiveState &&
    d.outputs?.tutorState.choice === expected.tutorState &&
    d.labelCompletionEligible ===
      (expected.objectiveState === "completed" && expected.tutorState === "confirmed_completion");
  const aMatches = matches(a),
    bMatches = matches(b);
  if (!aMatches && bMatches)
    return result("improved", "only B matches the reviewed semantic states with accepted gates");
  if (aMatches && !bMatches)
    return result("regressed", "only A matches the reviewed semantic states with accepted gates");
  return result("still ambiguous", "different outcomes; neither arm uniquely matches the reviewed expectation");
}
