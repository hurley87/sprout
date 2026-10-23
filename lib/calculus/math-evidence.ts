import type { LearnerSpan, MathActionAssessment, MathIdentity } from "./math-action";

/** App-retained timeline positions, not model-supplied timestamps or labels.
 * Events and turns share one strictly ordered application timeline per visit.
 * Callers classify help explicitly; this module never interprets tutor text.
 */
export interface MathSourceEvent {
  readonly id: string;
  readonly order: number;
  readonly kind: "neutral-probe" | "hint" | "supplied-answer" | "unknown-help" | "tutor-context";
  readonly text: string;
}
export interface MathLearnerTurn {
  readonly id: string;
  readonly speaker: "learner" | "tutor";
  readonly text: string;
  readonly order: number;
}
export interface MathEvidence {
  readonly identity: MathIdentity;
  readonly sources: readonly LearnerSpan[];
  readonly sourceEventIds: readonly string[];
  readonly assessment: MathActionAssessment;
  readonly review: MathReview;
  readonly mathematicallyComplete: boolean;
  readonly demonstratedIndependent: boolean;
}
export interface MathReview {
  /** A separate app-owned review of interpretation; quote membership is insufficient. */
  readonly faithful: true;
  readonly assessment: MathActionAssessment;
  readonly mathematicallyComplete: boolean;
  /** Explicit separate reasoning/independence assessment, never inferred from silence. */
  readonly independenceEstablished: boolean;
}

/** No text/echo heuristics. Tutor context and praise never create evidence.
 * Help persists across correction chains within a visit, including unknown help.
 * For spanning utterances, help before the last source can affect the attempt.
 */
export function collectMathEvidence(
  identity: MathIdentity,
  sources: readonly LearnerSpan[],
  turns: readonly MathLearnerTurn[],
  events: readonly MathSourceEvent[],
  review: MathReview,
): MathEvidence {
  const positions = sources.map(span => {
    const matching = turns.filter(t => t.id === span.turnId);
    const turn = matching[0];
    if (
      matching.length !== 1 ||
      turn.speaker !== "learner" ||
      !Number.isSafeInteger(turn.order) ||
      turn.order < 0 ||
      !Number.isSafeInteger(span.start) ||
      !Number.isSafeInteger(span.end) ||
      span.start < 0 ||
      span.start >= span.end ||
      span.end > turn.text.length ||
      turn.text.slice(span.start, span.end) !== span.quote
    )
      throw new Error("Unauthenticated evidence");
    return turn.order;
  });
  if (!positions.length || positions.some((p, i) => i > 0 && p < positions[i - 1]))
    throw new Error("Unordered evidence");
  const applicable = events.filter(event => event.order < Math.max(...positions));
  const kinds = applicable.map(event => event.kind);
  const assistance: MathActionAssessment["assistance"] = kinds.includes("supplied-answer")
    ? "answer-supplied"
    : kinds.includes("hint")
      ? "hinted"
      : kinds.includes("unknown-help") ||
          review.assessment.assistance === "unknown" ||
          review.assessment.assistance === "hinted" ||
          review.assessment.assistance === "answer-supplied"
        ? "unknown"
        : kinds.includes("neutral-probe")
          ? "neutral-probe"
          : review.independenceEstablished
            ? "independent"
            : "unknown";
  const assessment = { ...review.assessment, assistance };
  const mathematicallyComplete =
    review.mathematicallyComplete && assessment.correctness === "valid" && assessment.disposition === "accepted";
  return structuredClone({
    identity,
    sources,
    sourceEventIds: applicable.map(event => event.id),
    assessment,
    review,
    mathematicallyComplete,
    demonstratedIndependent:
      mathematicallyComplete &&
      review.independenceEstablished &&
      assessment.reasoning === "supported" &&
      (assistance === "independent" || assistance === "neutral-probe"),
  });
}
