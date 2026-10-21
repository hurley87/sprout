import type { LessonDefinition } from "../lesson-definition";
import type { ClassificationSource, LessonRuntimeState } from "../lesson-runtime-reducer";
import type { ConceptEvidenceRecord } from "../concept-evidence";
import type { Criterion } from "./rubric-types";
import type { RewriteAttempt } from "./rewrite-proposal";
import { MAE386_RUBRICS } from "./rubrics";

export type QuestionOutcome =
  "independent" | "assisted" | "partial" | "incorrect" | "skipped" | "unattempted" | "unresolved";
/** Accepted objective interpretation, never transcript presence or tutor sentiment. */
export type QuestionAttempt = {
  readonly source: ClassificationSource;
  readonly text: string;
  readonly outcome: "correct" | "incorrect" | "unclear";
};
export type QuestionObservation = {
  readonly source: ClassificationSource;
  readonly status: "unreviewed" | "pending" | "settled" | "unavailable";
};
export type OutcomeComponent = {
  readonly nodeId: string;
  readonly outcome: QuestionOutcome;
  readonly reached: boolean;
  readonly skipped: boolean;
  readonly assessment: "accepted" | "unavailable" | "unresolved" | "none";
  readonly criteria: readonly {
    readonly id: string;
    readonly authored: Readonly<Criterion> | null;
    readonly evidence: ConceptEvidenceRecord | null;
    readonly rewriteResult:
      RewriteAttempt["selection"]["criteria"][keyof RewriteAttempt["selection"]["criteria"]] | null;
  }[];
  readonly optionalDimensions: readonly (Readonly<Criterion> & { readonly assessed: false })[];
  readonly attempts: readonly QuestionAttempt[];
  readonly rewrite: RewriteAttempt | null;
};
export type QuestionOutcomeSnapshot = {
  readonly runtimeId: string;
  readonly frozenAtMs: number;
  readonly questions: readonly {
    readonly questionId: string;
    readonly title: string;
    readonly outcome: QuestionOutcome;
    readonly components: readonly OutcomeComponent[];
  }[];
};
export const OUTCOME_LABELS: Readonly<Record<QuestionOutcome, string>> = {
  independent: "independently demonstrated",
  assisted: "demonstrated with help",
  partial: "partially demonstrated",
  incorrect: "incorrect response",
  skipped: "skipped",
  unattempted: "unattempted",
  unresolved: "unresolved",
};

