import { v } from "convex/values";
import { internalMutation, internalQuery, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  diagnoseObserverOutput,
  observationRecordFromSnapshot,
  MAX_OBSERVER_ROWS as maxObserverRows,
} from "../lib/observer-diagnostics";
import { diagnostics as diagnosticsValidator, failureStage as failureStageValidator } from "./diagnostic_validators";
import { saveDiagnostics } from "./observer_diagnostics";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { diagnosticRow } from "./diagnostic_validators";

const leaseMs = 5 * 60 * 1000;
const maxAttempts = 5;
const exhaustedFailure = "Observer analysis exhausted all five attempts after the final lease expired.";
const incompleteQualification =
  "Session record is known incomplete; analysis uses only saved evidence and may omit conclusions requiring missing material.";
const analysisStatus = v.union(v.literal("pending"), v.literal("running"), v.literal("ready"), v.literal("failed"));

function qualification(recordStatus: "complete" | "incomplete") {
  return recordStatus === "incomplete" ? incompleteQualification : undefined;
}

export const request = internalMutation({
  args: { sessionId: v.id("sessions") },
  returns: v.id("observerAnalyses"),
  handler: async (ctx, { sessionId }) => {
    if (!(await ctx.db.get(sessionId))) throw new Error("Session does not exist");
    const existing = await ctx.db
      .query("observerAnalyses")
      .withIndex("by_session", q => q.eq("sessionId", sessionId))
      .unique();
    if (existing) return existing._id;
    return ctx.db.insert("observerAnalyses", { sessionId, status: "pending", attempt: 0 });
  },
});

async function canonical(ctx: MutationCtx, sessionId: Id<"sessions">) {
  const session = await ctx.db.get(sessionId);
  if (!session) throw new Error("Session does not exist");
  const events = await ctx.db
    .query("sessionEvents")
    .withIndex("by_session_order", q => q.eq("sessionId", sessionId))
    .take(maxObserverRows + 1);
  if (events.length > maxObserverRows)
    throw new Error(`Session has more than ${maxObserverRows} events; Observer analysis is unsupported`);
  return { session, events };
}

function snapshot(record: Awaited<ReturnType<typeof canonical>>) {
  const { session, events } = record;
  return JSON.stringify({
    sessionId: session._id,
    state: session.state,
    recordStatus: session.recordStatus,
    recording: session.recording ?? null,
    events: events.map(event => ({
      _id: event._id,
      order: event.order,
      atMs: event.atMs,
      evidence: event.evidence ?? null,
      timeline: event.timeline ?? null,
    })),
  });
}

async function inputsChanged(ctx: MutationCtx, analysis: { sessionId: Id<"sessions">; inputSnapshot?: string }) {
  try {
    return snapshot(await canonical(ctx, analysis.sessionId)) !== analysis.inputSnapshot;
  } catch {
    // Failure still settles against the claimed input if the current record has
    // disappeared or now exceeds the existing canonical-read limit.
    return true;
  }
}

