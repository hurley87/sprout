import { boundedArray, exactObject, parseMathExpression, type MathExpression } from "./math-expression";
import { isCalculusProblemId, type CalculusProblemId } from "./problems";

/** Half-open UTF-16 offsets into one exact app-retained turn, never tutor text. */
export interface LearnerSpan {
  readonly turnId: string;
  readonly start: number;
  readonly end: number;
  readonly quote: string;
}
export interface MathIdentity {
  readonly runtimeId: string;
  readonly problemId: CalculusProblemId;
  readonly visitId: string;
  readonly transcriptRevision: number;
  readonly baseBoardRevision: number;
}
export type MathProposal = { readonly sources: readonly LearnerSpan[] } & (
  | { readonly kind: "append"; readonly expression: MathExpression }
  | { readonly kind: "replace"; readonly targetStepId: string; readonly expression: MathExpression }
  | { readonly kind: "undo"; readonly targetStepId: string }
  | { readonly kind: "clarify"; readonly reason: "missing-operand" | "ambiguous" | "unsupported" }
  | { readonly kind: "help" | "next" }
  | { readonly kind: "strategy"; readonly method: "power" | "sum" | "product" | "chain" | "expand" | "other" }
);
export interface MathActionBatch {
  readonly identity: MathIdentity;
  readonly actions: readonly MathProposal[];
}
export const ACTION_LIMITS = { actions: 8, spansPerAction: 8, quoteLength: 2000 } as const;

/** Supplied ONLY by application code, never deserialized from model output.
 * A tutor-only revision can retain the captured snapshot. A learner correction,
 * Stop, board edit or visit change must revoke it before any eventual acceptance.
 */
export interface MathProposalContext {
  readonly identity: MathIdentity;
  readonly turns: readonly { readonly id: string; readonly speaker: "learner" | "tutor"; readonly text: string }[];
  readonly logicalStepIds: readonly string[];
  readonly latestUndoableStepId: string | null;
}

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function id(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}
function member<T extends string>(value: unknown, values: readonly T[]): T {
  if (!values.includes(value as T)) throw new Error("Unsupported value");
  return value as T;
}

/** Structural and source-membership check only. No semantic faithfulness,
 * current mutation authority, math correctness, independence or mastery granted.
 * Returns a detached copy so later mutation of untrusted input cannot change it.
 */
export function parseMathActionBatch(value: unknown, context: MathProposalContext): MathActionBatch {
  const batch = exactObject(value, ["identity", "actions"]);
  const identity = exactObject(batch.identity, [
    "runtimeId",
    "problemId",
    "visitId",
    "transcriptRevision",
    "baseBoardRevision",
  ]);
  if (
    !id(identity.runtimeId) ||
    !id(identity.visitId) ||
    !isCalculusProblemId(identity.problemId) ||
    !integer(identity.transcriptRevision) ||
    !integer(identity.baseBoardRevision) ||
    Object.keys(identity).some(key => identity[key] !== context.identity[key as keyof MathIdentity])
  )
    throw new Error("Source identity mismatch");
  const rawActions = boundedArray(batch.actions, ACTION_LIMITS.actions);
  const actions = rawActions.map((input): MathProposal => {
    if (!input || typeof input !== "object") throw new Error("Invalid action");
    const kind = (input as Record<string, unknown>).kind;
    const fields =
      kind === "append"
        ? ["expression"]
        : kind === "replace"
          ? ["targetStepId", "expression"]
          : kind === "undo"
            ? ["targetStepId"]
            : kind === "clarify"
              ? ["reason"]
              : kind === "strategy"
                ? ["method"]
                : [];
    const action = exactObject(input, ["kind", "sources", ...fields]);
    const rawSources = boundedArray(action.sources, ACTION_LIMITS.spansPerAction);
    const sources = rawSources.map((raw): LearnerSpan => {
      const span = exactObject(raw, ["turnId", "start", "end", "quote"]);
      const turns = context.turns.filter(t => t.id === span.turnId);
      if (
        !id(span.turnId) ||
        turns.length !== 1 ||
        turns[0].speaker !== "learner" ||
        !integer(span.start) ||
        !integer(span.end) ||
        span.start >= span.end ||
        span.end > turns[0].text.length ||
        typeof span.quote !== "string" ||
        span.quote.length > ACTION_LIMITS.quoteLength ||
        turns[0].text.slice(span.start, span.end) !== span.quote
      )
        throw new Error("Unauthenticated source span");
      return { turnId: span.turnId, start: span.start, end: span.end, quote: span.quote };
    });
    switch (kind) {
      case "append":
        return { kind, sources, expression: parseMathExpression(action.expression) };
      case "replace":
      case "undo": {
        if (
          !id(action.targetStepId) ||
          !context.logicalStepIds.includes(action.targetStepId) ||
          (kind === "undo" && action.targetStepId !== context.latestUndoableStepId)
        )
          throw new Error("Invalid target");
        return kind === "replace"
          ? { kind, sources, targetStepId: action.targetStepId, expression: parseMathExpression(action.expression) }
          : { kind, sources, targetStepId: action.targetStepId };
      }
      case "clarify":
        return { kind, sources, reason: member(action.reason, ["missing-operand", "ambiguous", "unsupported"]) };
      case "strategy":
        return {
          kind,
          sources,
          method: member(action.method, ["power", "sum", "product", "chain", "expand", "other"]),
        };
      case "help":
      case "next":
        return { kind, sources };
      default:
        throw new Error("Unsupported action");
    }
  });
  return { identity: { ...context.identity }, actions };
}

/** App-owned assessments, never fields a model may attach to its proposal. */
export interface MathActionAssessment {
  readonly disposition: "accepted" | "rejected" | "clarification-required" | "unresolved";
  readonly correctness: "unchecked" | "valid" | "incorrect" | "unsupported" | "incomplete";
  readonly reasoning: "unassessed" | "strategy-only" | "supported" | "missing" | "misleading";
  readonly assistance: "unknown" | "independent" | "neutral-probe" | "hinted" | "answer-supplied";
}
