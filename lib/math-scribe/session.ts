import { appendCorrection, appendStep, auditSummary, createAuditTrail, type AuditTrail } from "../math-audit/audit";
import type { TransformationResult } from "../math-audit/check";
import type { AlgebraExpression } from "../math-audit/expression";
import { formatExpression } from "../math-audit/format";
import { readAlgebraLatex } from "../math-audit/latex";
import { applyOperation, type OperationResult, type ScribeOperation } from "./operations";

/** Base is the last accepted line; pending versions compose on the working line.
 * Checks alone verify; corrections before a check fix recognition, afterwards edit math.
 * A correction without a pending line requires clarification, never a new proposal.
 * Withdrawals and retries remain in the append-only log and audit trail.
 */
export type Interpretation =
  | { intent: "propose"; operation: ScribeOperation; source: "instruction" | "report"; quote: string }
  | { intent: "correct"; operation: ScribeOperation; quote: string }
  | {
      intent:
        | "confirm"
        | "undo"
        | "request-check"
        | "describe-strategy"
        | "request-help"
        | "request-repeat"
        | "continue-unverified";
      quote: string;
    }
  | { intent: "clarify"; question: string; readings?: AlgebraExpression[]; quote?: string };
export type SessionEvent =
  | { type: "interpretation"; requestId: string; basedOnRevision: number; interpretation: Interpretation; at: number }
  | { type: "ui"; action: "confirm" | "undo" | "check" | "continue"; at: number };
export type LineStatus = "interpreted" | "confirmed" | "verified" | "invalid" | "unverified";
export type Changed = Extract<OperationResult, { ok: true }>["changed"];
export type PendingVersion = {
  expression: AlgebraExpression;
  origin: "spoken-expression" | "scribed-operation";
  operation: ScribeOperation;
  quote: string;
  cause: "edit" | "recognition-correction";
  changed: Changed;
  at: number;
  parent: number | null;
};
export type Pending = {
  versions: readonly PendingVersion[];
  current: number;
  confirmed: boolean;
  source: "instruction" | "report";
  status: LineStatus;
  firstProposedAt: number;
  checked: boolean;
};
export type AcceptedLine = {
  id: string;
  expression: AlgebraExpression;
  status: "verified" | "unverified";
  domainStatus?: NonNullable<TransformationResult["domain"]>["status"];
  pending?: Pending;
  withdrawn?: boolean;
};
export type Clarification = { question: string; readings?: AlgebraExpression[] };
type SafeDiscrepancy = { [key: string]: unknown };
export type SessionNotice =
  | { kind: "proposed"; latex: string; changed: Changed }
  | {
      kind: "checked";
      verdict: TransformationResult["verdict"];
      reason: string;
      domainStatus?: NonNullable<TransformationResult["domain"]>["status"];
      discrepancy?: SafeDiscrepancy;
    }
  | { kind: "clarify"; question: string }
  | { kind: "stale" | "nothing-changed" | "confirmed" | "undone" | "continued" | "limit" }
  | { kind: "logged"; intent: string };
export type SessionLogEntry = {
  at: number;
  revision: number;
  intent: string;
  quote?: string;
  requestId?: string;
  status: LineStatus;
  outcome: SessionNotice["kind"];
  version?: PendingVersion;
  check?: TransformationResult;
  duration?: number;
};
export type SessionState = {
  problemId: string;
  revision: number;
  base: AlgebraExpression;
  history: readonly AcceptedLine[];
  pending: Pending | null;
  clarification: Clarification | null;
  lastCheck: TransformationResult | null;
  audit: AuditTrail;
  correctionTarget: string | null;
  log: readonly SessionLogEntry[];
};
export const SESSION_LIMITS = { versions: 64, acceptedLines: 100, logEntries: 1000 } as const;

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const copy = <T>(value: T): T => structuredClone(value);
const status = (state: SessionState): LineStatus =>
  state.pending?.status ?? state.history.filter(line => !line.withdrawn).at(-1)!.status;

export function createSession(input: {
  problemId: string;
  latex: string;
}): { ok: true; state: SessionState } | { ok: false; reason: string } {
  if (!input.problemId) return { ok: false, reason: "invalid-problem-id" };
  const parsed = readAlgebraLatex(input.latex);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const audit = createAuditTrail({ id: "start", expression: { ast: parsed.expression } });
  if (!audit.ok) return { ok: false, reason: audit.reason };
  return {
    ok: true,
    state: freeze({
      problemId: input.problemId,
      revision: 0,
      base: parsed.expression,
      history: [{ id: "start", expression: parsed.expression, status: "verified" }],
      pending: null,
      clarification: null,
      lastCheck: null,
      audit: audit.trail,
      correctionTarget: null,
      log: [],
    }),
  };
}

