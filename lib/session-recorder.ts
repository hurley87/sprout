import type { EndReason } from "./session";

export type Evidence =
  | {
      type: "utterance";
      speaker: "child_or_nearby_speaker" | "sprout" | "unknown";
      text: string;
      startMs?: number;
      endMs?: number;
      state: "finalized" | "interrupted";
    }
  | {
      type: "scene_displayed";
      sceneId: string;
      targetQuantity: number;
      items: { emoji: string; label: string }[];
      arrangement: string;
    }
  | {
      type: "support";
      source: "sprout" | "parent" | "other";
      mode: "spoken" | "displayed" | "other";
      description: string;
    };

export type SessionAudioRecording = {
  blob: Blob;
  mimeType: string;
  /** Offset from provider session.started, never a Unix timestamp. */
  startOffsetMs: number;
  durationMs: number;
};

export type DurableSessionRef = string;

export type InspectableSessionRecord = {
  id: DurableSessionRef;
  state: "starting" | "active" | "ended";
  recordStatus: "pending" | "complete" | "incomplete";
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  endingReason?: EndReason;
  retryOf?: DurableSessionRef;
  recording?: { url: string; mimeType: string; startOffsetMs: number; durationMs: number };
  events: { eventKey: string; order: number; atMs: number; evidence: Evidence }[];
};

export interface SessionRecordReader {
  getRecord(ref: DurableSessionRef): Promise<InspectableSessionRecord | null>;
}

/** Canonical zero is session.started, not attempt creation. */
export function recordingOffsetSeconds(atMs: number, recording: { startOffsetMs: number; durationMs: number }) {
  return Math.max(0, Math.min(recording.durationMs, atMs - recording.startOffsetMs)) / 1000;
}

/** Application evidence only; never accepts diagnostic/provider payloads. */
export interface SessionRecorder {
  attachRecording(recording: SessionAudioRecording): Promise<void>;
  create(retryOf?: DurableSessionRef): Promise<DurableSessionRef>;
  activate(): Promise<void>;
  append(eventKey: string, atMs: number, evidence: Evidence): Promise<void>;
  markIncomplete(): Promise<void>;
  finalize(reason: EndReason, recordIncomplete?: boolean): Promise<void>;
}

/** Failed writes are reported; subsequent writes (especially finalization) still run. */
export class RecordingQueue {
  private tail = Promise.resolve();
  private created = false;
  private recordIncomplete = false;
  get incomplete() {
    return this.recordIncomplete;
  }
  constructor(
    private report: (operation: string, error: unknown) => void,
    private markIncomplete?: () => Promise<void>,
  ) {}
  enqueue(operation: string, write: () => Promise<void>) {
    this.tail = this.tail.then(async () => {
      try {
        await write();
        if (operation === "create") this.created = true;
      } catch (error) {
        this.report(operation, error);
        if (!this.created) return;
        this.recordIncomplete = true;
        // Recovery is awaited inside this queue slot, before subsequent writes.
        try {
          await this.markIncomplete?.();
        } catch (markerError) {
          this.report("markIncomplete", markerError);
        }
      }
    });
  }
  drain() {
    return this.tail;
  }
}
