import { v, type Infer, type GenericValidator } from "convex/values";
import { diagnosticRow, diagnosticSummary } from "../convex/diagnostic_validators";
import { isDurableSessionReference } from "./durable-session-reference";
import { DIAGNOSTIC_DETAIL_LIMIT, type ObserverDiagnosticRow } from "./observer-diagnostics";

export const DIAGNOSTIC_PAGE_SIZE = 25;
export const DIAGNOSTIC_PAGE_LIMIT = 50;
export const DIAGNOSTIC_CURSOR_LIMIT = 8192;
const attempt = v.object({
  snapshotId: v.string(),
  attempt: v.number(),
  startedAt: v.number(),
  recordStatus: v.union(v.literal("complete"), v.literal("incomplete")),
  hasRecording: v.boolean(),
  state: v.union(v.literal("captured"), v.literal("not_captured")),
  summary: v.union(diagnosticSummary, v.null()),
  snapshotChanged: v.union(v.boolean(), v.null()),
  completedAt: v.union(v.number(), v.null()),
});
const history = v.object({
  availability: v.union(v.literal("recorded"), v.literal("not_started"), v.literal("legacy_unavailable")),
  missingAttempts: v.optional(v.array(v.number())),
  attempts: v.array(attempt),
});
export type DiagnosticHistory = Infer<typeof history>;
export type DiagnosticAttempt = DiagnosticHistory["attempts"][number];
export type DiagnosticRequest = { sessionId: string; snapshotId: string; cursor: string | null; numItems: number };
export type DiagnosticPage = {
  sessionId: string;
  snapshotId: string;
  page: ObserverDiagnosticRow[];
  isDone: boolean;
  continueCursor: string;
};

const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
/** Check JSON against the existing Convex diagnostic schemas, including unknown-field rejection.
 * Only the schema kinds used by diagnostics are supported; other kinds fail closed. */
function matches(x: unknown, schema: GenericValidator): boolean {
  switch (schema.kind) {
    case "string":
      return typeof x === "string" && x.length <= DIAGNOSTIC_CURSOR_LIMIT;
    case "float64":
      return typeof x === "number" && Number.isFinite(x) && x >= 0;
    case "boolean":
      return typeof x === "boolean";
    case "null":
      return x === null;
    case "literal":
      return x === schema.value;
    case "union":
      return schema.members.some((member: GenericValidator) => matches(x, member));
    case "array":
      return Array.isArray(x) && x.length <= DIAGNOSTIC_PAGE_LIMIT && x.every(item => matches(item, schema.element));
    case "object":
      return (
        object(x) &&
        Object.keys(x).every(key => Object.hasOwn(schema.fields, key)) &&
        Object.entries(schema.fields).every(
          ([key, field]) =>
            ((field as GenericValidator).isOptional === "optional" && x[key] === undefined) ||
            matches(x[key], field as GenericValidator),
        )
      );
    default:
      return false;
  }
}
export function validDiagnosticHistory(x: unknown): x is DiagnosticHistory {
  return (
    matches(x, history) &&
    (x as DiagnosticHistory).attempts.length <= 5 &&
    (x as DiagnosticHistory).attempts.every(
      row =>
        isDurableSessionReference(row.snapshotId) &&
        Number.isInteger(row.attempt) &&
        row.attempt >= 1 &&
        row.attempt <= 5 &&
        (row.state === "captured") === (row.summary !== null),
    )
  );
}
export function validDiagnosticRequest(x: unknown): x is DiagnosticRequest {
  return (
    object(x) &&
    Object.keys(x).length === 4 &&
    Object.keys(x).every(key => ["sessionId", "snapshotId", "cursor", "numItems"].includes(key)) &&
    isDurableSessionReference(x.sessionId) &&
    isDurableSessionReference(x.snapshotId) &&
    (x.cursor === null ||
      (typeof x.cursor === "string" && x.cursor.length > 0 && x.cursor.length <= DIAGNOSTIC_CURSOR_LIMIT)) &&
    typeof x.numItems === "number" &&
    Number.isInteger(x.numItems) &&
    x.numItems >= 1 &&
    x.numItems <= DIAGNOSTIC_PAGE_LIMIT
  );
}
/** Only the bounded public projection is returned by the bridge. */
export function diagnosticPage(x: unknown, request: DiagnosticRequest): DiagnosticPage {
  if (
    !object(x) ||
    !Array.isArray(x.page) ||
    x.page.length > request.numItems ||
    typeof x.isDone !== "boolean" ||
    typeof x.continueCursor !== "string" ||
    x.continueCursor.length > DIAGNOSTIC_CURSOR_LIMIT ||
    (!x.isDone && (!x.continueCursor || x.continueCursor === request.cursor)) ||
    !x.page.every(
      row =>
        matches(row, diagnosticRow) &&
        new TextEncoder().encode(JSON.stringify(row)).length <= 10_000 &&
        (row.kind === "response" ? [row.proposalOrdinals, row.fragmentKeys] : [row.responseEventIds, row.issues]).every(
          list => list.length <= DIAGNOSTIC_DETAIL_LIMIT,
        ),
    )
  )
    throw new Error("Invalid diagnostic page");
  return {
    sessionId: request.sessionId,
    snapshotId: request.snapshotId,
    page: x.page,
    isDone: x.isDone,
    continueCursor: x.continueCursor,
  };
}

export function validDiagnosticPage(x: unknown, request: DiagnosticRequest): x is DiagnosticPage {
  if (!object(x) || x.sessionId !== request.sessionId || x.snapshotId !== request.snapshotId) return false;
  try {
    diagnosticPage(x, request);
    return true;
  } catch {
    return false;
  }
}
