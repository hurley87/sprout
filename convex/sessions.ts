import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { endingReason, evidence, timeline } from "./schema";

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
      recordStatus: "pending",
      createdAt: Date.now(),
      retryOf,
      nextEventOrder: 0,
    });
  },
});

export const activate = mutation({
  args: { sessionId: v.id("sessions"), startedAt: v.optional(v.number()) },
  handler: async (ctx, { sessionId, startedAt }) => {
    if (startedAt !== undefined) nonnegative(startedAt, "startedAt");
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("Session does not exist");
    if (session.state === "starting") {
      await ctx.db.patch(sessionId, { state: "active", startedAt: startedAt ?? Date.now() });
    }
    return sessionId;
  },
});

export const appendEvent = mutation({
  args: {
    sessionId: v.id("sessions"),
    eventKey: v.string(),
    atMs: v.number(),
    evidence: v.optional(evidence),
    timeline: v.optional(timeline),
  },
  handler: async (ctx, { sessionId, eventKey, atMs, evidence, timeline }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("Session does not exist");
    if (session.state !== "active") throw new Error("Evidence requires an active session");
    if (!eventKey.trim()) throw new Error("eventKey is required");
    nonnegative(atMs, "atMs");
    if (Boolean(evidence) === Boolean(timeline)) throw new Error("Exactly one of evidence or timeline is required");
    if (evidence?.type === "scene_displayed") {
      if (
        !evidence.sceneId.trim() ||
        !evidence.arrangement.trim() ||
        !Number.isInteger(evidence.targetQuantity) ||
        evidence.targetQuantity < 1 ||
        !evidence.items.length
      )
        throw new Error("Displayed scene context is incomplete");
    } else if (evidence?.type === "support" && !evidence.description.trim()) {
      throw new Error("Support description is required");
    }
    const speech =
      evidence?.type === "utterance"
        ? evidence
        : timeline?.type === "sprout_generated_utterance"
          ? timeline
          : undefined;
    if (speech) {
      if (!speech.text.trim()) throw new Error("Utterance text is required");
      for (const field of ["startMs", "endMs", "firstObservedAtMs", "lastObservedAtMs"] as const) {
        const value = speech[field];
        if (value !== undefined) nonnegative(value, field);
      }
      if (speech.startMs !== undefined && speech.endMs !== undefined && speech.endMs < speech.startMs)
        throw new Error("endMs must follow startMs");
      if (
        speech.firstObservedAtMs !== undefined &&
        speech.lastObservedAtMs !== undefined &&
        speech.lastObservedAtMs < speech.firstObservedAtMs
      )
        throw new Error("lastObservedAtMs must follow firstObservedAtMs");
    }
    if (timeline?.type === "microphone_speech_stopped") {
      nonnegative(timeline.quietMs, "quietMs");
      if (!Number.isFinite(timeline.estimatedAcousticEndAtMs)) throw new Error("Estimated acoustic end must be finite");
    }
    if (
      timeline &&
      "correlationKey" in timeline &&
      typeof timeline.correlationKey === "string" &&
      !timeline.correlationKey.trim()
    )
      throw new Error("correlationKey is required");
    if (
      timeline &&
      "sceneIndex" in timeline &&
      typeof timeline.sceneIndex === "number" &&
      (!Number.isInteger(timeline.sceneIndex) || timeline.sceneIndex < 0)
    )
      throw new Error("Invalid sceneIndex");
    if (timeline?.type === "evaluation_control") {
      if (!timeline.action.trim()) throw new Error("Control action is required");
      for (const [field, value] of Object.entries({
        sceneIndex: timeline.sceneIndex,
        transcriptRevision: timeline.transcriptRevision,
        sourceId: timeline.sourceId,
        offsetMs: timeline.offsetMs,
      }))
        if (value !== undefined) nonnegative(value, field);
    }
    if (timeline?.type === "answer_evaluation_requested")
      nonnegative(timeline.turnEndToRequestMs, "turnEndToRequestMs");
    if (timeline?.type === "answer_evaluation_resolved") {
      nonnegative(timeline.latencyMs, "latencyMs");
      if (
        timeline.probability !== undefined &&
        (!Number.isFinite(timeline.probability) || timeline.probability < 0 || timeline.probability > 1)
      )
        throw new Error("Invalid probability");
      if (timeline.status === "unavailable" && timeline.probability !== undefined)
        throw new Error("Unavailable evaluation has no probability");
    }
    if (timeline?.type === "playback_gate_changed" && !timeline.reason.trim())
      throw new Error("Gate reason is required");
    if (
      timeline?.type === "scene_advance_committed" &&
      (!Number.isInteger(timeline.fromScene) || timeline.fromScene < 0 || timeline.toScene !== timeline.fromScene + 1)
    )
      throw new Error("Invalid scene advancement");
    const existing = await ctx.db
      .query("sessionEvents")
      .withIndex("by_session_key", q => q.eq("sessionId", sessionId).eq("eventKey", eventKey))
      .unique();
    if (existing) {
      if (
        existing.atMs !== atMs ||
        JSON.stringify(existing.evidence) !== JSON.stringify(evidence) ||
        JSON.stringify(existing.timeline) !== JSON.stringify(timeline)
      )
        throw new Error("eventKey was reused for different evidence");
      return existing._id;
    }
    const id = await ctx.db.insert("sessionEvents", {
      sessionId,
      eventKey,
      atMs,
      ...(evidence ? { evidence } : { timeline }),
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

export const generateUploadUrl = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session || session.state !== "ended") throw new Error("Upload requires an ended session");
    if (session.recording) throw new Error("Recording is already attached");
    return ctx.storage.generateUploadUrl();
  },
});

export const attachRecording = mutation({
  args: {
    sessionId: v.id("sessions"),
    storageId: v.id("_storage"),
    mimeType: v.string(),
    startOffsetMs: v.number(),
    durationMs: v.number(),
  },
  handler: async (ctx, { sessionId, storageId, mimeType, startOffsetMs, durationMs }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("Session does not exist");
    if (session.state !== "ended") throw new Error("Recording can be attached only after finalization");
    if (session.recording) {
      if (
        session.recording.storageId === storageId &&
        session.recording.mimeType === mimeType &&
        session.recording.startOffsetMs === startOffsetMs &&
        session.recording.durationMs === durationMs
      )
        return sessionId;
      throw new Error("Recording is already attached");
    }
    if (!mimeType.trim()) throw new Error("mimeType is required");
    nonnegative(startOffsetMs, "startOffsetMs");
    nonnegative(durationMs, "durationMs");
    if (!(await ctx.db.system.get("_storage", storageId))) throw new Error("Recording file does not exist");
    await ctx.db.patch(sessionId, {
      recording: { storageId, mimeType, startOffsetMs, durationMs },
      ...(session.recordStatus === "pending" ? { recordStatus: "complete" as const } : {}),
    });
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
    return {
      session,
      events,
      recordingUrl: session.recording ? await ctx.storage.getUrl(session.recording.storageId) : null,
    };
  },
});
