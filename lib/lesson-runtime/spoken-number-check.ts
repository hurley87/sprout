import {
  interpretConversationOutputs,
  mapConversationObservation,
  type ConversationStateDecision,
} from "./conversation-observer-contract";
import type { ConversationStateClassifierInput } from "./conversation-state-classifier";
import { latestChildNumber, type LatestChildNumber } from "./spoken-number";

export type SpokenNumberDiagnostic = {
  action: "agree" | "veto" | "rescue" | "none";
  reader: LatestChildNumber;
  classifierOutcome: "correct" | "incorrect" | "unclear" | "none" | null;
};

/** Apply only to valid classifier outputs; provider failures cannot become answers. */
export function applySpokenNumberCheck(
  decision: ConversationStateDecision,
  input: ConversationStateClassifierInput,
): ConversationStateDecision {
  const { lesson, nodeId, transcript } = input;
  const answer = lesson?.nodes[nodeId]?.presentation.answer;
  if (!lesson?.spokenNumberCheck || typeof answer !== "number") return decision;
  const reader = latestChildNumber(transcript, { answer });
  const classifierOutcome = decision.proposal?.answerOutcome ?? null;
  const matches = reader.status === "number" && reader.owner === "child" && reader.value === answer;
  let action: SpokenNumberDiagnostic["action"] = "none";
  let result = decision;
  if (classifierOutcome === "correct") {
    if (matches) action = "agree";
    else {
      action = "veto";
      const outcome =
        reader.status === "number" && reader.owner === "child"
          ? "incorrect"
          : reader.status === "number" && reader.owner === "echo"
            ? "none"
            : "unclear";
      result = {
        ...decision,
        outcome: "hold_scene",
        proposal: {
          ...decision.proposal!,
          answerOutcome: outcome,
          answerCommitment:
            outcome === "none"
              ? "no_answer"
              : outcome === "unclear"
                ? "unresolved"
                : decision.proposal!.answerCommitment,
        },
      };
    }
  } else if (
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
    if (mapped.proposal) {
      action = "rescue";
      result = {
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
      };
    }
  }
  return { ...result, spokenNumber: { action, reader, classifierOutcome } };
}