export const claim = internalMutation({
  args: { sessionId: v.id("sessions"), now: v.number(), expectedAttempt: v.optional(v.number()) },
  returns: v.union(
    v.object({
      status: v.literal("claimed"),
      analysisId: v.id("observerAnalyses"),
      attempt: v.number(),
      token: v.string(),
      inputSnapshot: v.string(),
    }),
    v.object({
      status: analysisStatus,
      analysisId: v.id("observerAnalyses"),
      attempt: v.number(),
      token: v.null(),
      failure: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { sessionId, now, expectedAttempt }) => {
    const record = await canonical(ctx, sessionId);
    if (record.session.state !== "ended" || record.session.recordStatus === "pending")
      throw new Error("Session record is not assembled");
    const analysis = await ctx.db
      .query("observerAnalyses")
      .withIndex("by_session", q => q.eq("sessionId", sessionId))
      .unique();
    if (analysis?.status === "ready")
      return { status: "ready" as const, analysisId: analysis._id, attempt: analysis.attempt, token: null };
    if (analysis?.status === "running" && (analysis.leaseUntil ?? 0) > now)
      return { status: "running" as const, analysisId: analysis._id, attempt: analysis.attempt, token: null };
    if (expectedAttempt !== undefined) {
      if (!Number.isInteger(expectedAttempt) || expectedAttempt < 1)
        throw new Error("Invalid expected Observer attempt");
      if (analysis && expectedAttempt <= analysis.attempt) {
        return {
          status: analysis.status as "pending" | "running" | "ready" | "failed",
          analysisId: analysis._id,
          attempt: analysis.attempt,
          token: null,
          ...(analysis.failure ? { failure: analysis.failure } : {}),
        };
      }
      if (expectedAttempt !== (analysis?.attempt ?? 0) + 1) throw new Error("Scheduled Observer attempt is stale");
    }
    if (analysis && analysis.attempt >= maxAttempts) {
      if (analysis.status === "running") {
        await ctx.db.patch(analysis._id, {
          status: "failed",
          failure: exhaustedFailure,
          attemptToken: undefined,
          leaseUntil: undefined,
          completedAt: now,
        });
        return {
          status: "failed" as const,
          analysisId: analysis._id,
          attempt: analysis.attempt,
          token: null,
          failure: exhaustedFailure,
        };
      }
      if (analysis.status === "failed")
        return {
          status: "failed" as const,
          analysisId: analysis._id,
          attempt: analysis.attempt,
          token: null,
          failure: analysis.failure ?? exhaustedFailure,
        };
      await ctx.db.patch(analysis._id, {
        status: "failed",
        failure: exhaustedFailure,
        attemptToken: undefined,
        leaseUntil: undefined,
        completedAt: now,
      });
      return {
        status: "failed" as const,
        analysisId: analysis._id,
        attempt: analysis.attempt,
        token: null,
        failure: exhaustedFailure,
      };
    }
    const attempt = (analysis?.attempt ?? 0) + 1;
    const token = `${sessionId}:${attempt}:${now}`;
    const inputSnapshot = snapshot(record);
    if (!analysis) {
      const analysisId = await ctx.db.insert("observerAnalyses", {
        sessionId,
        status: "running",
        attempt,
        attemptToken: token,
        leaseUntil: now + leaseMs,
        inputSnapshot,
        qualification: qualification(record.session.recordStatus),
      });
      await ctx.db.insert("observerDiagnosticAttempts", {
        analysisId,
        attempt,
        inputSnapshot,
        startedAt: now,
        recordStatus: record.session.recordStatus,
        hasRecording: !!record.session.recording,
      });
      return { status: "claimed" as const, analysisId, attempt, token, inputSnapshot };
    }
    await ctx.db.patch(analysis._id, {
      status: "running",
      attempt,
      attemptToken: token,
      leaseUntil: now + leaseMs,
      inputSnapshot,
      qualification: qualification(record.session.recordStatus),
      failure: undefined,
      completedAt: undefined,
    });
    await ctx.db.insert("observerDiagnosticAttempts", {
      analysisId: analysis._id,
      attempt,
      inputSnapshot,
      startedAt: now,
      recordStatus: record.session.recordStatus,
      hasRecording: !!record.session.recording,
    });
    return { status: "claimed" as const, analysisId: analysis._id, attempt, token, inputSnapshot };
  },
});

export const publish = internalMutation({
  args: { analysisId: v.id("observerAnalyses"), token: v.string(), proposals: v.array(v.any()), now: v.number() },
  returns: v.union(v.array(v.any()), v.null()),
  handler: async (ctx, { analysisId, token, proposals, now }) => {
    const analysis = await ctx.db.get(analysisId);
    if (!analysis) throw new Error("Analysis does not exist");
    const prior = await ctx.db
      .query("observerProposals")
      .withIndex("by_analysis_ordinal", q => q.eq("analysisId", analysisId))
      .take(maxObserverRows + 1);
    if (prior.length > maxObserverRows)
      throw new Error(`Stored Observer batch exceeds the ${maxObserverRows}-proposal limit`);
    if (analysis.status === "ready") return prior.map(row => row.proposal);
    if (proposals.length > maxObserverRows)
      throw new Error(`Observer proposal batch exceeds the ${maxObserverRows}-proposal limit`);
    if (analysis.status !== "running" || analysis.attemptToken !== token || (analysis.leaseUntil ?? 0) <= now)
      throw new Error("Attempt is stale or expired");
    const record = await canonical(ctx, analysis.sessionId);
    const sourceRecord = observationRecordFromSnapshot(analysis.inputSnapshot!);
    const { diagnostics, results } = diagnoseObserverOutput(sourceRecord, proposals, "publication");
    if (
      record.session.state !== "ended" ||
      record.session.recordStatus === "pending" ||
      snapshot(record) !== analysis.inputSnapshot
    ) {
      await saveDiagnostics(ctx, analysis, diagnostics, true, now);
      await ctx.db.patch(analysisId, {
        status: "failed",
        failure: "Canonical session inputs changed during analysis; retry against the saved record.",
        attemptToken: undefined,
        leaseUntil: undefined,
      });
      return null;
    }
    const validated = results.map(result => {
      if (!result.ok)
        throw new Error(`Invalid proposal: ${result.issues.map(issue => `${issue.path} ${issue.message}`).join("; ")}`);
      return result.value;
    });
    await saveDiagnostics(ctx, analysis, diagnostics, false, now);
    for (const [ordinal, proposal] of validated.entries())
      await ctx.db.insert("observerProposals", { analysisId, sessionId: analysis.sessionId, ordinal, proposal });
    await ctx.db.patch(analysisId, {
      status: "ready",
      completedAt: now,
      attemptToken: undefined,
      leaseUntil: undefined,
      failure: undefined,
    });
    return validated;
  },
});

export const fail = internalMutation({
  args: {
    analysisId: v.id("observerAnalyses"),
    token: v.string(),
    message: v.string(),
    now: v.number(),
    diagnostics: v.optional(diagnosticsValidator),
    failureStage: v.optional(failureStageValidator),
    // Recompute independent backend validation after a publication transaction rolls back.
    proposals: v.optional(v.array(v.any())),
  },
  returns: v.boolean(),
  handler: async (ctx, { analysisId, token, message, now, diagnostics, proposals, failureStage }) => {
    const analysis = await ctx.db.get(analysisId);
    if (
      !analysis ||
      analysis.status !== "running" ||
      analysis.attemptToken !== token ||
      (analysis.leaseUntil ?? 0) <= now
    )
      return false;
    const report =
      proposals !== undefined
        ? diagnoseObserverOutput(observationRecordFromSnapshot(analysis.inputSnapshot!), proposals, "publication")
            .diagnostics
        : (diagnostics ??
          diagnoseObserverOutput(observationRecordFromSnapshot(analysis.inputSnapshot!), undefined, "before_output")
            .diagnostics);
    await saveDiagnostics(
      ctx,
      analysis,
      { ...report, failureStage: failureStage ?? report.failureStage },
      await inputsChanged(ctx, analysis),
      now,
    );
    await ctx.db.patch(analysisId, {
      status: "failed",
      failure: message.slice(0, 1000),
      attemptToken: undefined,
      leaseUntil: undefined,
    });
    return true;
  },
});

export const get = query({
  args: { sessionId: v.id("sessions") },
  returns: v.union(
    v.null(),
    v.object({
      status: analysisStatus,
      attempt: v.number(),
      qualification: v.union(v.string(), v.null()),
      failure: v.union(v.string(), v.null()),
      proposals: v.array(v.any()),
    }),
  ),
  handler: async (ctx, { sessionId }) => {
    const analysis = await ctx.db
      .query("observerAnalyses")
      .withIndex("by_session", q => q.eq("sessionId", sessionId))
      .unique();
    if (!analysis) return null;
    const rows = await ctx.db
      .query("observerProposals")
      .withIndex("by_analysis_ordinal", q => q.eq("analysisId", analysis._id))
      .take(maxObserverRows + 1);
    if (rows.length > maxObserverRows)
      throw new Error(`Stored Observer batch exceeds the ${maxObserverRows}-proposal limit`);
    return {
      status: analysis.status,
      attempt: analysis.attempt,
      qualification: analysis.qualification ?? null,
      failure: analysis.failure ?? null,
      proposals: rows.map(row => row.proposal),
    };
  },
});

/** Detailed diagnostics use the existing server-authorized parent-review action boundary. */
export const readDiagnostics = internalQuery({
  args: {
    sessionId: v.id("sessions"),
    snapshotId: v.id("observerDiagnosticAttempts"),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(diagnosticRow),
  handler: async (ctx, { sessionId, snapshotId, paginationOpts }) => {
    if (!Number.isInteger(paginationOpts.numItems) || paginationOpts.numItems < 1 || paginationOpts.numItems > 100)
      throw new Error("Diagnostic page size must be between 1 and 100");
    const attempt = await ctx.db.get(snapshotId);
    const analysis = attempt && (await ctx.db.get(attempt.analysisId));
    if (!analysis || analysis.sessionId !== sessionId) throw new Error("Diagnostic session scope mismatch");
    const result = await ctx.db
      .query("observerDiagnosticRows")
      .withIndex("by_attemptId_and_ordinal", q => q.eq("attemptId", snapshotId))
      .paginate(paginationOpts);
    return { ...result, page: result.page.map(row => row.diagnostic) };
  },
});
