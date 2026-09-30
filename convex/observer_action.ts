"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { makeFunctionReference, type FunctionReference } from "convex/server";
import {
  analyzeSavedRecording,
  AUDIO_LIMIT_BYTES,
  createOpenAIObserverProvider,
  ObserverProviderError,
  PROVIDER_TIMEOUT_MS,
} from "../lib/observer-provider";
import type { Id } from "./_generated/dataModel";

export const analyze = internalAction({
  args: { sessionId: v.id("sessions"), expectedAttempt: v.optional(v.number()) },
  handler: async (ctx, { sessionId, expectedAttempt }): Promise<string> => {
    const now = Date.now();
    const claim = await ctx.runMutation(
      makeFunctionReference("observer:claim") as unknown as FunctionReference<"mutation", "internal">,
      { sessionId, now, expectedAttempt },
    );
    if (claim.status !== "claimed") return claim.status;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
      const snapshot = JSON.parse(claim.inputSnapshot) as {
        recording?: { storageId: Id<"_storage">; mimeType: string } | null;
      };
      const recording = snapshot.recording;
      if (!recording) throw new ObserverProviderError("Saved recording is unavailable.");
      const url = await ctx.storage.getUrl(recording.storageId);
      if (!url) throw new ObserverProviderError("Saved recording URL is unavailable.");
      const audioResponse = await fetch(url, { signal: controller.signal });
      if (!audioResponse.ok) throw new ObserverProviderError("Saved recording could not be retrieved.");
      const audio = await readAudio(audioResponse, recording.mimeType);
      const proposals = await analyzeSavedRecording({
        provider: createOpenAIObserverProvider(process.env.OPENAI_API_KEY),
        audio,
        mimeType: recording.mimeType,
        canonicalSnapshot: claim.inputSnapshot,
        signal: controller.signal,
      });
      await ctx.runMutation(
        makeFunctionReference("observer:publish") as unknown as FunctionReference<"mutation", "internal">,
        {
          analysisId: claim.analysisId,
          token: claim.token,
          proposals,
          now: Date.now(),
        },
      );
      return "complete";
    } catch (error) {
      const message = error instanceof Error ? error.message : "Observer analysis failed safely.";
      await ctx.runMutation(
        makeFunctionReference("observer:fail") as unknown as FunctionReference<"mutation", "internal">,
        {
          analysisId: claim.analysisId,
          token: claim.token,
          message: controller.signal.aborted
            ? "Observer provider timed out before the five-minute lease expired."
            : message,
          now: Date.now(),
        },
      );
      return "failed";
    } finally {
      clearTimeout(timeout);
    }
  },
});

async function readAudio(response: Response, mimeType: string): Promise<Blob> {
  const reader = response.body?.getReader();
  if (!reader) throw new ObserverProviderError("Saved recording body is empty.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > AUDIO_LIMIT_BYTES) {
      await reader.cancel();
      throw new ObserverProviderError("Saved recording exceeds the Observer audio size limit.");
    }
    chunks.push(value);
  }
  if (!size) throw new ObserverProviderError("Saved recording body is empty.");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Blob([bytes.buffer], { type: mimeType });
}
