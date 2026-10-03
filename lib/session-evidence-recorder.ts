import type { TranscriptEvent } from "./events";
import { sourceTimelineBound } from "./evidence-timing";
import {
  RecordingQueue,
  type SessionRecorder,
  type Evidence,
  type TimelineEvent,
  type EndReason,
} from "./session-recorder";
import { UtteranceAccumulator, UTTERANCE_GAP_MS } from "./transcript";
import type { BrowserTransport } from "./browser-transport";

/** Recording primitive extracted from the retired lesson controller. Callers supply
 * actual displayed evidence and recognition; this class makes no lesson decisions. */
export class SessionEvidenceRecorder {
  private canonicalClockOrigin?: number;
  private ready = false;
  private ended = false;
  private evidenceOrder = 0;
  private timelineOrder = 0;
  private fragmentOrder = 0;
  private inputBound?: { sourceId: number; startMs: number; inputScene: { sceneId: string; displayedAtMs: number } };
  private displayedContext?: { sceneId: string; displayedAtMs: number };
  private canonical = { child: new UtteranceAccumulator(), sprout: new UtteranceAccumulator() };
  private utteranceTimers: Partial<Record<"child" | "sprout", ReturnType<typeof setTimeout>>> = {};
  private recording: RecordingQueue;
  constructor(
    private transport: Pick<BrowserTransport, "openInput" | "startRecording" | "stopMedia" | "recording"> & {
      delivered?: (startMs: number, endMs: number) => boolean;
    },
    private recorder: SessionRecorder,
    report: (operation: string, error: unknown) => void,
  ) {
    this.recording = new RecordingQueue(report, () => recorder.markIncomplete());
  }
  create() {
    this.recording.enqueue("create", async () => {
      await this.recorder.create();
    });
  }
  begin() {
    if (this.ready || this.ended) return;
    this.canonicalClockOrigin = performance.now();
    this.ready = true;
    this.recording.enqueue("activate", () => this.recorder.activate(Date.now()));
    try {
      this.transport.startRecording(this.canonicalClockOrigin);
    } catch (error) {
      this.recording.enqueue("capture", async () => {
        throw error;
      });
    }
  }
  displayed(evidence: Extract<Evidence, { type: "scene_displayed" }>) {
    if (!this.ready || this.ended) return;
    this.displayedContext = { sceneId: evidence.sceneId, displayedAtMs: this.sessionAtMs() };
    this.record(evidence);
    this.transport.openInput(sourceId => {
      this.inputBound = { sourceId, startMs: this.sessionAtMs(), inputScene: { ...this.displayedContext! } };
    });
  }
  receive(event: TranscriptEvent) {
    if (!this.ready || this.ended) return;
    this.captureTranscript(event, `transcript_${++this.fragmentOrder}`);
  }
  /** Supply independently established recognition, never infer it from a Jev probability. */
  retainRecognition(
    response: Parameters<UtteranceAccumulator["retainRecognition"]>[0],
    recognition: Parameters<UtteranceAccumulator["retainRecognition"]>[1],
  ) {
    return this.canonical.child.retainRecognition(response, recognition);
  }
  recordingSettled() {
    return this.recording.drain();
  }
  private sessionAtMs() {
    return this.canonicalClockOrigin === undefined
      ? 0
      : Math.max(0, Math.floor(performance.now() - this.canonicalClockOrigin));
  }
  private record(evidence: Evidence, atMs = this.sessionAtMs()) {
    const eventKey = `evidence_${++this.evidenceOrder}`;
    this.recording.enqueue("append", () => this.recorder.append(eventKey, atMs, evidence));
  }
  private timeline(event: TimelineEvent, atMs = this.sessionAtMs()) {
    const eventKey = `timeline_${++this.timelineOrder}`;
    this.recording.enqueue("appendTimeline", () => this.recorder.appendTimeline(eventKey, atMs, event));
  }
  private flushUtterance(
    speaker: "child" | "sprout",
    state: "finalized" | "interrupted",
    utterance = this.canonical[speaker].take(),
  ) {
    if (!utterance?.text.trim()) return;
    if (speaker === "sprout") {
      this.timeline(
        {
          type: "sprout_generated_utterance",
          speaker: "sprout",
          text: utterance.text,
          startMs: utterance.startMs,
          endMs: utterance.endMs,
          firstObservedAtMs: utterance.firstObservedAtMs,
          lastObservedAtMs: utterance.lastObservedAtMs,
          state,
        },
        utterance.firstObservedAtMs,
      );
    }
    if (!utterance.delivered) return;
    this.record({
      type: "utterance",
      speaker: speaker === "child" ? "child_or_nearby_speaker" : "sprout",
      text: utterance.text,
      startMs: utterance.startMs,
      endMs: utterance.endMs,
      state,
      ...utterance.context,
      ...(speaker === "child" && utterance.transcriptFragments
        ? { transcriptFragments: utterance.transcriptFragments }
        : {}),
      ...(speaker === "child"
        ? ({
            recognition: utterance.context?.recognition ?? "needs_confirmation",
          } as const)
        : {}),
      firstObservedAtMs: utterance.firstObservedAtMs,
      lastObservedAtMs: utterance.lastObservedAtMs,
    });
  }

