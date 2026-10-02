import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { DIAGNOSTIC_DETAIL_LIMIT, MAX_OBSERVER_ROWS, type ObserverDiagnostics } from "../lib/observer-diagnostics";

/** Called only after checking the current analysis token and unexpired lease. */
export async function saveDiagnostics(
  ctx: MutationCtx,
  analysis: Doc<"observerAnalyses">,
  diagnostics: ObserverDiagnostics,
  snapshotChanged: boolean,
  now: number,
) {
  const attempt = await ctx.db
    .query("observerDiagnosticAttempts")
    .withIndex("by_analysisId_and_attempt", q => q.eq("analysisId", analysis._id).eq("attempt", analysis.attempt))
    .unique();
  // A worker claimed before this schema existed has no diagnostic attempt. Keep its
  // publication/failure policy intact and explicitly report legacy unavailability.
  if (!attempt) return;
  if (attempt.inputSnapshot !== analysis.inputSnapshot) throw new Error("Diagnostic attempt snapshot mismatch");
  // A result is write-once. Publication can add no rows to an older/newer or settled attempt.
  if (attempt.summary) return;
  if (diagnostics.rows.length > 2 * MAX_OBSERVER_ROWS) throw new Error("Diagnostic row limit exceeded");
  for (const row of diagnostics.rows) {
    const details =
      row.kind === "response"
        ? [row.proposalOrdinals, row.fragmentKeys, row.evaluationEventIds]
        : [row.responseEventIds, row.issues];
    if (
      details.some(list => list.length > DIAGNOSTIC_DETAIL_LIMIT) ||
      new TextEncoder().encode(JSON.stringify(row)).length > 10_000
    )
      throw new Error("Diagnostic detail limit exceeded");
  }
  const { rows, ...summary } = diagnostics;
  for (const [ordinal, diagnostic] of rows.entries())
    await ctx.db.insert("observerDiagnosticRows", { attemptId: attempt._id, ordinal, diagnostic });
  await ctx.db.patch(attempt._id, { summary, snapshotChanged, completedAt: now });
}

/** No raw provider payloads, snapshots, tokens or public failure messages in the review view. */
export async function diagnosticHistory(ctx: QueryCtx, analysis: Doc<"observerAnalyses">) {
  const attempts = await ctx.db
    .query("observerDiagnosticAttempts")
    .withIndex("by_analysisId_and_attempt", q => q.eq("analysisId", analysis._id))
    .take(6);
  if (attempts.length > 5) throw new Error("Diagnostic attempt limit exceeded");
  return {
    availability: attempts.length ? "recorded" : analysis.attempt === 0 ? "not_started" : "legacy_unavailable",
    missingAttempts: Array.from({ length: Math.min(5, analysis.attempt) }, (_, i) => i + 1).filter(
      number => !attempts.some(attempt => attempt.attempt === number),
    ),
    attempts: attempts.map(attempt => ({
      snapshotId: attempt._id,
      attempt: attempt.attempt,
      startedAt: attempt.startedAt,
      recordStatus: attempt.recordStatus,
      hasRecording: attempt.hasRecording,
      state: attempt.summary ? "captured" : "not_captured",
      summary: attempt.summary ?? null,
      snapshotChanged: attempt.snapshotChanged ?? null,
      completedAt: attempt.completedAt ?? null,
    })),
  };
}
