import type { ConversationStateDecision } from "./conversation-observer-contract";
import type { ConversationStateClassifierInput } from "./conversation-state-classifier";
import { applySpokenAnswerReading, type SpokenAnswerAction } from "./spoken-answer-check";
import { latestChildNumber, type LatestChildNumber } from "./spoken-number";

export type SpokenNumberDiagnostic = {
  /** "assisted": the child repeated an answer the tutor disclosed first, on a second try, so the scene moves on. */
  action: SpokenAnswerAction;
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
  const { decision: result, action } = applySpokenAnswerReading(decision, input, {
    matches: reader.status === "number" && reader.owner !== "echo" && reader.value === answer,
    assisted: reader.status === "number" && reader.owner === "assisted",
    vetoOutcome:
      reader.status === "number" && reader.owner === "child"
        ? "incorrect"
        : reader.status === "number" && reader.owner === "echo"
          ? "none"
          : "unclear",
  });
  return { ...result, spokenNumber: { action, reader, classifierOutcome } };
}