export function reduceSession(
  state: SessionState,
  event: SessionEvent,
): { state: SessionState; notice: SessionNotice } {
  if (state.log.length >= SESSION_LIMITS.logEntries) return { state, notice: { kind: "limit" } };
  const intent =
    event.type === "ui"
      ? ({ confirm: "confirm", undo: "undo", check: "request-check", continue: "continue-unverified" } as const)[
          event.action
        ]
      : event.interpretation.intent;
  const quote = event.type === "interpretation" ? event.interpretation.quote : undefined;
  const next: SessionState = { ...state };
  let notice: SessionNotice = { kind: "nothing-changed" };
  let version: PendingVersion | undefined;
  let checked: TransformationResult | undefined;
  let duration: number | undefined;
  const stale = event.type === "interpretation" && event.basedOnRevision !== state.revision;
  if (stale) notice = { kind: "stale" };
  else if (event.type === "interpretation" && (intent === "propose" || intent === "correct")) {
    const interpretation = event.interpretation as Extract<Interpretation, { intent: "propose" | "correct" }>;
    if (intent === "correct" && !state.pending) {
      next.clarification = { question: "What would you like to change?" };
      notice = { kind: "clarify", question: next.clarification.question };
    } else if (state.pending && state.pending.versions.length >= SESSION_LIMITS.versions) notice = { kind: "limit" };
    else {
      const result = applyOperation(
        state.pending?.versions[state.pending.current].expression ?? state.base,
        interpretation.operation,
      );
      if (!result.ok) {
        next.clarification = { question: result.detail };
        notice = { kind: "clarify", question: result.detail };
      } else {
        version = {
          ...result,
          operation: copy(interpretation.operation),
          quote: interpretation.quote,
          cause: intent === "correct" && !state.pending?.checked ? "recognition-correction" : "edit",
          at: event.at,
          parent: state.pending?.current ?? null,
        };
        const versions = [...(state.pending?.versions ?? []), version];
        next.pending = {
          versions,
          current: versions.length - 1,
          confirmed: false,
          source: interpretation.intent === "propose" ? interpretation.source : state.pending!.source,
          status: "interpreted",
          firstProposedAt: state.pending?.firstProposedAt ?? event.at,
          checked: state.pending?.checked ?? false,
        };
        next.clarification = null;
        notice = { kind: "proposed", latex: formatExpression(result.expression), changed: result.changed };
      }
    }
  } else if (event.type === "interpretation" && event.interpretation.intent === "clarify") {
    next.clarification = copy({
      question: event.interpretation.question,
      ...(event.interpretation.readings ? { readings: event.interpretation.readings } : {}),
    });
    notice = { kind: "clarify", question: next.clarification.question };
  } else if (intent === "confirm" && state.pending && !state.pending.confirmed) {
    next.pending = {
      ...state.pending,
      confirmed: true,
      status: state.pending.status === "interpreted" ? "confirmed" : state.pending.status,
    };
    notice = { kind: "confirmed" };
  } else if (intent === "undo") {
    if (state.pending) {
      const pending = state.pending;
      const parent = pending.versions[pending.current].parent;
      next.pending = parent === null ? null : { ...pending, current: parent, confirmed: false, status: "interpreted" };
      version = pending.versions[pending.current];
      next.clarification = null;
      notice = { kind: "undone" };
    } else {
      const active = state.history.filter(line => !line.withdrawn);
      if (active.length > 1) {
        const withdrawn = active.at(-1)!;
        next.history = state.history.map(line => (line.id === withdrawn.id ? { ...line, withdrawn: true } : line));
        next.base = active.at(-2)!.expression;
        next.correctionTarget = withdrawn.id;
        next.lastCheck = null;
        notice = { kind: "undone" };
      }
    }
  } else if (intent === "request-check" && state.pending) {
    if (state.history.length >= SESSION_LIMITS.acceptedLines && state.pending.status !== "invalid")
      notice = { kind: "limit" };
    else {
      const pending = state.pending;
      const id = `entry-${state.audit.entries.length}`;
      const input = { id, expression: { ast: pending.versions[pending.current].expression } };
      const result = state.correctionTarget
        ? appendCorrection(state.audit, { ...input, correctsId: state.correctionTarget })
        : appendStep(state.audit, input);
      if (!result.ok) notice = { kind: "limit" };
      else {
        const entry = result.trail.entries.at(-1)!;
        if (entry.kind === "start") throw new Error("Unexpected audit start");
        checked = entry.result;
        duration = Math.max(0, event.at - pending.firstProposedAt);
        const lineStatus =
          checked.verdict === "equivalent"
            ? "verified"
            : checked.verdict === "not-equivalent"
              ? "invalid"
              : "unverified";
        const updated: Pending = { ...pending, confirmed: true, status: lineStatus, checked: true };
        next.audit = result.trail;
        next.lastCheck = checked;
        next.correctionTarget = checked.verdict === "equivalent" ? null : id;
        if (checked.verdict === "equivalent") {
          next.base = pending.versions[pending.current].expression;
          next.history = [
            ...state.history,
            {
              id,
              expression: next.base,
              status: "verified",
              ...(checked.domain ? { domainStatus: checked.domain.status } : {}),
              pending: updated,
            },
          ];
          next.pending = null;
        } else next.pending = updated;
        const discrepancy =
          checked.verdict === "not-equivalent" && checked.discrepancy
            ? Object.fromEntries(Object.entries(checked.discrepancy).filter(([key]) => key !== "previousPart"))
            : undefined;
        notice = {
          kind: "checked",
          verdict: checked.verdict,
          reason: checked.reason,
          ...(checked.domain ? { domainStatus: checked.domain.status } : {}),
          ...(discrepancy ? { discrepancy } : {}),
        };
      }
    }
  } else if (intent === "continue-unverified" && state.pending?.status === "unverified") {
    if (state.history.length >= SESSION_LIMITS.acceptedLines) notice = { kind: "limit" };
    else {
      next.base = state.pending.versions[state.pending.current].expression;
      next.history = [
        ...state.history,
        { id: state.correctionTarget!, expression: next.base, status: "unverified", pending: state.pending },
      ];
      next.pending = null;
      next.correctionTarget = null;
      notice = { kind: "continued" };
    }
  } else if (["describe-strategy", "request-help", "request-repeat"].includes(intent))
    notice = { kind: "logged", intent };
  const revision = state.revision + 1;
  next.revision = revision;
  next.log = [
    ...state.log,
    {
      at: event.at,
      revision,
      intent,
      ...(quote !== undefined ? { quote } : {}),
      ...(event.type === "interpretation" ? { requestId: event.requestId } : {}),
      status: status(next),
      outcome: notice.kind,
      ...(version ? { version } : {}),
      ...(checked ? { check: checked } : {}),
      ...(duration !== undefined ? { duration } : {}),
    },
  ];
  return { state: freeze(next), notice: freeze(notice) };
}

