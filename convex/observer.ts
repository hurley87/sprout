import { v } from "convex/values";
import { internalMutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { validateObserverProposal } from "../lib/observation-contracts";

const leaseMs = 5 * 60 * 1000;
const maxAttempts = 5;

export const request = internalMutation({
  args: { sessionId: v.id("sessions") },
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
    .take(1000);
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

export const claim = internalMutation({
  args: { sessionId: v.id("sessions"), now: v.number() },
  handler: async (ctx, { sessionId, now }) => {
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
    if (analysis && analysis.attempt >= maxAttempts) throw new Error("Observer attempt limit reached");
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
        ...(record.session.recordStatus === "incomplete"
          ? {
              qualification:
                "Session record is known incomplete; completed exchanges may still be proposed with explicit uncertainty.",
            }
          : {}),
      });
      return { status: "claimed" as const, analysisId, attempt, token, inputSnapshot };
    }
    await ctx.db.patch(analysis._id, {
      status: "running",
      attempt,
      attemptToken: token,
      leaseUntil: now + leaseMs,
      inputSnapshot,
      failure: undefined,
      completedAt: undefined,
    });
    return { status: "claimed" as const, analysisId: analysis._id, attempt, token, inputSnapshot };
  },
});

export const publish = internalMutation({
  args: { analysisId: v.id("observerAnalyses"), token: v.string(), proposals: v.array(v.any()), now: v.number() },
  handler: async (ctx, { analysisId, token, proposals, now }) => {
    const analysis = await ctx.db.get(analysisId);
    if (!analysis) throw new Error("Analysis does not exist");
    const prior = await ctx.db
      .query("observerProposals")
      .withIndex("by_analysis_ordinal", q => q.eq("analysisId", analysisId))
      .take(1000);
    if (analysis.status === "ready") return prior.map(row => row.proposal);
    if (analysis.status !== "running" || analysis.attemptToken !== token || (analysis.leaseUntil ?? 0) < now)
      throw new Error("Attempt is stale or expired");
    const record = await canonical(ctx, analysis.sessionId);
    if (
      record.session.state !== "ended" ||
      record.session.recordStatus === "pending" ||
      snapshot(record) !== analysis.inputSnapshot
    ) {
      await ctx.db.patch(analysisId, {
        status: "failed",
        failure: "Canonical session inputs changed during analysis; retry against the saved record.",
        attemptToken: undefined,
        leaseUntil: undefined,
      });
      return null;
    }
    const sourceRecord = {
      session: { _id: record.session._id, state: record.session.state, recordStatus: record.session.recordStatus },
      ...(record.session.recording
        ? {
            recording: {
              recordingId: `${record.session._id}:recording`,
              startOffsetMs: record.session.recording.startOffsetMs,
              durationMs: record.session.recording.durationMs,
            },
          }
        : {}),
      events: record.events.map(event => ({
        _id: event._id,
        atMs: event.atMs,
        evidence: event.evidence,
        timeline: event.timeline,
      })),
    };
    const validated = proposals.map(proposal => {
      const result = validateObserverProposal(proposal, sourceRecord);
      if (!result.ok)
        throw new Error(`Invalid proposal: ${result.issues.map(issue => `${issue.path} ${issue.message}`).join("; ")}`);
      return result.value;
    });
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
  args: { analysisId: v.id("observerAnalyses"), token: v.string(), message: v.string(), now: v.number() },
  handler: async (ctx, { analysisId, token, message, now }) => {
    const analysis = await ctx.db.get(analysisId);
    if (
      !analysis ||
      analysis.status !== "running" ||
      analysis.attemptToken !== token ||
      (analysis.leaseUntil ?? 0) < now
    )
      return false;
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
  handler: async (ctx, { sessionId }) => {
    const analysis = await ctx.db
      .query("observerAnalyses")
      .withIndex("by_session", q => q.eq("sessionId", sessionId))
      .unique();
    if (!analysis) return null;
    const rows = await ctx.db
      .query("observerProposals")
      .withIndex("by_analysis_ordinal", q => q.eq("analysisId", analysis._id))
      .take(1000);
    return {
      status: analysis.status,
      attempt: analysis.attempt,
      qualification: analysis.qualification ?? null,
      failure: analysis.failure ?? null,
      proposals: rows.map(row => row.proposal),
    };
  },
});
