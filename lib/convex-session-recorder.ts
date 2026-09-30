import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type {
  Evidence,
  TimelineEvent,
  SessionRecorder,
  SessionAudioRecording,
  DurableSessionRef,
  SessionRecordReader,
  InspectableSessionRecord,
} from "./session-recorder";
import type { EndReason } from "./session";

export class ConvexSessionRecorder implements SessionRecorder, SessionRecordReader {
  private client?: ConvexHttpClient;
  private sessionId?: Id<"sessions">;
  async create(retryOf?: DurableSessionRef) {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is missing; durable recording is unavailable");
    this.client = new ConvexHttpClient(url);
    this.sessionId = await this.client.mutation(
      api.sessions.create,
      retryOf ? { retryOf: retryOf as Id<"sessions"> } : {},
    );
    return this.sessionId;
  }
  async getRecord(ref: DurableSessionRef): Promise<InspectableSessionRecord | null> {
    const { client } = this.connection;
    const record = await client.query(api.sessions.getRecord, { sessionId: ref as Id<"sessions"> });
    if (!record) return null;
    const { session, events, recordingUrl } = record;
    return {
      id: session._id,
      state: session.state,
      recordStatus: session.recordStatus,
      createdAt: session.createdAt,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      endingReason: session.endingReason,
      retryOf: session.retryOf,
      recording:
        session.recording && recordingUrl
          ? {
              // One immutable recording is attached per session; this opaque identity avoids exposing the storage ID.
              recordingId: `${session._id}:recording`,
              url: recordingUrl,
              mimeType: session.recording.mimeType,
              startOffsetMs: session.recording.startOffsetMs,
              durationMs: session.recording.durationMs,
            }
          : undefined,
      events: events.map(({ eventKey, order, atMs, evidence, timeline }) => ({
        eventKey,
        order,
        atMs,
        evidence,
        timeline,
      })),
    };
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
    // Audio is durable now. Notify the loopback server to initiate analysis; failure leaves
    // the saved record available for the parent's explicit retry path.
    try {
      await fetch("/api/observer/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
    } catch {
      // Provider work is recoverable from this durable attachment through the retry route.
    }
  }
  async activate(startedAt?: number) {
    const { client, sessionId } = this.connection;
    await client.mutation(api.sessions.activate, { sessionId, ...(startedAt === undefined ? {} : { startedAt }) });
  }
  async append(eventKey: string, atMs: number, evidence: Evidence) {
    const { client, sessionId } = this.connection;
    await client.mutation(api.sessions.appendEvent, { sessionId, eventKey, atMs, evidence });
  }
  async appendTimeline(eventKey: string, atMs: number, timeline: TimelineEvent) {
    const { client, sessionId } = this.connection;
    await client.mutation(api.sessions.appendEvent, { sessionId, eventKey, atMs, timeline });
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