export function snapshot(state: SessionState) {
  const render = (expression: AlgebraExpression) => ({ expression, latex: formatExpression(expression) });
  return freeze({
    base: render(state.base),
    history: state.history.map(line => ({ ...line, latex: formatExpression(line.expression) })),
    pending: state.pending
      ? {
          ...state.pending,
          versions: state.pending.versions.map(item => ({ ...item, latex: formatExpression(item.expression) })),
        }
      : null,
    workingLine: render(state.pending?.versions[state.pending.current].expression ?? state.base),
    lastCheck: state.lastCheck,
    clarification: state.clarification,
    paper: "unseen" as const,
    audit: auditSummary(state.audit),
  });
}

export function sessionMetrics(state: SessionState) {
  const checks = { equivalent: 0, "not-equivalent": 0, unsupported: 0, ambiguous: 0 };
  for (const entry of state.log) if (entry.check) checks[entry.check.verdict]++;
  return {
    proposals: state.log.filter(entry => entry.outcome === "proposed" && entry.intent === "propose").length,
    recognitionCorrections: state.log.filter(
      entry => entry.version?.cause === "recognition-correction" && entry.outcome === "proposed",
    ).length,
    clarifications: state.log.filter(entry => entry.outcome === "clarify").length,
    checks,
    undos: state.log.filter(entry => entry.outcome === "undone").length,
    staleDrops: state.log.filter(entry => entry.outcome === "stale").length,
    stepTimes: state.log.flatMap(entry => (entry.duration === undefined ? [] : [entry.duration])),
  };
}