  private captureTranscript(event: TranscriptEvent, fragmentKey?: string) {
    if (!this.ready) return;
    // A transcript from either speaker ends the other speaker's canonical turn,
    // even when the incoming Sprout speech cannot be recorded as delivered.
    const priorSpeaker = event.speaker === "child" ? "sprout" : "child";
    clearTimeout(this.utteranceTimers[priorSpeaker]);
    delete this.utteranceTimers[priorSpeaker];
    this.flushUtterance(priorSpeaker, "finalized");
    const delivered = event.speaker === "child" || this.transport.delivered?.(event.startMs, event.endMs) === true;
    const sessionTiming =
      event.speaker === "child" && this.inputBound && event.sourceId === this.inputBound.sourceId
        ? event.sourceRequestedAt === undefined
          ? {
              clock: "session" as const,
              provenance: "source_input_bound" as const,
              ...this.inputBound,
              endMs: Math.ceil(performance.now() - this.canonicalClockOrigin!),
            }
          : sourceTimelineBound(
              event,
              event.sourceRequestedAt - this.canonicalClockOrigin!,
              this.inputBound.startMs,
              this.inputBound.inputScene,
              Math.ceil(performance.now() - this.canonicalClockOrigin!),
            )
        : undefined;
    const completed = this.canonical[event.speaker].append(
      event.delta,
      event.startMs,
      event.endMs,
      delivered,
      this.sessionAtMs(),
      {
        ...(event.speaker === "child" ? { recognition: "needs_confirmation" as const } : {}),
        ...(sessionTiming ? { sessionTiming } : {}),
        providerTiming: {
          clock: "provider",
          startMs: event.startMs,
          endMs: event.endMs,
          ...(event.sourceId === undefined ? {} : { sourceId: event.sourceId }),
        },
        ...(this.displayedContext
          ? {
              responseScene: {
                provenance: "application_transcript_context",
                ...this.displayedContext,
                status: "stable",
              } as const,
            }
          : {}),
      },
      fragmentKey,
    );
    if (completed) this.flushUtterance(event.speaker, "finalized", completed);
    clearTimeout(this.utteranceTimers[event.speaker]);
    this.utteranceTimers[event.speaker] = setTimeout(
      () => this.flushUtterance(event.speaker, "finalized"),
      UTTERANCE_GAP_MS,
    );
  }

  end(reason: EndReason) {
    if (this.ended) return;
    this.ended = true;
    this.transport.stopMedia();
    for (const speaker of ["child", "sprout"] as const) {
      clearTimeout(this.utteranceTimers[speaker]);
      this.flushUtterance(speaker, "interrupted");
    }
    if (!this.ready)
      this.recording.enqueue("capture", async () => {
        throw new Error("Attempt ended before live audio capture");
      });
    this.recording.enqueue("finalize", () => this.recorder.finalize(reason, this.recording.incomplete));
    this.recording.enqueue("attachRecording", async () => {
      const audio = await this.transport.recording();
      if (!audio) throw new Error("No usable full-session audio recording");
      await this.recorder.attachRecording(audio);
    });
  }
}
