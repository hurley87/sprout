import { v } from "convex/values";

export const responseIdentity = v.object({
  provenance: v.literal("application_evaluation"),
  fragmentKeys: v.array(v.string()),
  sourceStatus: v.union(v.literal("known"), v.literal("missing"), v.literal("mixed")),
  evaluatedScene: v.optional(v.object({ sceneId: v.string(), displayedAtMs: v.number() })),
  recognitionContext: v.optional(
    v.object({
      provenance: v.literal("application_text_policy"),
      recovery: v.union(v.literal("clarification"), v.literal("instructional_support")),
      recognition: v.union(v.literal("needs_confirmation"), v.literal("no_ambiguity_detected")),
      repeatedTotal: v.optional(v.number()),
    }),
  ),
});
