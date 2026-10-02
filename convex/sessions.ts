import { LAST_SCENE, SCENES } from "../lib/lesson";
import { sessionSpeechInterval } from "../lib/evidence-timing";
import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { endingReason, evidence, timeline } from "./schema";
import { makeFunctionReference, type FunctionReference } from "convex/server";

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
  returns: v.id("sessionEvents"),
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
    if (timeline?.type === "help_delivery_candidate") {
      if (!timeline.text.trim()) throw new Error("Help candidate text is required");
      nonnegative(timeline.startMs, "help.startMs");
      nonnegative(timeline.endMs, "help.endMs");
      if (timeline.endMs < timeline.startMs) throw new Error("help.endMs must follow help.startMs");
      if (timeline.sourceId !== undefined && (!Number.isSafeInteger(timeline.sourceId) || timeline.sourceId <= 0))
        throw new Error("help.sourceId must be a positive integer");
      if (timeline.display) {
        if (!timeline.display.sceneId.trim()) throw new Error("Help candidate scene is required");
        nonnegative(timeline.display.displayedAtMs, "help.displayedAtMs");
      }
      if (timeline.displayStatus === "stable" && !timeline.display)
        throw new Error("Stable help candidate display requires scene context");
    }
    if (evidence?.type === "utterance") {
      if (evidence.transcriptFragments) {
        let textEnd = 0;
        const keys = new Set<string>();
        if (evidence.speaker !== "child_or_nearby_speaker") throw new Error("Fragment identity requires child speech");
        for (const fragment of evidence.transcriptFragments) {
          if (
            !fragment.key.trim() ||
            keys.has(fragment.key) ||
            !Number.isSafeInteger(fragment.textStart) ||
            !Number.isSafeInteger(fragment.textEnd) ||
            fragment.textStart !== textEnd ||
            fragment.textEnd < fragment.textStart ||
            fragment.textEnd > evidence.text.length
          )
            throw new Error("Invalid transcript fragment identity");
          keys.add(fragment.key);
          textEnd = fragment.textEnd;
        }
        if (textEnd !== evidence.text.length) throw new Error("Fragment identity must cover the utterance");
      }
      for (const timing of [evidence.providerTiming, evidence.sessionTiming]) {
        if (!timing) continue;
        nonnegative(timing.startMs, "timing.startMs");
        nonnegative(timing.endMs, "timing.endMs");
        if (timing.endMs < timing.startMs) throw new Error("timing.endMs must follow timing.startMs");
      }
      if (evidence.sessionTiming?.provenance === "source_input_bound") {
        const timing = evidence.sessionTiming;
        nonnegative(timing.inputScene.displayedAtMs, "inputScene.displayedAtMs");
        if (
          !Number.isSafeInteger(timing.sourceId) ||
          timing.sourceId < 1 ||
          timing.sourceId !== evidence.providerTiming?.sourceId ||
          timing.inputScene.displayedAtMs > timing.startMs ||
          evidence.firstObservedAtMs === undefined ||
          evidence.lastObservedAtMs === undefined ||
          timing.startMs > evidence.firstObservedAtMs ||
          timing.endMs < evidence.lastObservedAtMs
        )
          throw new Error("Source input bound must contain receipt times and retain its source and scene fence");
      }
      if (evidence.sessionTiming?.provenance === "source_timeline_bound" && !sessionSpeechInterval(evidence))
        throw new Error("Source timeline bound must retain its causal anchor, source and receipt envelope");
      if (evidence.responseScene) nonnegative(evidence.responseScene.displayedAtMs, "responseScene.displayedAtMs");
    }
    if (timeline?.type === "local_playback") {
      const identity = timeline.identity;
      if (
        !timeline.text.trim() ||
        !timeline.assetId.trim() ||
        !/^[a-f0-9]{64}$/.test(timeline.assetSha256) ||
        !timeline.display.token.trim() ||
        !timeline.display.sceneId.trim() ||
        !identity.playbackAttemptId.trim() ||
        !identity.sessionAttemptId.trim() ||
        !identity.correlationKey.trim() ||
        !identity.answerVersion.trim() ||
        timeline.sourceId !== identity.owningSourceId
      )
        throw new Error("Invalid local playback identity");
      for (const value of [
        identity.originSourceId,
        identity.owningSourceId,
        identity.transcriptRevision,
        identity.choreographyEpoch,
      ])
        if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid playback owner");
      if (
        !Number.isSafeInteger(identity.evaluatedSceneIndex) ||
        identity.evaluatedSceneIndex < 0 ||
        identity.evaluatedSceneIndex > LAST_SCENE ||
        (timeline.role === "acknowledgment" && identity.evaluatedSceneIndex === LAST_SCENE)
      )
        throw new Error("Invalid evaluated playback scene");
      if (
        !SCENES.some(scene => scene.id === timeline.display.sceneId) ||
        !timeline.display.token.startsWith(`${identity.sessionAttemptId}:display:`) ||
        (timeline.role === "acknowledgment" &&
          (identity.responseIdentity.sourceStatus !== "known" ||
            !identity.responseIdentity.fragmentKeys.length ||
            new Set(identity.responseIdentity.fragmentKeys).size !== identity.responseIdentity.fragmentKeys.length ||
            identity.responseIdentity.evaluatedScene?.sceneId !== SCENES[identity.evaluatedSceneIndex].id ||
            timeline.display.sceneId !== identity.responseIdentity.evaluatedScene.sceneId ||
            timeline.display.displayedAtMs !== identity.responseIdentity.evaluatedScene.displayedAtMs))
      )
        throw new Error("Invalid playback display or response identity");
      for (const [field, value] of Object.entries({
        observedAt: timeline.observedAt,
        displayAt: timeline.display.displayedAtMs,
        sessionAtMs: timeline.sessionAtMs,
        sessionClockOrigin: timeline.sessionClockOrigin,
        mediaTime: timeline.mediaTime,
        duration: timeline.duration,
        renderFence: timeline.renderFence,
        baseLatency: timeline.baseLatency,
        outputLatency: timeline.outputLatency,
        ...timeline.outputTimestamp,
      }))
        if (value !== undefined) nonnegative(value, field);
      if (
        (timeline.sessionAtMs === undefined) !== (timeline.sessionClockOrigin === undefined) ||
        (timeline.sessionAtMs !== undefined &&
          (Math.abs(timeline.observedAt - timeline.sessionClockOrigin! - timeline.sessionAtMs) > 0.001 ||
            Math.abs(atMs - timeline.sessionAtMs) > 0.001))
      )
        throw new Error("Invalid local playback clock mapping");
      if (
        timeline.state === "completed" &&
        (!Number.isFinite(timeline.renderFence) ||
          timeline.renderFence! <= 0 ||
          !Number.isFinite(timeline.duration) ||
          timeline.duration! <= 0 ||
          timeline.duration! > 10 ||
          !Number.isFinite(timeline.mediaTime) ||
          timeline.mediaTime !== timeline.duration ||
          !Number.isFinite(timeline.outputTimestamp?.contextTime) ||
          timeline.outputTimestamp!.contextTime! <= 0 ||
          timeline.outputTimestamp!.contextTime! < timeline.renderFence! ||
          !Number.isFinite(timeline.outputTimestamp?.performanceTime) ||
          timeline.outputTimestamp!.performanceTime! <= 0)
      )
        throw new Error("Completed playback requires natural end and output fence");
    }
    if (timeline?.type === "choreography_phase") {
      if (
        !timeline.questionToken.trim() ||
        !timeline.sessionAttemptId.trim() ||
        !timeline.display.token.trim() ||
        !timeline.display.sceneId.trim() ||
        !Number.isSafeInteger(timeline.choreographyEpoch) ||
        timeline.choreographyEpoch < 1 ||
        (timeline.transitionFragmentKeys?.length ?? 0) > 128
      )
        throw new Error("Invalid choreography identity");
      if (
        timeline.questionToken !== `${timeline.sessionAttemptId}:question:${timeline.choreographyEpoch}` ||
        !timeline.display.token.startsWith(`${timeline.sessionAttemptId}:display:`) ||
        !SCENES.some(scene => scene.id === timeline.display.sceneId) ||
        timeline.transitionFragmentKeys?.some(key => !key.trim() || key.length > 120)
      )
        throw new Error("Invalid choreography question or display");
      nonnegative(timeline.display.displayedAtMs, "display.displayedAtMs");
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
      if (timeline.responseIdentity) {
        const identity = timeline.responseIdentity;
        if (
          !timeline.correlationKey?.trim() ||
          !timeline.answerVersion?.trim() ||
          !Number.isSafeInteger(timeline.transcriptRevision) ||
          (timeline.transcriptRevision ?? 0) < 1 ||
          timeline.sceneIndex === undefined ||
          identity.fragmentKeys.some(key => !key.trim()) ||
          new Set(identity.fragmentKeys).size !== identity.fragmentKeys.length ||
          (identity.sourceStatus === "known" &&
            (!Number.isSafeInteger(timeline.sourceId) || (timeline.sourceId ?? 0) < 1 || !identity.fragmentKeys.length))
        )
          throw new Error("Invalid evaluated response identity");
        if (identity.evaluatedScene) {
          if (!identity.evaluatedScene.sceneId.trim()) throw new Error("Evaluated scene identity is required");
          nonnegative(identity.evaluatedScene.displayedAtMs, "evaluatedScene.displayedAtMs");
        }
        const recognition = identity.recognitionContext;
        if (recognition) {
          if (
            recognition.recognition === "no_ambiguity_detected" &&
            (recognition.recovery !== "instructional_support" ||
              identity.sourceStatus !== "known" ||
              !identity.evaluatedScene)
          )
            throw new Error("Clear recognition requires complete response context");
          if (
            recognition.repeatedTotal !== undefined &&
            (!Number.isSafeInteger(recognition.repeatedTotal) ||
              recognition.repeatedTotal < 0 ||
              recognition.repeatedTotal > 99)
          )
            throw new Error("Invalid recognition confirmation total");
        }
      }
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

/** Server-capability-gated entry point uses this internal mutation to schedule analysis. */
export const scheduleObserver = internalMutation({
  args: { sessionId: v.id("sessions") },
  returns: v.string(),
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session || session.state !== "ended" || session.recordStatus === "pending" || !session.recording)
      throw new Error("Observer analysis requires an ended, assembled saved recording");
    const analysis = await ctx.db
      .query("observerAnalyses")
      .withIndex("by_session", q => q.eq("sessionId", sessionId))
      .unique();
    if (!analysis) {
      await ctx.db.insert("observerAnalyses", { sessionId, status: "pending", attempt: 0 });
      await ctx.scheduler.runAfter(
        0,
        makeFunctionReference("observer_action:analyze") as unknown as FunctionReference<"action", "internal">,
        { sessionId, expectedAttempt: 1 },
      );
      return "scheduled";
    }
    if (analysis.status === "ready") return analysis.status;
    if (analysis.status === "running" && (analysis.leaseUntil ?? 0) > Date.now()) return analysis.status;
    if (analysis.attempt >= 5 && analysis.status === "failed")
      throw new Error("Observer analysis has exhausted its five attempts");
    await ctx.scheduler.runAfter(
      0,
      makeFunctionReference("observer_action:analyze") as unknown as FunctionReference<"action", "internal">,
      { sessionId, expectedAttempt: analysis.attempt + 1 },
    );
    return "scheduled";
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
