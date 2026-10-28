import { parseMathActionBatch, type MathActionBatch, type MathIdentity, type MathProposalContext } from "./math-action";
import { boundedArray, exactObject, parseMathExpression, type MathExpression } from "./math-expression";
import { isCalculusProblemId } from "./problems";

export const INTERPRETATION_LIMITS = {
  bytes: 65_536,
  turns: 16,
  text: 2000,
  board: 32,
  timeoutMs: 30_000,
  outputBytes: 65_536,
} as const;
export interface MathInterpretationInput {
  readonly identity: MathIdentity;
  readonly learnerTurns: readonly { readonly id: string; readonly text: string }[];
  readonly tutorContext: readonly { readonly id: string; readonly text: string }[];
  readonly board: readonly { readonly id: string; readonly expression: MathExpression }[];
  readonly latestUndoableStepId: string | null;
}
export type MathInterpretationResult =
  | {
      disposition: "proposal" | "strategy" | "clarify" | "help" | "next" | "unsupported" | "observation";
      batch: MathActionBatch;
      review: "required";
    }
  | { disposition: "malformed" | "provider-failure" | "unavailable" | "timeout" | "cancelled"; batch: null };
const validId = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
const revision = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** Captured app snapshot, not proof of current runtime authority. Never accept tutor turns as sources. */
export function parseMathInterpretationInput(value: unknown): MathInterpretationInput {
  const v = exactObject(value, ["identity", "learnerTurns", "tutorContext", "board", "latestUndoableStepId"]);
  const i = exactObject(v.identity, ["runtimeId", "problemId", "visitId", "transcriptRevision", "baseBoardRevision"]);
  if (
    !validId(i.runtimeId) ||
    !validId(i.visitId) ||
    !isCalculusProblemId(i.problemId) ||
    !revision(i.transcriptRevision) ||
    !revision(i.baseBoardRevision)
  )
    throw new Error("Invalid identity");
  const ids = new Set<string>();
  const turns = (raw: unknown, minimum: number) =>
    boundedArray(raw, INTERPRETATION_LIMITS.turns, minimum).map(rawTurn => {
      const t = exactObject(rawTurn, ["id", "text"]);
      if (
        !validId(t.id) ||
        ids.has(t.id) ||
        typeof t.text !== "string" ||
        !t.text.trim() ||
        t.text.length > INTERPRETATION_LIMITS.text
      )
        throw new Error("Invalid turn");
      ids.add(t.id);
      return { id: t.id, text: t.text };
    });
  const learnerTurns = turns(v.learnerTurns, 1);
  const tutorContext = turns(v.tutorContext, 0);
  const stepIds = new Set<string>();
  const board = boundedArray(v.board, INTERPRETATION_LIMITS.board, 0).map(rawStep => {
    const s = exactObject(rawStep, ["id", "expression"]);
    if (!validId(s.id) || stepIds.has(s.id)) throw new Error("Invalid board");
    stepIds.add(s.id);
    return { id: s.id, expression: parseMathExpression(s.expression) };
  });
  if (v.latestUndoableStepId !== null && (!validId(v.latestUndoableStepId) || !stepIds.has(v.latestUndoableStepId)))
    throw new Error("Invalid undo target");
  return {
    identity: {
      runtimeId: i.runtimeId,
      visitId: i.visitId,
      problemId: i.problemId,
      transcriptRevision: i.transcriptRevision,
      baseBoardRevision: i.baseBoardRevision,
    },
    learnerTurns,
    tutorContext,
    board,
    latestUndoableStepId: v.latestUndoableStepId,
  };
}

/** Provider proposes only quote locators. App derives offsets; repeated quotes must be expanded to a unique span. */
export function parseMathInterpretationOutput(
  value: unknown,
  input: MathInterpretationInput,
): MathInterpretationResult {
  const v = exactObject(value, ["actions"]);
  const actions = boundedArray(v.actions, 8).map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid action");
    const a = raw as Record<string, unknown>;
    const sources = boundedArray(a.sources, 8).map(rawSource => {
      const s = exactObject(rawSource, ["turnId", "quote"]);
      const turn = input.learnerTurns.find(t => t.id === s.turnId);
      if (!turn || typeof s.quote !== "string" || !s.quote || s.quote.length > 2000) throw new Error("Invalid source");
      const start = turn.text.indexOf(s.quote);
      if (start < 0 || turn.text.indexOf(s.quote, start + 1) !== -1) throw new Error("Ambiguous source");
      return { turnId: turn.id, quote: s.quote, start, end: start + s.quote.length };
    });
    return { ...a, sources };
  });
  const context: MathProposalContext = {
    identity: input.identity,
    turns: input.learnerTurns.map(t => ({ ...t, speaker: "learner" })),
    logicalStepIds: input.board.map(s => s.id),
    latestUndoableStepId: input.latestUndoableStepId,
  };
  const batch = parseMathActionBatch({ identity: input.identity, actions }, context);
  const kinds = new Set(batch.actions.map(a => a.kind));
  const first = batch.actions[0];
  const disposition = batch.actions.some(a => ["append", "replace", "undo"].includes(a.kind))
    ? "proposal"
    : kinds.size !== 1
      ? "observation"
      : first.kind === "clarify" && first.reason === "unsupported"
        ? "unsupported"
        : (first.kind as "strategy" | "clarify" | "help" | "next");
  return { disposition, batch, review: "required" };
}

const object = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const enumString = (...values: string[]) => ({ type: "string", enum: values });
const expr = { $ref: "#/$defs/expression" };
const expression = {
  anyOf: [
    object({ op: enumString("number"), value: { type: "integer", minimum: -999999, maximum: 999999 } }),
    object({ op: enumString("variable"), name: enumString("x") }),
    object({ op: enumString("add", "multiply"), args: { type: "array", items: expr, minItems: 2, maxItems: 8 } }),
    object({ op: enumString("subtract", "divide", "equal"), left: expr, right: expr }),
    object({ op: enumString("power"), base: expr, exponent: { type: "integer", minimum: -12, maximum: 12 } }),
    object({ op: enumString("negate", "sin", "cos", "derivative"), argument: expr }),
  ],
};
const sources = {
  type: "array",
  minItems: 1,
  maxItems: 8,
  items: object({ turnId: { type: "string" }, quote: { type: "string" } }),
};
export const MATH_INTERPRETATION_SCHEMA = {
  ...object({
    actions: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        anyOf: [
          object({ kind: enumString("append"), expression: expr, sources }),
          object({ kind: enumString("replace"), targetStepId: { type: "string" }, expression: expr, sources }),
          object({ kind: enumString("undo"), targetStepId: { type: "string" }, sources }),
          object({
            kind: enumString("clarify"),
            reason: enumString("missing-operand", "ambiguous", "unsupported"),
            sources,
          }),
          object({
            kind: enumString("strategy"),
            method: enumString("power", "sum", "product", "chain", "expand", "other"),
            sources,
          }),
          object({ kind: enumString("help", "next"), sources }),
        ],
      },
    },
  }),
  $defs: { expression },
};
