import { responseSceneValidity, sessionSpeechInterval } from "../lib/evidence-timing";
import { v } from "convex/values";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { reviewedObserverClaim } from "../lib/reviewed-observation";
import {
  validateObserverProposal,
  validateParentDecision,
  type CanonicalObservationRecord,
  type ObservationClaim,
  type ObserverProposal,
  type ParentDecision,
} from "../lib/observation-contracts";

export const repairLevel = v.union(
  v.literal("verified"),
  v.literal("light_correction"),
  v.literal("substantial_repair"),
);
const scope = { sessionId: v.id("sessions"), analysisId: v.id("observerAnalyses") };
const limit = 1000;

/** Refetch the entire canonical record; a changed integrity/recording snapshot invalidates review. */
async function batch(ctx: QueryCtx, sessionId: Id<"sessions">, analysisId: Id<"observerAnalyses">) {
  const session = await ctx.db.get(sessionId);
  const analysis = await ctx.db.get(analysisId);
  if (!session || !analysis || analysis.sessionId !== sessionId) throw new Error("Invalid review session/analysis");
  if (analysis.status !== "ready") throw new Error("Review requires ready analysis");
  const events = await ctx.db
    .query("sessionEvents")
    .withIndex("by_session_order", q => q.eq("sessionId", sessionId))
    .take(limit + 1);
  const proposals = await ctx.db
    .query("observerProposals")
    .withIndex("by_analysis_ordinal", q => q.eq("analysisId", analysisId))
    .take(limit + 1);
  const decisions = await ctx.db
    .query("parentDecisions")
    .withIndex("by_analysis", q => q.eq("analysisId", analysisId))
    .take(limit + 1);
  if ([events, proposals, decisions].some(rows => rows.length > limit))
    throw new Error("Review exceeds 1000-row completeness limit");
  const snapshot = JSON.stringify({
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
  if (snapshot !== analysis.inputSnapshot) throw new Error("Stale analysis: canonical record changed");
  const record = {
    session: { _id: sessionId, state: session.state, recordStatus: session.recordStatus },
    ...(session.recording
      ? {
          recording: {
            recordingId: `${sessionId}:recording`,
            startOffsetMs: session.recording.startOffsetMs,
            durationMs: session.recording.durationMs,
          },
        }
      : {}),
    events,
  };
  const timingUnverifiedIds = new Set<Id<"observerProposals">>();
  for (const row of proposals) {
    const result = validateObserverProposal(row.proposal, record);
    if (row.sessionId !== sessionId) throw new Error("Invalid stored proposal provenance");
    if (!result.ok) {
      // Legacy compatibility permits exclusion only. Keep every other provenance
      // check strict, and never endorse a timing-invalid immutable proposal.
      const responseSource = row.proposal.sources.find(
        (source: ObserverProposal["sources"][number]) => source.role === "response",
      );
      const response =
        responseSource && "eventId" in responseSource
          ? record.events.find(event => event._id === responseSource.eventId)
          : undefined;
      const timingOnly =
        !sessionSpeechInterval(response?.evidence) &&
        result.issues.every(issue =>
          [
            "a concrete behavior requires trustworthy speech start and end timestamps",
            "missing or ambiguous scene timing must be recorded as uncertainty",
            "support must be timestamped before the response begins",
            "recording support must occur before or during the referenced response",
          ].includes(issue.message),
        );
      if (!timingOnly) throw new Error("Invalid stored proposal provenance");
      timingUnverifiedIds.add(row._id);
    }
  }
  const review = await ctx.db
    .query("sessionReviews")
    .withIndex("by_session", q => q.eq("sessionId", sessionId))
    .unique();
  for (const item of decisions) {
    const proposal = proposals.find(row => row._id === item.proposalRowId);
    if (
      item.sessionId !== sessionId ||
      !proposal ||
      !validateParentDecision(item.decision).ok ||
      item.decision.proposalId !== proposal.proposal.proposalId ||
      decisions.filter(row => row.proposalRowId === item.proposalRowId).length !== 1
    )
      throw new Error("Invalid stored decision provenance");
  }
  return { proposals, decisions, review, record, timingUnverifiedIds };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

/** Scene facts stay canonical even when a parent corrects the interpretation of speech. */
function validateCorrectionScene(
  correction: ObservationClaim,
  proposal: ObserverProposal,
  record: CanonicalObservationRecord,
) {
  const sceneSource = proposal.sources.find(source => source.role === "scene");
  const scene =
    sceneSource && "eventId" in sceneSource
      ? record.events.find(event => event._id === sceneSource.eventId)
      : undefined;
  if (
    correction.targetQuantity !== undefined &&
    (scene?.evidence?.type !== "scene_displayed" || correction.targetQuantity !== scene.evidence.targetQuantity)
  )
    throw new Error("Correction target must match the canonical cited scene quantity");

  const responseSource = proposal.sources.find(source => source.role === "response");
  const response =
    responseSource && "eventId" in responseSource
      ? record.events.find(event => event._id === responseSource.eventId)
      : undefined;
  const { valid: supported, attributionMatchesScene } = responseSceneValidity(response?.evidence, scene, record.events);
  if (
    !attributionMatchesScene &&
    (correction.behavior !== "uncertain_exchange" || !correction.uncertaintyReasons.includes("conflicting_context"))
  )
    throw new Error("Correction must retain conflicting canonical response scene attribution uncertainty");
  if (!supported) {
    if (correction.behavior !== "uncertain_exchange")
      throw new Error(
        "Concrete correction requires a uniquely displayed canonical scene throughout the response interval",
      );
    if (
      !correction.uncertaintyReasons.some(
        reason => reason === "missing_scene_context" || reason === "conflicting_context",
      )
    )
      throw new Error("Correction must retain missing or ambiguous scene timing uncertainty");
  }
}

export const decide = internalMutation({
  args: { ...scope, proposalRowId: v.id("observerProposals"), decision: v.any() },
  returns: v.id("parentDecisions"),
  handler: async (ctx, args) => {
    const saved = await batch(ctx, args.sessionId, args.analysisId);
    const row = saved.proposals.find(row => row._id === args.proposalRowId);
    if (!row) throw new Error("Proposal is not in this analysis/session");
    if (
      !args.decision ||
      typeof args.decision !== "object" ||
      Array.isArray(args.decision) ||
      "reviewedAt" in args.decision
    )
      throw new Error("Review timestamp is backend-owned");
    const result = validateParentDecision({ ...args.decision, reviewedAt: Date.now() });
    if (!result.ok) throw new Error(`Invalid parent decision: ${result.issues.map(issue => issue.message).join("; ")}`);
    const decision = result.value;
    if (decision.proposalId !== row.proposal.proposalId) throw new Error("Decision must identify stored proposal");
    if (saved.timingUnverifiedIds.has(row._id) && decision.decision !== "rejected")
      throw new Error("Review is blocked: speech timing is unverified; reject this proposal to exclude it");
    if (decision.correction) {
      // Parent testimony can resolve uncertainty or correct interpretation, but cannot create a new exchange.
      if (!decision.parentContext) throw new Error("Corrections require an explicit parent_review explanation");
      validateCorrectionScene(decision.correction, row.proposal as ObserverProposal, saved.record);
      const support = decision.correction.support;
      if (
        support.sourceEventIds.some(id => !row.proposal.observation.support.sourceEventIds.includes(id)) ||
        (support.recordingSourceIds ?? []).some(
          id => !(row.proposal.observation.support.recordingSourceIds ?? []).includes(id),
        )
      )
        throw new Error("Correction cannot invent support source identity");
      if (support.kinds.some(kind => !row.proposal.observation.support.kinds.includes(kind)))
        throw new Error("Added assistance belongs in parent_review context, not recorded support");
    }
    const prior = saved.decisions.find(item => item.proposalRowId === row._id);
    if (prior) {
      const { reviewedAt: priorTime, ...priorInput } = prior.decision as ParentDecision;
      void priorTime;
      const { reviewedAt: nextTime, ...nextInput } = decision;
      void nextTime;
      if (stable(priorInput) !== stable(nextInput))
        throw new Error("Conflicting repeated decision; decisions are immutable in this slice");
      return prior._id;
    }
    if (saved.review) throw new Error("Review is complete");
    const decisionId = await ctx.db.insert("parentDecisions", {
      sessionId: args.sessionId,
      analysisId: args.analysisId,
      proposalRowId: row._id,
      decision,
    });
    if (decision.decision !== "rejected")
      await ctx.db.insert("reviewedEvidence", {
        sessionId: args.sessionId,
        analysisId: args.analysisId,
        proposalRowId: row._id,
        decisionId,
        exchangeAtMs: row.proposal.exchangeAtMs,
        sources: row.proposal.sources,
        observation: decision.correction ?? reviewedObserverClaim(row.proposal.observation),
        ...(decision.parentContext ? { parentContext: decision.parentContext } : {}),
        reviewedAt: decision.reviewedAt,
        interpretationProvenance: decision.decision === "corrected" ? "parent_review" : "observer",
      });
    return decisionId;
  },
});

const completion = { ...scope, repairLevel, note: v.optional(v.string()), acknowledgeEmpty: v.optional(v.boolean()) };
function metadata(args: { note?: string; acknowledgeEmpty?: boolean }, empty: boolean) {
  if (args.note !== undefined && (!args.note.trim() || args.note.length > 1000))
    throw new Error("Review note must be 1–1000 characters");
  if (empty && args.acknowledgeEmpty !== true) throw new Error("Empty ready batch requires explicit acknowledgment");
  if (!empty && args.acknowledgeEmpty) throw new Error("Nonempty batch cannot be acknowledged as empty");
}

export const complete = internalMutation({
  args: completion,
  returns: v.id("sessionReviews"),
  handler: async (ctx, args) => {
    const saved = await batch(ctx, args.sessionId, args.analysisId);
    metadata(args, saved.proposals.length === 0);
    if (saved.proposals.some(row => !saved.decisions.some(decision => decision.proposalRowId === row._id)))
      throw new Error("Review is incomplete");
    if (
      saved.proposals.some(
        row =>
          saved.timingUnverifiedIds.has(row._id) &&
          !saved.decisions.some(item => item.proposalRowId === row._id && item.decision.decision === "rejected"),
      )
    )
      throw new Error("Review is blocked: speech timing is unverified");
    if (args.repairLevel === "verified" && saved.decisions.some(row => row.decision.decision !== "accepted"))
      throw new Error("Verified review requires unchanged acceptances");
    if (saved.review) {
      if (
        saved.review.analysisId !== args.analysisId ||
        saved.review.repairLevel !== args.repairLevel ||
        saved.review.note !== args.note ||
        saved.review.emptyAcknowledged !== (saved.proposals.length === 0)
      )
        throw new Error("Conflicting review completion");
      return saved.review._id;
    }
    return ctx.db.insert("sessionReviews", {
      sessionId: args.sessionId,
      analysisId: args.analysisId,
      repairLevel: args.repairLevel,
      ...(args.note === undefined ? {} : { note: args.note }),
      emptyAcknowledged: saved.proposals.length === 0,
      completedAt: Date.now(),
    });
  },
});

/** One transaction, including every decision, evidence row and completion record. */
export const acceptAll = internalMutation({
  args: { ...scope, note: v.optional(v.string()), acknowledgeEmpty: v.optional(v.boolean()) },
  returns: v.id("sessionReviews"),
  handler: async (ctx, args) => {
    const saved = await batch(ctx, args.sessionId, args.analysisId);
    if (saved.timingUnverifiedIds.size) throw new Error("Review is blocked: speech timing is unverified");
    metadata(args, saved.proposals.length === 0);
    if (saved.decisions.some(row => row.decision.decision !== "accepted"))
      throw new Error("Accept-all requires an unchanged summary");
    if (saved.review) {
      if (saved.review.repairLevel !== "verified" || saved.review.note !== args.note)
        throw new Error("Conflicting review completion");
      return saved.review._id;
    }
    const reviewedAt = Date.now();
    for (const row of saved.proposals) {
      if (saved.decisions.some(item => item.proposalRowId === row._id)) continue;
      const validated = validateParentDecision({
        kind: "parent_decision",
        proposalId: row.proposal.proposalId,
        decision: "accepted",
        reviewedAt,
      });
      if (!validated.ok) throw new Error("Invalid unchanged decision in accept-all");
      const decisionId = await ctx.db.insert("parentDecisions", {
        sessionId: args.sessionId,
        analysisId: args.analysisId,
        proposalRowId: row._id,
        decision: validated.value,
      });
      await ctx.db.insert("reviewedEvidence", {
        sessionId: args.sessionId,
        analysisId: args.analysisId,
        proposalRowId: row._id,
        decisionId,
        exchangeAtMs: row.proposal.exchangeAtMs,
        sources: row.proposal.sources,
        observation: reviewedObserverClaim(row.proposal.observation),
        reviewedAt,
        interpretationProvenance: "observer",
      });
    }
    return ctx.db.insert("sessionReviews", {
      sessionId: args.sessionId,
      analysisId: args.analysisId,
      repairLevel: "verified",
      ...(args.note === undefined ? {} : { note: args.note }),
      emptyAcknowledged: saved.proposals.length === 0,
      completedAt: reviewedAt,
    });
  },
});

/** Planner callers must supply every prerequisite session (including technical retries). No partial evidence on a blocked result. */
export const forPlanning = internalQuery({
  args: { sessionIds: v.array(v.id("sessions")) },
  returns: v.object({ blocked: v.boolean(), reason: v.union(v.string(), v.null()), evidence: v.array(v.any()) }),
  handler: async (ctx, { sessionIds }) => {
    if (!sessionIds.length || sessionIds.length > 100 || new Set(sessionIds).size !== sessionIds.length)
      throw new Error("Require 1–100 unique prerequisite sessions");
    const evidence = [];
    for (const sessionId of sessionIds) {
      const analysis = await ctx.db
        .query("observerAnalyses")
        .withIndex("by_session", q => q.eq("sessionId", sessionId))
        .unique();
      if (!analysis || analysis.status !== "ready")
        return { blocked: true, reason: "Analysis is incomplete", evidence: [] };
      const saved = await batch(ctx, sessionId, analysis._id);

      if (
        !saved.review ||
        saved.review.analysisId !== analysis._id ||
        saved.proposals.some(row => !saved.decisions.some(decision => decision.proposalRowId === row._id))
      )
        return { blocked: true, reason: "Parent review is incomplete", evidence: [] };
      if (
        saved.proposals.some(
          row =>
            saved.timingUnverifiedIds.has(row._id) &&
            !saved.decisions.some(item => item.proposalRowId === row._id && item.decision.decision === "rejected"),
        )
      )
        return { blocked: true, reason: "Speech timing is unverified", evidence: [] };
      const rows = await ctx.db
        .query("reviewedEvidence")
        .withIndex("by_analysis", q => q.eq("analysisId", analysis._id))
        .take(limit + 1);
      if (rows.length > limit) throw new Error("Evidence exceeds 1000-row completeness limit");
      for (const proposal of saved.proposals) {
        const decision = saved.decisions.find(item => item.proposalRowId === proposal._id)!;
        const linked = rows.filter(row => row.proposalRowId === proposal._id);
        if (linked.length !== (decision.decision.decision === "rejected" ? 0 : 1))
          throw new Error("Invalid reviewed evidence completeness");
      }
      for (const row of rows) {
        const decision = saved.decisions.find(
          item => item._id === row.decisionId && item.proposalRowId === row.proposalRowId,
        );
        if (!decision || decision.decision.decision === "rejected")
          throw new Error("Invalid reviewed evidence linkage");
        // Legacy accepted rows may still contain raw model prose. Project from
        // the validated immutable proposal without rewriting historical decisions.
        const proposal = saved.proposals.find(item => item._id === row.proposalRowId);
        if (!proposal) throw new Error("Invalid reviewed proposal linkage");
        const expectedObservation =
          decision.decision.correction ?? reviewedObserverClaim(proposal.proposal.observation);
        // Older acceptances may have retained raw model prose, but all structured
        // claims and canonical links must still match the immutable decision.
        const actualObservation =
          decision.decision.decision === "accepted" ? reviewedObserverClaim(row.observation) : row.observation;
        if (
          row.sessionId !== sessionId ||
          row.exchangeAtMs !== proposal.proposal.exchangeAtMs ||
          stable(row.sources) !== stable(proposal.proposal.sources) ||
          stable(actualObservation) !== stable(expectedObservation) ||
          stable(row.parentContext ?? null) !== stable(decision.decision.parentContext ?? null) ||
          row.reviewedAt !== decision.decision.reviewedAt ||
          row.interpretationProvenance !== (decision.decision.decision === "corrected" ? "parent_review" : "observer")
        )
          throw new Error("Invalid reviewed evidence provenance");
        evidence.push(
          decision.decision.decision === "accepted"
            ? { ...row, observation: reviewedObserverClaim(proposal.proposal.observation) }
            : row,
        );
      }
    }
    return { blocked: false, reason: null, evidence };
  },
});

/** Internal inspection interface for a later trusted parent-review server bridge. */
export const get = internalQuery({
  args: scope,
  returns: v.object({
    state: v.union(v.literal("incomplete"), v.literal("complete")),
    proposals: v.array(v.any()),
    decisions: v.array(v.any()),
    review: v.union(v.any(), v.null()),
  }),
  handler: async (ctx, args) => {
    const saved = await batch(ctx, args.sessionId, args.analysisId);
    return {
      state: saved.review ? ("complete" as const) : ("incomplete" as const),
      proposals: saved.proposals,
      decisions: saved.decisions,
      review: saved.review,
    };
  },
});

/** Backend-derived review view; status reads do not require READY or disclose raw failures. */
export const inspect = internalQuery({
  args: { sessionId: v.id("sessions") },
  returns: v.string(),
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("Unknown session");
    const analysis = await ctx.db
      .query("observerAnalyses")
      .withIndex("by_session", q => q.eq("sessionId", sessionId))
      .unique();
    const saved = analysis?.status === "ready" ? await batch(ctx, sessionId, analysis._id) : null;
    const result = JSON.stringify({
      sessionId,
      analysisId: analysis?._id ?? null,
      status: analysis?.status ?? "not_started",
      qualification: saved?.timingUnverifiedIds.size
        ? "Saved proposals have unverified speech timing. Reject undecided affected proposals to exclude them, then finish review. Acceptance and correction are unavailable for these proposals. Historical decisions remain final; previously endorsed invalid evidence still blocks planning."
        : session.recordStatus === "incomplete"
          ? "Known incomplete record: some evidence may be missing."
          : null,
      proposals:
        saved?.proposals.map(row => ({
          id: row._id,
          proposal: row.proposal,
          ...(saved.timingUnverifiedIds.has(row._id) ? { resolution: "reject_only" } : {}),
        })) ?? [],
      decisions: saved?.decisions.map(row => ({ proposalRowId: row.proposalRowId, decision: row.decision })) ?? [],
      review: saved?.review
        ? {
            repairLevel: saved.review.repairLevel,
            ...(saved.review.note ? { note: saved.review.note } : {}),
            emptyAcknowledged: saved.review.emptyAcknowledged,
            completedAt: saved.review.completedAt,
          }
        : null,
      sources:
        saved?.record.events
          .filter(event => event.evidence)
          .map(event => ({ id: event._id, eventKey: event.eventKey, atMs: event.atMs, evidence: event.evidence })) ??
        [],
    });
    if (new TextEncoder().encode(result).length > 2_000_000) throw new Error("Review view exceeds byte limit");
    return result;
  },
});
