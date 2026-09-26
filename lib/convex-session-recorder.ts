import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { Evidence, SessionRecorder, SessionAudioRecording } from "./session-recorder";
import type { EndReason } from "./session";

export class ConvexSessionRecorder implements SessionRecorder {
  private client?: ConvexHttpClient;
  private sessionId?: Id<"sessions">;
  async create() {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is missing; durable recording is unavailable");
    this.client = new ConvexHttpClient(url);
    this.sessionId = await this.client.mutation(api.sessions.create, {});
  }
  private get connection() {
    if (!this.client || !this.sessionId) throw new Error("No durable session was created");
    return { client: this.client, sessionId: this.sessionId };
  }
  async attachRecording(recording: SessionAudioRecording) {
    const { client, sessionId } = this.connection;
    const uploadUrl = await client.mutation(api.sessions.generateUploadUrl, { sessionId });
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": recording.mimeType },
      body: recording.blob,
    });
    if (!response.ok) throw new Error("Session audio upload failed");
    const result: unknown = await response.json();
    if (
      !result ||
      typeof result !== "object" ||
      !("storageId" in result) ||
      typeof result.storageId !== "string" ||
      !result.storageId.trim()
    )
      throw new Error("Audio upload returned an invalid storage ID");
    // Convex validates the ID and stored file before attaching it.
    await client.mutation(api.sessions.attachRecording, {
      sessionId,
      storageId: result.storageId as Id<"_storage">,
      mimeType: recording.mimeType,
      startOffsetMs: recording.startOffsetMs,
      durationMs: recording.durationMs,
    });
  }
  async activate() {
    const { client, sessionId } = this.connection;
    await client.mutation(api.sessions.activate, { sessionId });
  }
  async append(eventKey: string, atMs: number, evidence: Evidence) {
    const { client, sessionId } = this.connection;
    await client.mutation(api.sessions.appendEvent, { sessionId, eventKey, atMs, evidence });
  }
  async markIncomplete() {
    const { client, sessionId } = this.connection;
    await client.mutation(api.sessions.markIncomplete, { sessionId });
  }
  async finalize(endingReason: EndReason, recordIncomplete = false) {
    const { client, sessionId } = this.connection;
    await client.mutation(api.sessions.finalize, { sessionId, endingReason, recordIncomplete });
  }
}
