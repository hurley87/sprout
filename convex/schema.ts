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

export default defineSchema({
  sessions: defineTable({
    state: v.union(v.literal("starting"), v.literal("active"), v.literal("ended")),
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
        startedAt: v.number(),
        durationMs: v.number(),
      }),
    ),
  }),
  sessionEvents: defineTable({
    sessionId: v.id("sessions"),
    eventKey: v.string(),
    order: v.number(),
    atMs: v.number(),
    evidence,
  })
    .index("by_session_order", ["sessionId", "order"])
    .index("by_session_key", ["sessionId", "eventKey"]),
});
