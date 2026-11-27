import {
  interpretConversationOutputs,
  mapConversationObservation,
  type ConversationStateDecision,
} from "./conversation-observer-contract";
import type { ConversationStateClassifierInput } from "./conversation-state-classifier";

export type SpokenAnswerAction = "agree" | "veto" | "rescue" | "assisted" | "none";

/** What a deterministic reader found in the child's latest turn, judged against the node's answer. */
export type SpokenAnswerReading = {
  /** The child's own answer (or an assisted repeat) equals the expected answer. */
  readonly matches: boolean;
  /** The match is a second repeat of an answer the tutor disclosed first. */
  readonly assisted: boolean;
  /** The answer outcome when a classifier "correct" is vetoed. */
  readonly vetoOutcome: "incorrect" | "none" | "unclear";
};

/**
 * Agree with, veto or rescue a classifier decision from a deterministic reading of the child's answer.
 * Shared by the spoken-number and spoken-colour checks. Apply only to valid classifier outputs; provider
 * failures cannot become answers.
 */
export function applySpokenAnswerReading(
  decision: ConversationStateDecision,
  input: ConversationStateClassifierInput,
  { matches, assisted, vetoOutcome }: SpokenAnswerReading,
): { decision: ConversationStateDecision; action: SpokenAnswerAction } {
  const { lesson, nodeId, transcript } = input;
  const classifierOutcome = decision.proposal?.answerOutcome ?? null;
  if (classifierOutcome === "correct") {
    if (matches) return { decision, action: assisted ? "assisted" : "agree" };
    return {
      action: "veto",
      decision: {
        ...decision,
        outcome: "hold_scene",
        proposal: {
          ...decision.proposal!,
          answerOutcome: vetoOutcome,
          answerCommitment:
            vetoOutcome === "none"
              ? "no_answer"
              : vetoOutcome === "unclear"
                ? "unresolved"
                : decision.proposal!.answerCommitment,
        },
      },
    };
  }
  if (
    (classifierOutcome === null || classifierOutcome === "unclear") &&
    matches &&
    decision.outputs &&
    // Rescue only when the classifier is unsure, or sure only that the answer is unclear. Never override a
    // confident judgement that the answer is wrong, that the child made no attempt, or that they still need help.
    (!interpretConversationOutputs(decision.outputs, lesson, nodeId, transcript).objectiveConfident ||
      decision.outputs.objectiveState.choice === "unclear_or_incomplete")
  ) {
    // Reuse the mapper with synthetic confident answer choices, retaining all other
    // provider outputs. The synthetic scores never replace exported provider scores.
    const outputs = decision.outputs;
    const objectiveConfident = interpretConversationOutputs(outputs, lesson, nodeId, transcript).objectiveConfident;
    const mapped = mapConversationObservation(input, {
      ...outputs,
      objectiveState: objectiveConfident
        ? outputs.objectiveState
        : {
            choice: "unclear_or_incomplete",
            confidence: 1,
            probabilities: { completed: 0, incorrect: 0, unclear_or_incomplete: 1, unresolved_help: 0, no_attempt: 0 },
          },
      answerCommitment: {
        choice: "committed",
        confidence: 1,
        probabilities: { committed: 1, unresolved: 0, withdrawn: 0, no_answer: 0 },
      },
    });
    if (mapped.proposal)
      return {
        action: assisted ? "assisted" : "rescue",
        decision: {
          ...decision,
          reason: undefined,
          status: mapped.status,
          outcome: "allow_semantic_completion_evidence",
          proposal: {
            ...mapped.proposal,
            answerOutcome: "correct",
            ...(decision.proposal
              ? {
                  childActivity: decision.proposal.childActivity,
                  supportState: decision.proposal.supportState,
                  tutorState: decision.proposal.tutorState,
                }
              : {}),
          },
        },
      };
  }
  return { decision, action: "none" };
}
