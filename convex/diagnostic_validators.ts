import { v } from "convex/values";

export const diagnosticRow = v.union(
  v.object({
    kind: v.literal("response"),
    eventId: v.string(),
    atMs: v.number(),
    coverage: v.union(v.literal("returned"), v.literal("absent"), v.literal("unknown")),
    omissionCause: v.union(v.literal("unknown"), v.null()),
    returnedCount: v.number(),
    rejectedCount: v.number(),
    proposalOrdinals: v.array(v.number()),
    fragmentKeys: v.array(v.string()),
    evaluationEventIds: v.array(v.string()),
    traceTruncated: v.boolean(),
    speaker: v.union(v.literal("child_or_nearby_speaker"), v.literal("unknown")),
    state: v.union(v.literal("finalized"), v.literal("interrupted")),
    trustedTiming: v.boolean(),
  }),
  v.object({
    kind: v.literal("proposal"),
    ordinal: v.number(),
    proposalId: v.union(v.string(), v.null()),
    status: v.union(v.literal("valid"), v.literal("rejected")),
    responseEventIds: v.array(v.string()),
    responseCount: v.number(),
    issues: v.array(v.object({ path: v.string(), message: v.string() })),
    issueCount: v.number(),
    traceTruncated: v.boolean(),
    timestampRepaired: v.boolean(),
  }),
);

export const failureStage = v.union(
  v.literal("recording"),
  v.literal("provider_setup"),
  v.literal("transcription"),
  v.literal("proposal"),
  v.literal("provider_validation"),
  v.literal("publication"),
);
export const diagnosticSummary = v.object({
  version: v.literal(1),
  outputState: v.union(v.literal("usable"), v.literal("unavailable"), v.literal("invalid_batch")),
  boundary: v.union(v.literal("provider_validation"), v.literal("publication"), v.literal("before_output")),
  failureStage: v.union(failureStage, v.null()),
  returnedProposalCount: v.union(v.number(), v.null()),
  rejectedProposalCount: v.number(),
  responseCount: v.number(),
  sceneEventCount: v.number(),
  absentResponseCount: v.union(v.number(), v.null()),
  batchIssue: v.union(v.object({ path: v.string(), message: v.string() }), v.null()),
});
export const diagnostics = diagnosticSummary.extend({ rows: v.array(diagnosticRow) });
