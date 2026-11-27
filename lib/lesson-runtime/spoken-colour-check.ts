import type { ConversationStateDecision } from "./conversation-observer-contract";
import type { ConversationStateClassifierInput } from "./conversation-state-classifier";
import { applySpokenAnswerReading, type SpokenAnswerAction } from "./spoken-answer-check";
import { latestChildColour, presentationColours, type LatestChildColour } from "./spoken-colour";

export type SpokenColourDiagnostic = {
  /** "assisted": the child repeated an answer the tutor disclosed first, on a second try, so the scene moves on. */
  action: SpokenAnswerAction;
  reader: LatestChildColour;
  classifierOutcome: "correct" | "incorrect" | "unclear" | "none" | null;
  /** Present when the reader found a colour. */
  picked?: string;
  /** The node fact `count_<picked>`, when authored. */
  pickedCount?: number;
  /** The node fact `target`, when authored. */
  target?: number;
  /** A wrong pick holding one more or one fewer than the target. Present when both counts are known. */
  nearMiss?: boolean;
};

function pickDetails(
  reader: LatestChildColour,
  presentation: Readonly<Record<string, string | number | boolean>>,
  answer: string,
): Pick<SpokenColourDiagnostic, "picked" | "pickedCount" | "target" | "nearMiss"> {
  if (reader.status !== "colour") return {};
  const picked = reader.value;
  const count = presentation[`count_${picked}`];
  const target = presentation.target;
  const pickedCount = typeof count === "number" ? count : undefined;
  const known = typeof target === "number" ? target : undefined;
  return {
    picked,
    ...(pickedCount !== undefined ? { pickedCount } : {}),
    ...(known !== undefined ? { target: known } : {}),
    ...(pickedCount !== undefined && known !== undefined
      ? { nearMiss: picked !== answer && Math.abs(pickedCount - known) === 1 }
      : {}),
  };
}

/**
 * The colour equivalent of `applySpokenNumberCheck`, with the same agree, veto, rescue and assisted rules.
 * Apply only to valid classifier outputs; provider failures cannot become answers.
 */
export function applySpokenColourCheck(
  decision: ConversationStateDecision,
  input: ConversationStateClassifierInput,
): ConversationStateDecision {
  const { lesson, nodeId, transcript } = input;
  const presentation = lesson?.nodes[nodeId]?.presentation;
  const answer = presentation?.answer;
  if (!lesson?.spokenColourCheck || !presentation || presentation.answerKind !== "colour" || typeof answer !== "string")
    return decision;
  const reader = latestChildColour(transcript, {
    answer,
    colours: presentationColours(presentation),
    aliases: lesson.spokenColourCheck.aliases,
  });
  const classifierOutcome = decision.proposal?.answerOutcome ?? null;
  const { decision: result, action } = applySpokenAnswerReading(decision, input, {
    matches: reader.status === "colour" && reader.owner !== "echo" && reader.value === answer,
    assisted: reader.status === "colour" && reader.owner === "assisted",
    // A different colour she chose is wrong; repeating the tutor is no answer yet; the number back,
    // "that one", a question, alternatives or nothing at all leave the answer unresolved.
    vetoOutcome:
      reader.status === "colour" && reader.owner === "child"
        ? "incorrect"
        : reader.status === "colour" && reader.owner === "echo"
          ? "none"
          : "unclear",
  });
  return {
    ...result,
    spokenColour: { action, reader, classifierOutcome, ...pickDetails(reader, presentation, answer) },
  };
}
