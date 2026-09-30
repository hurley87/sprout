"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { validReviewCommand } from "../lib/parent-review";
import type { Id } from "./_generated/dataModel";

/** The server capability is validated at the public RPC boundary before any internal operation. */
export const request = action({
  args: { capability: v.string(), command: v.string() },
  returns: v.string(),
  handler: async (ctx, { capability, command }): Promise<string> => {
    const expected = process.env.OBSERVER_SERVER_CAPABILITY;
    if (!expected || capability !== expected) throw new Error("Review server authorization failed");
    if (Buffer.byteLength(command) > 16_384) throw new Error("Invalid review request");
    const input: unknown = JSON.parse(command);
    if (!validReviewCommand(input)) throw new Error("Invalid review request");
    const sessionId = input.sessionId as Id<"sessions">;
    if (input.operation === "get") return ctx.runQuery(internal.parent_review.inspect, { sessionId });
    const scope = { sessionId, analysisId: input.analysisId as Id<"observerAnalyses"> };
    if (input.operation === "decide") {
      await ctx.runMutation(internal.parent_review.decide, {
        ...scope,
        proposalRowId: input.proposalRowId as Id<"observerProposals">,
        decision: input.decision,
      });
    } else {
      const metadata = {
        ...(input.note === undefined ? {} : { note: input.note }),
        ...(input.acknowledgeEmpty === undefined ? {} : { acknowledgeEmpty: input.acknowledgeEmpty }),
      };
      if (input.operation === "acceptAll")
        await ctx.runMutation(internal.parent_review.acceptAll, { ...scope, ...metadata });
      else
        await ctx.runMutation(internal.parent_review.complete, {
          ...scope,
          ...metadata,
          repairLevel: input.repairLevel!,
        });
    }
    return "saved";
  },
});
