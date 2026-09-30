import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const endingReason = v.union(
  v.literal("parent_stop"),
  v.literal("child_stop"),
  v.literal("model_goodbye"),
  v.literal("wrap_up"),
  v.literal("time_limit"),
  v.literal("connection_failure"),
  v.literal("page_hidden"),
);

export const evidence = v.union(
  v.object({
    type: v.literal("utterance"),
    speaker: v.union(v.literal("child_or_nearby_speaker"), v.literal("sprout"), v.literal("unknown")),
    text: v.string(),
    startMs: v.optional(v.number()),
    endMs: v.optional(v.number()),
    state: v.union(v.literal("finalized"), v.literal("interrupted")),
    firstObservedAtMs: v.optional(v.number()),
    lastObservedAtMs: v.optional(v.number()),
  }),
  v.object({
    type: v.literal("scene_displayed"),
    sceneId: v.string(),
    targetQuantity: v.number(),
    items: v.array(v.object({ emoji: v.string(), label: v.string() })),
    arrangement: v.string(),
  }),
  v.object({
    type: v.literal("support"),
    source: v.union(v.literal("sprout"), v.literal("parent"), v.literal("other")),
    mode: v.union(v.literal("spoken"), v.literal("displayed"), v.literal("other")),
    description: v.string(),
  }),
);

export const timeline = v.union(
  v.object({
    type: v.literal("sprout_generated_utterance"),
    speaker: v.literal("sprout"),
    text: v.string(),
    startMs: v.number(),
    endMs: v.number(),
    firstObservedAtMs: v.number(),
    lastObservedAtMs: v.number(),
    state: v.union(v.literal("finalized"), v.literal("interrupted")),
  }),
  v.object({ type: v.literal("microphone_speech_started") }),
  v.object({ type: v.literal("microphone_speech_stopped"), quietMs: v.number(), estimatedAcousticEndAtMs: v.number() }),
  v.object({
    type: v.literal("playback_gate_changed"),
    state: v.union(v.literal("blocked"), v.literal("permitted")),
    reason: v.string(),
  }),
  v.object({
    type: v.literal("answer_evaluation_requested"),
    correlationKey: v.string(),
    sceneIndex: v.number(),
    turnSignal: v.union(v.literal("microphone_vad"), v.literal("transcript_fallback")),
    turnEndToRequestMs: v.number(),
  }),
  v.object({
    type: v.literal("answer_evaluation_resolved"),
    correlationKey: v.string(),
    sceneIndex: v.number(),
    status: v.union(v.literal("evaluated"), v.literal("unavailable")),
    latencyMs: v.number(),
    probability: v.optional(v.number()),
    model: v.optional(v.string()),
    reason: v.optional(v.string()),
    decision: v.union(v.literal("STALE"), v.literal("UNAVAILABLE"), v.literal("ADVANCE"), v.literal("STAY")),
  }),
  v.object({
    type: v.literal("scene_advance_committed"),
    fromScene: v.number(),
    toScene: v.number(),
    correlationKey: v.string(),
  }),
  // Application control diagnostics remain separate from learner evidence.
  v.object({
    type: v.literal("evaluation_control"),
    action: v.string(),
    correlationKey: v.optional(v.string()),
    sceneIndex: v.optional(v.number()),
    transcriptRevision: v.optional(v.number()),
    answerVersion: v.optional(v.string()),
    sourceId: v.optional(v.number()),
    delegationId: v.optional(v.string()),
    offsetMs: v.optional(v.number()),
    origin: v.optional(v.union(v.literal("application"), v.literal("delegation"), v.literal("both"))),
    status: v.optional(
      v.union(v.literal("scheduled"), v.literal("in_flight"), v.literal("resolved"), v.literal("superseded")),
    ),
    displayStatus: v.optional(v.union(v.literal("not_applicable"), v.literal("waiting"), v.literal("confirmed"))),
    result: v.optional(v.union(v.literal("evaluated"), v.literal("unavailable"), v.literal("STALE"))),
    applicationAction: v.optional(
      v.union(v.literal("ADVANCE"), v.literal("STAY"), v.literal("UNAVAILABLE"), v.literal("SUPERSEDED")),
    ),
    contextEventId: v.optional(v.string()),
    ackState: v.optional(
      v.union(
        v.literal("estimated_injection"),
        v.literal("error"),
        v.literal("missing"),
        v.literal("duplicate"),
        v.literal("stale"),
      ),
    ),
    reason: v.optional(v.string()),
  }),
);

export default defineSchema({
  sessions: defineTable({
    state: v.union(v.literal("starting"), v.literal("active"), v.literal("ended")),
    recordStatus: v.union(v.literal("pending"), v.literal("complete"), v.literal("incomplete")),
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    endingReason: v.optional(endingReason),
    retryOf: v.optional(v.id("sessions")),
    nextEventOrder: v.number(),
    recording: v.optional(
      v.object({
        storageId: v.id("_storage"),
        mimeType: v.string(),
        startOffsetMs: v.number(),
        durationMs: v.number(),
      }),
    ),
  }),
  sessionEvents: defineTable({
    sessionId: v.id("sessions"),
    eventKey: v.string(),
    order: v.number(),
    atMs: v.number(),
    evidence: v.optional(evidence),
    timeline: v.optional(timeline),
  })
    .index("by_session_order", ["sessionId", "order"])
    .index("by_session_key", ["sessionId", "eventKey"]),
});
