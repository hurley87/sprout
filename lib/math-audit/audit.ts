import { checkTransformation, type ExpressionInput, type Operation, type TransformationResult } from "./check";
import { parseAlgebraExpression } from "./expression";
import { formatExpression } from "./format";
import { readAlgebraLatex } from "./latex";
import { reduceRational } from "./rational";

/** Local proofs only: verified does not grade the final answer. Later steps depend on earlier issues. */
export const AUDIT_TRAIL_LIMIT = 200;
type EntryInput = { id: string; expression: ExpressionInput; operation?: Operation; sourceIds?: readonly string[] };
type StartInput = Omit<EntryInput, "operation">;
type Entry = { index: number; id: string; expression: ExpressionInput; sourceIds?: readonly string[] } & (
  | { kind: "start"; read: { ok: true } | { ok: false; reason: string; detail: string } }
  | {
      kind: "step" | "correction";
      previousEntryId: string;
      correctsId?: string;
      operation?: Operation;
      result: TransformationResult;
    }
);
export type AuditTrail = { entries: readonly Entry[]; effectiveChain: readonly string[] };
export type AuditTrailResult = { ok: true; trail: AuditTrail } | { ok: false; reason: string; detail: string };
type IssueCategory = "invalid" | "unverified" | "domain-changed";
export type AuditSummary = {
  status: "verified" | "attention";
  firstIssue: null | {
    entryId: string;
    index: number;
    previousEntryId: string;
    category: IssueCategory;
    verdict: TransformationResult["verdict"];
    reason: string;
    domainStatus?: NonNullable<TransformationResult["domain"]>["status"];
    discrepancy?: Extract<TransformationResult, { verdict: "not-equivalent" }>["discrepancy"];
    previousExpression: string;
    proposedExpression: string;
  };
  effectiveChain: string[];
  superseded: string[];
  dependsOnIssue: string[];
  counts: { verified: number; invalid: number; unverified: number; domainChanged: number };
};
const error = (reason: string, detail: string): Extract<AuditTrailResult, { ok: false }> => ({
  ok: false,
  reason,
  detail,
});

