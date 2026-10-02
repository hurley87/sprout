import type { EndReason } from "./session";

/** Target-independent text policy, not ASR or evaluator confidence. */
export type ResponseRecognitionContext = {
  provenance: "application_text_policy";
  recovery: "clarification" | "instructional_support";
  recognition: "needs_confirmation" | "no_ambiguity_detected";
  /** Corroborating text released before this response, never proof of recognition. */
  repeatedTotal?: number;
};

/** A join to canonical transcript fragments, never an acoustic scene assertion. */
export type EvaluatedResponseIdentity = {
  provenance: "application_evaluation";
  /** One answer window can include fragments from several canonical utterances. */
  fragmentKeys: string[];
  /** Missing includes contributors without canonical fragment or provider identity. */
  sourceStatus: "known" | "missing" | "mixed";
  /** The confirmed display evaluated by the app, independent of speech timing. */
  evaluatedScene?: { sceneId: string; displayedAtMs: number };
  /** Frozen for this evaluation revision, including superseded results. */
  recognitionContext?: ResponseRecognitionContext;
};

export type Evidence =
  | {
      type: "utterance";
      speaker: "child_or_nearby_speaker" | "sprout" | "unknown";
      text: string;
      /** Legacy/provider offsets. Never compare with application atMs without an explicit mapping. */
      startMs?: number;
      endMs?: number;
      state: "finalized" | "interrupted";
      firstObservedAtMs?: number;
      lastObservedAtMs?: number;
      /** Immutable fragment joins to evaluation_control.responseIdentity. No evaluation is implied. */
      transcriptFragments?: { key: string; textStart: number; textEnd: number }[];
      providerTiming?: { clock: "provider"; startMs: number; endMs: number; sourceId?: number };
      /** Mapped speech, or a conservative envelope of source input through transcript receipt. */
      sessionTiming?:
        | { clock: "session"; provenance: "mapped_provider"; startMs: number; endMs: number }
        | {
            clock: "session";
            provenance: "source_input_bound";
            startMs: number;
            endMs: number;
            sourceId: number;
            inputScene: { sceneId: string; displayedAtMs: number };
          }
        | {
            clock: "session";
            provenance: "source_timeline_bound";
            startMs: number;
            endMs: number;
            sourceId: number;
            /** Source creation cannot precede its browser request. May predate canonical zero. */
            sourceRequestedAtMs: number;
            inputOpenedAtMs: number;
            inputScene: { sceneId: string; displayedAtMs: number };
          };
      responseScene?: {
        provenance: "application_transcript_context";
        sceneId: string;
        displayedAtMs: number;
        status: "stable" | "changed";
      };
      recognition?: "needs_confirmation" | "no_ambiguity_detected";
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

/** Provider generation and application control facts, never learner evidence. */
export type TimelineEvent =
  | {
      type: "sprout_generated_utterance";
      speaker: "sprout";
      text: string;
      startMs: number;
      endMs: number;
      firstObservedAtMs: number;
      lastObservedAtMs: number;
      state: "finalized" | "interrupted";
    }
  | { type: "microphone_speech_started" }
  | { type: "microphone_speech_stopped"; quietMs: number; estimatedAcousticEndAtMs: number }
  | { type: "playback_gate_changed"; state: "blocked" | "permitted"; reason: string }
  | {
      type: "answer_evaluation_requested";
      correlationKey: string;
      sceneIndex: number;
      turnSignal: "microphone_vad" | "transcript_fallback";
      turnEndToRequestMs: number;
    }
  | {
      type: "answer_evaluation_resolved";
      correlationKey: string;
      sceneIndex: number;
      status: "evaluated" | "unavailable";
      latencyMs: number;
      probability?: number;
      model?: string;
      reason?: string;
      decision: "STALE" | "UNAVAILABLE" | "ADVANCE" | "STAY";
    }
  | { type: "scene_advance_committed"; fromScene: number; toScene: number; correlationKey: string }
  | {
      type: "evaluation_control";
      action: string;
      correlationKey?: string;
      sceneIndex?: number;
      transcriptRevision?: number;
      answerVersion?: string;
      sourceId?: number;
      responseIdentity?: EvaluatedResponseIdentity;
      delegationId?: string;
      offsetMs?: number;
      origin?: "application" | "delegation" | "both";
      status?: "scheduled" | "in_flight" | "resolved" | "superseded";
      displayStatus?: "not_applicable" | "waiting" | "confirmed";
      result?: "evaluated" | "unavailable" | "STALE";
      applicationAction?: "ADVANCE" | "STAY" | "UNAVAILABLE" | "SUPERSEDED";
      contextEventId?: string;
      ackState?: "estimated_injection" | "error" | "missing" | "duplicate" | "stale";
      reason?: string;
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
  recording?: {
    recordingId: string;
    url: string;
    mimeType: string;
    startOffsetMs: number;
    durationMs: number;
  };
  events: {
    /** Canonical identity for diagnostic joins; older readers may omit it. Never substitute an event key. */
    id?: string;
    eventKey: string;
    order: number;
    atMs: number;
    evidence?: Evidence;
    timeline?: TimelineEvent;
  }[];
};

export interface SessionRecordReader {
  getRecord(ref: DurableSessionRef): Promise<InspectableSessionRecord | null>;
}

/** Canonical zero is session.started, not attempt creation. */
export function recordingOffsetSeconds(atMs: number, recording: { startOffsetMs: number; durationMs: number }) {
  return Math.max(0, Math.min(recording.durationMs, atMs - recording.startOffsetMs)) / 1000;
}

/** Separate evidence and bounded analysis timeline writes. */
export interface SessionRecorder {
  attachRecording(recording: SessionAudioRecording): Promise<void>;
  create(retryOf?: DurableSessionRef): Promise<DurableSessionRef>;
  activate(startedAt?: number): Promise<void>;
  append(eventKey: string, atMs: number, evidence: Evidence): Promise<void>;
  appendTimeline(eventKey: string, atMs: number, timeline: TimelineEvent): Promise<void>;
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
