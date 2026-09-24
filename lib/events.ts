// The provider boundary. Raw data-channel JSON is validated once here so the
// rest of the app works with a closed union instead of unknown fields.

type Identified = { eventId?: string };

export type MicrophoneEvent =
  | { type: "microphone.activity_started" | "microphone.activity_discarded" | "microphone.speech_started" }
  | { type: "microphone.speech_stopped"; quietMs: number };

export type ProviderEvent =
  // Produced locally from the browser microphone, never parsed from the provider channel.
  | (Identified & MicrophoneEvent)
  | (Identified & { type: "session.started" })
  | (Identified & { type: "session.closed"; reason?: string; usage?: unknown })
  | (Identified & { type: "provider.error"; code?: string })
  | (Identified & { type: "transcript"; speaker: Speaker; delta: string; startMs: number; endMs: number })
  | (Identified & { type: "delegation.unexpected"; id: string; target?: string })
  | (Identified & { type: "context.appended"; name: string; clientEventId?: string; startMs?: number; endMs?: number })
  | (Identified & { type: "usage"; usage: unknown });

export type Speaker = "child" | "sprout";
export type TranscriptEvent = Extract<ProviderEvent, { type: "transcript" }>;

export type ClientCommand =
  | {
      type: "session.instructions.append";
      event_id: string;
      content: string;
      delegation_id: null;
    }
  | { type: "session.thinking.append"; event_id: string; content: string; delegation_id: string }
  | { type: "session.close"; event_id: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const text = (value: unknown) => (typeof value === "string" ? value : undefined);
const number = (value: unknown) => (typeof value === "number" ? value : undefined);

/** Returns null for events this app does not act on, including malformed ones. */
export function parseProviderEvent(raw: unknown): ProviderEvent | null {
  if (!isRecord(raw) || typeof raw.type !== "string") return null;
  const eventId = text(raw.event_id);
  switch (raw.type) {
    case "session.started":
      return { type: "session.started", eventId };
    case "session.closed":
      return { type: "session.closed", eventId, reason: text(raw.reason), usage: raw.usage };
    case "error":
      // Provider messages can carry sensitive context; keep only the code.
      return { type: "provider.error", eventId, code: isRecord(raw.error) ? text(raw.error.code) : undefined };
    case "session.input_transcript.delta":
    case "session.output_transcript.delta": {
      const delta = raw.delta;
      const startMs = raw.start_ms;
      const endMs = raw.end_ms;
      if (typeof delta !== "string" || typeof startMs !== "number" || typeof endMs !== "number") return null;
      const speaker: Speaker = raw.type === "session.input_transcript.delta" ? "child" : "sprout";
      return { type: "transcript", eventId, speaker, delta, startMs, endMs };
    }
    case "session.usage.updated":
      return { type: "usage", eventId, usage: raw.usage };
    case "session.delegation.created": {
      const delegation = raw.delegation;
      if (!isRecord(delegation) || typeof delegation.id !== "string" || delegation.id.length === 0) return null;
      return { type: "delegation.unexpected", eventId, id: delegation.id, target: text(delegation.target) };
    }
    default:
      if (!raw.type.endsWith(".appended")) return null;
      return {
        type: "context.appended",
        eventId,
        name: raw.type,
        clientEventId: text(raw.client_event_id),
        startMs: number(raw.start_ms),
        endMs: number(raw.end_ms),
      };
  }
}

export function parseSessionAnswer(raw: unknown): { sdp: string } | null {
  if (!isRecord(raw) || !isRecord(raw.transport) || typeof raw.transport.sdp !== "string") return null;
  return { sdp: raw.transport.sdp };
}