function copy(value: unknown, seen = new Set<object>(), depth = 0): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return value;
  if (typeof value !== "object" || depth > 100 || seen.has(value)) throw new Error("Invalid value");
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some(key => typeof key !== "string" || !("value" in descriptors[key])))
    throw new Error("Invalid value");
  const result = Array.isArray(value)
    ? Array.from(value, item => copy(item, seen, depth + 1))
    : Object.fromEntries(
        Object.entries(descriptors).map(([key, descriptor]) => [key, copy(descriptor.value, seen, depth + 1)]),
      );
  seen.delete(value);
  return result;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function input(value: unknown, correction = false, start = false): EntryInput & { correctsId?: string } {
  const item = copy(value) as Record<string, unknown>;
  if (
    !item ||
    typeof item !== "object" ||
    Array.isArray(item) ||
    Object.keys(item).some(
      key =>
        ![
          "id",
          "expression",
          "sourceIds",
          ...(start ? [] : ["operation"]),
          ...(correction ? ["correctsId"] : []),
        ].includes(key),
    ) ||
    typeof item.id !== "string" ||
    !item.id ||
    (correction && (typeof item.correctsId !== "string" || !item.correctsId)) ||
    ("sourceIds" in item && (!Array.isArray(item.sourceIds) || !item.sourceIds.every(id => typeof id === "string")))
  )
    throw new Error("Invalid entry");
  const expression = item.expression as Record<string, unknown>;
  if (
    !expression ||
    typeof expression !== "object" ||
    Array.isArray(expression) ||
    !(
      (Object.keys(expression).length === 1 && typeof expression.latex === "string") ||
      (Object.keys(expression).length === 1 && Object.hasOwn(expression, "ast"))
    )
  )
    throw new Error("Invalid expression input");
  if ("operation" in item) {
    const operation = item.operation as Record<string, unknown>;
    if (
      !operation ||
      typeof operation !== "object" ||
      Array.isArray(operation) ||
      Object.keys(operation).some(key => !["kind", "description"].includes(key)) ||
      !["algebraic", "differentiate", "integrate", "solve", "other"].includes(operation.kind as string) ||
      ("description" in operation && typeof operation.description !== "string")
    )
      throw new Error("Invalid operation");
  }
  return item as EntryInput & { correctsId?: string };
}
function read(expression: ExpressionInput) {
  return "latex" in expression ? readAlgebraLatex(expression.latex) : parseAlgebraExpression(expression.ast);
}
function display(expression: ExpressionInput): string {
  const parsed = read(expression);
  return parsed.ok
    ? formatExpression(parsed.expression)
    : "latex" in expression
      ? expression.latex
      : "[unreadable AST]";
}
export function createAuditTrail(start: StartInput): AuditTrailResult {
  try {
    const item = input(start, false, true),
      parsed = read(item.expression);
    const reduced = parsed.ok ? reduceRational(parsed.expression) : parsed;
    const readResult = reduced.ok
      ? { ok: true as const }
      : { ok: false as const, reason: reduced.reason, detail: reduced.detail };
    return {
      ok: true,
      trail: freeze({
        entries: [{ ...item, index: 0, kind: "start" as const, read: readResult }],
        effectiveChain: [item.id],
      }),
    };
  } catch {
    return error("malformed-input", "Invalid start input");
  }
}
function append(trail: AuditTrail, value: EntryInput & { correctsId?: string }, correction: boolean): AuditTrailResult {
  try {
    const item = input(value, correction);
    if (!trail || !Array.isArray(trail.entries) || !Array.isArray(trail.effectiveChain) || !trail.entries.length)
      return error("malformed-input", "Invalid trail");
    if (trail.entries.some(entry => entry.id === item.id)) return error("duplicate-id", "Entry id already exists");
    if (trail.entries.length >= AUDIT_TRAIL_LIMIT) return error("trail-limit", "Audit trail is full");
    let chain = [...trail.effectiveChain];
    if (correction) {
      const target = trail.entries.find(entry => entry.id === item.correctsId);
      if (!target) return error("unknown-id", "Correction target does not exist");
      if (target.kind === "start") return error("cannot-correct-start", "The starting entry cannot be corrected");
      const position = chain.indexOf(target.id);
      if (position < 0) return error("superseded-id", "Correction target is superseded");
      chain = chain.slice(0, position);
    }
    const previousEntryId = chain[chain.length - 1];
    const previous = trail.entries.find(entry => entry.id === previousEntryId);
    if (!previous) return error("malformed-input", "Invalid effective chain");
    const result = checkTransformation({
      previous: previous.expression,
      proposed: item.expression,
      ...(item.operation ? { operation: item.operation } : {}),
      provenance: {
        previousId: previousEntryId,
        proposedId: item.id,
        ...(item.sourceIds ? { sourceIds: item.sourceIds } : {}),
      },
    });
    const entry: Entry = {
      ...item,
      index: trail.entries.length,
      kind: correction ? "correction" : "step",
      previousEntryId,
      result,
    };
    return { ok: true, trail: freeze({ entries: [...trail.entries, entry], effectiveChain: [...chain, item.id] }) };
  } catch {
    return error("malformed-input", "Invalid audit input");
  }
}
export function appendStep(trail: AuditTrail, step: EntryInput): AuditTrailResult {
  return append(trail, step, false);
}
export function appendCorrection(trail: AuditTrail, correction: EntryInput & { correctsId: string }): AuditTrailResult {
  return append(trail, correction, true);
}
export function auditSummary(trail: AuditTrail): AuditSummary {
  const entries = new Map(trail.entries.map(entry => [entry.id, entry]));
  const counts = { verified: 0, invalid: 0, unverified: 0, domainChanged: 0 };
  let firstIssue: AuditSummary["firstIssue"] = null;
  for (const id of trail.effectiveChain.slice(1)) {
    const entry = entries.get(id)!;
    if (entry.kind === "start") continue;
    const result = entry.result;
    const category =
      result.verdict === "not-equivalent"
        ? "invalid"
        : result.verdict !== "equivalent"
          ? "unverified"
          : result.domain?.status !== "preserved"
            ? "domain-changed"
            : "verified";
    counts[category === "domain-changed" ? "domainChanged" : category]++;
    if (category !== "verified" && !firstIssue)
      firstIssue = {
        entryId: id,
        index: entry.index,
        previousEntryId: entry.previousEntryId,
        category,
        verdict: result.verdict,
        reason: result.reason,
        ...(result.domain ? { domainStatus: result.domain.status } : {}),
        ...(result.verdict === "not-equivalent" && result.discrepancy ? { discrepancy: result.discrepancy } : {}),
        previousExpression: display(entries.get(entry.previousEntryId)!.expression),
        proposedExpression: display(entry.expression),
      };
  }
  const position = firstIssue ? trail.effectiveChain.indexOf(firstIssue.entryId) : -1;
  return {
    status: firstIssue ? "attention" : "verified",
    firstIssue,
    effectiveChain: [...trail.effectiveChain],
    superseded: trail.entries.filter(entry => !trail.effectiveChain.includes(entry.id)).map(entry => entry.id),
    dependsOnIssue: position < 0 ? [] : trail.effectiveChain.slice(position + 1),
    counts,
  };
}
export function auditSequence(
  expressions: readonly (ExpressionInput | string)[],
  options?: { ids?: readonly string[] },
): { ok: true; trail: AuditTrail; summary: AuditSummary } | { ok: false; reason: string; detail: string } {
  try {
    if (
      !Array.isArray(expressions) ||
      !expressions.length ||
      (options &&
        (!Array.isArray(options.ids) ||
          options.ids.length !== expressions.length ||
          !Array.from(options.ids).every(id => typeof id === "string" && id.length > 0)))
    )
      return error("malformed-input", "Expected expressions and matching ids");
    const convert = (expression: ExpressionInput | string) =>
      typeof expression === "string" ? { latex: expression } : expression;
    let result = createAuditTrail({ id: options?.ids?.[0] ?? "step-0", expression: convert(expressions[0]) });
    for (let index = 1; index < expressions.length && result.ok; index++)
      result = appendStep(result.trail, {
        id: options?.ids?.[index] ?? `step-${index}`,
        expression: convert(expressions[index]),
      });
    return result.ok ? { ...result, summary: auditSummary(result.trail) } : result;
  } catch {
    return error("malformed-input", "Invalid sequence input");
  }
}