/** Mixed results stay conservative, with lossless component/criterion detail. */
function aggregate(outcomes: readonly QuestionOutcome[]): QuestionOutcome {
  if (outcomes.every(outcome => outcome === outcomes[0])) return outcomes[0];
  if (outcomes.every(outcome => outcome === "independent" || outcome === "assisted")) return "assisted";
  if (outcomes.includes("unresolved")) return "unresolved";
  if (outcomes.some(outcome => ["independent", "assisted", "partial"].includes(outcome))) return "partial";
  if (outcomes.includes("incorrect")) return "incorrect";
  return outcomes.includes("skipped") ? "skipped" : "unattempted";
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/** Call only at committed recap entry, or after cancelling a transition on Stop.
 * No pendingRender navigation is ever promoted into accepted departure facts. */
export function freezeQuestionOutcomes(lesson: LessonDefinition, state: LessonRuntimeState): QuestionOutcomeSnapshot {
  const history = state.navigationHistory ?? [];
  const questions = (lesson.questionGroups ?? []).map(group => {
    const rubric = MAE386_RUBRICS.find(question => question.id === group.questionId);
    const components = group.nodeIds.map((nodeId): OutcomeComponent => {
      const node = lesson.nodes[nodeId];
      const departures = history.filter(record => record.source.nodeId === nodeId);
      const reached = state.nodeId === nodeId || departures.length > 0;
      const skipped =
        history.some(record => record.skippedNodeIds.includes(nodeId)) ||
        departures.some(record => record.intent !== "tutor_closure" && record.intent.action === "skip");
      const attempts = state.questionAttempts?.[nodeId] ?? [];
      const observation = state.questionObservations?.[nodeId];
      const rewrite = state.rewriteProposals?.[nodeId]?.current ?? null;
      const authoredCriteria = rubric?.units.find(unit => unit.id === nodeId)?.criteria ?? [];
      const criteria = (node.concepts ?? []).map(criterion => ({
        id: criterion.id,
        authored: authoredCriteria.find(authored => authored.id === criterion.id) ?? null,
        evidence: node.currentRewrite ? null : (state.conceptEvidence[`${nodeId}:${criterion.id}`] ?? null),
        rewriteResult:
          node.currentRewrite &&
          rewrite &&
          rewrite.outcome !== "not_demonstrated" &&
          rewrite.selection.state === "complete" &&
          rewrite.words.length > 0 &&
          rewrite.words.every(word => word.childTurnId !== null)
            ? rewrite.selection.criteria[criterion.id as keyof RewriteAttempt["selection"]["criteria"]]
            : null,
      }));
      const records = criteria.map(criterion => criterion.evidence);
      const hasEvidence = records.some(record => record?.source);
      const assessment: OutcomeComponent["assessment"] =
        observation?.status === "unavailable"
          ? "unavailable"
          : observation?.status === "pending" || observation?.status === "unreviewed"
            ? "unresolved"
            : attempts.length || hasEvidence || rewrite
              ? "accepted"
              : "none";
      let outcome: QuestionOutcome;
      if (node.currentRewrite) {
        // Never read history or cumulative criteria to restore current rewrite credit.
        outcome = rewrite
          ? rewrite.outcome === "not_demonstrated"
            ? skipped
              ? "skipped"
              : "unattempted"
            : rewrite.outcome
          : (state.rewriteProposals?.[nodeId]?.history.length ?? 0) > 0 ||
              assessment === "unavailable" ||
              assessment === "unresolved"
            ? "unresolved"
            : skipped
              ? "skipped"
              : "unattempted";
      } else if (
        records.length &&
        records.every(record => record?.source && record.status === "demonstrated" && record.understanding !== null)
      ) {
        outcome = records.every(record => record!.understanding === "independent") ? "independent" : "assisted";
      } else if (attempts.at(-1)?.outcome === "incorrect") outcome = "incorrect";
      else if (hasEvidence) {
        outcome = records.some(
          record => record?.tentative || (record?.status === "demonstrated" && record.understanding === null),
        )
          ? "unresolved"
          : "partial";
      } else if (attempts.length || assessment === "unavailable" || assessment === "unresolved") outcome = "unresolved";
      else outcome = skipped ? "skipped" : "unattempted";
      return {
        nodeId,
        outcome,
        reached,
        skipped,
        assessment,
        criteria,
        attempts,
        rewrite,
        optionalDimensions: authoredCriteria
          .filter(criterion => criterion.optional)
          .map(criterion => ({ ...criterion, assessed: false })),
      };
    });
    return {
      questionId: group.questionId,
      title: rubric?.title ?? group.questionId,
      outcome: aggregate(components.map(component => component.outcome)),
      components,
    };
  });
  // Clone before freezing: snapshot ownership never freezes the live evidence ledger.
  return deepFreeze(structuredClone({ runtimeId: state.runtimeId, frozenAtMs: state.nowMs, questions }));
}

export function questionRecap(snapshot: QuestionOutcomeSnapshot, endedEarly = false) {
  const spoken =
    snapshot.questions
      .map(question => `${question.questionId.toUpperCase()}: ${OUTCOME_LABELS[question.outcome]}.`)
      .join(" ") + " Thanks for the discussion.";
  return { label: endedEarly ? "Session ended early" : "Practice recap", questions: snapshot.questions, spoken };
}
