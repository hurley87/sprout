import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { endingReason, evidence } from "./schema";

function nonnegative(value: number, name: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a nonnegative finite number`);
}

export const create = mutation({
  args: { retryOf: v.optional(v.id("sessions")) },
  handler: async (ctx, { retryOf }) => {
    const prior = retryOf === undefined ? null : await ctx.db.get(retryOf);
    if (retryOf !== undefined && !prior) throw new Error("Retry source does not exist");
    if (prior && prior.state !== "ended") throw new Error("Retry source must be ended");
    return ctx.db.insert("sessions", {
      state: "starting",
      recordStatus: "complete",
      createdAt: Date.now(),
      retryOf,
      nextEventOrder: 0,
    });
  },
});

export const activate = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("Session does not exist");
    if (session.state === "starting") {
      await ctx.db.patch(sessionId, { state: "active", startedAt: Date.now() });
    }
    return sessionId;
  },
});

export const appendEvent = mutation({
  args: { sessionId: v.id("sessions"), eventKey: v.string(), atMs: v.number(), evidence },
  handler: async (ctx, { sessionId, eventKey, atMs, evidence }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("Session does not exist");
    if (session.state !== "active") throw new Error("Evidence requires an active session");
    if (!eventKey.trim()) throw new Error("eventKey is required");
    nonnegative(atMs, "atMs");
    if (evidence.type === "utterance") {
      if (!evidence.text.trim()) throw new Error("Utterance text is required");
      if (evidence.startMs !== undefined) nonnegative(evidence.startMs, "startMs");
      if (evidence.endMs !== undefined) nonnegative(evidence.endMs, "endMs");
      if (evidence.startMs !== undefined && evidence.endMs !== undefined && evidence.endMs < evidence.startMs)
        throw new Error("endMs must follow startMs");
    } else if (evidence.type === "scene_displayed") {
      if (
        !evidence.sceneId.trim() ||
        !evidence.arrangement.trim() ||
        !Number.isInteger(evidence.targetQuantity) ||
        evidence.targetQuantity < 1 ||
        !evidence.items.length
      )
        throw new Error("Displayed scene context is incomplete");
    } else if (!evidence.description.trim()) {
      throw new Error("Support description is required");
    }
    const existing = await ctx.db
      .query("sessionEvents")
      .withIndex("by_session_key", q => q.eq("sessionId", sessionId).eq("eventKey", eventKey))
      .unique();
    if (existing) {
      if (existing.atMs !== atMs || JSON.stringify(existing.evidence) !== JSON.stringify(evidence))
        throw new Error("eventKey was reused for different evidence");
      return existing._id;
    }
    const id = await ctx.db.insert("sessionEvents", {
      sessionId,
      eventKey,
      atMs,
      evidence,
      order: session.nextEventOrder,
    });
    await ctx.db.patch(sessionId, { nextEventOrder: session.nextEventOrder + 1 });
    return id;
  },
});

/** Monotonic, including after finalization: recording integrity is not lifecycle. */
export const markIncomplete = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("Session does not exist");
    if (session.recordStatus !== "incomplete") await ctx.db.patch(sessionId, { recordStatus: "incomplete" });
    return sessionId;
  },
});

export const finalize = mutation({
  args: { sessionId: v.id("sessions"), endingReason, recordIncomplete: v.optional(v.boolean()) },
  handler: async (ctx, { sessionId, endingReason: reason, recordIncomplete }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("Session does not exist");
    // Carry known loss atomically even if an earlier markIncomplete request failed.
    if (recordIncomplete && session.recordStatus !== "incomplete")
      await ctx.db.patch(sessionId, { recordStatus: "incomplete" });
    if (session.state === "ended") return sessionId;
    await ctx.db.patch(sessionId, { state: "ended", endedAt: Date.now(), endingReason: reason });
    return sessionId;
  },
});

export const attachRecording = mutation({
  args: {
    sessionId: v.id("sessions"),
    storageId: v.id("_storage"),
    mimeType: v.string(),
    startedAt: v.number(),
    durationMs: v.number(),
  },
  handler: async (ctx, { sessionId, storageId, mimeType, startedAt, durationMs }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("Session does not exist");
    if (session.state !== "ended") throw new Error("Recording can be attached only after finalization");
    if (session.recording) {
      if (
        session.recording.storageId === storageId &&
        session.recording.mimeType === mimeType &&
        session.recording.startedAt === startedAt &&
        session.recording.durationMs === durationMs
      )
        return sessionId;
      throw new Error("Recording is already attached");
    }
    if (!mimeType.trim()) throw new Error("mimeType is required");
    nonnegative(startedAt, "startedAt");
    nonnegative(durationMs, "durationMs");
    if (!(await ctx.db.system.get("_storage", storageId))) throw new Error("Recording file does not exist");
    await ctx.db.patch(sessionId, { recording: { storageId, mimeType, startedAt, durationMs } });
    return sessionId;
  },
});

export const getRecord = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) return null;
    const events = await ctx.db
      .query("sessionEvents")
      .withIndex("by_session_order", q => q.eq("sessionId", sessionId))
      .collect();
    return { session, events };
  },
});
