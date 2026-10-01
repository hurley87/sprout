import {
  RecordingQueue,
  type SessionRecorder,
  type DurableSessionRef,
  type Evidence,
  type TimelineEvent,
  type SessionAudioRecording,
} from "./session-recorder";
import {
  CORRECTION_WINDOW_MS,
  EVALUATION_TIMEOUT_MS,
  MICROPHONE_QUIET_MS,
  TRANSCRIPT_FALLBACK_MS,
  TRANSCRIPT_TAIL_MS,
  shouldAdvance,
  type AnswerResult,
  type EvaluateAnswer,
} from "./answer";
import type { ClientCommand, ProviderEvent, TranscriptEvent } from "./events";
import type { MicrophoneDiagnostic } from "./browser-transport";
import { startupTiming, type StartupStage } from "./startup-diagnostics";

import {
  LAST_SCENE,
  OBJECTS,
  MODEL,
  PROMPT_VERSION,
  TIMING,
  type ReplacementSeed,
  evaluationResultContext,
  objectName,
  sceneAt,
  sceneContext,
} from "./lesson";
import {
  TranscriptWindow,
  UtteranceAccumulator,
  UTTERANCE_GAP_MS,
  mentionsNumber,
  requestsStop,
  saidGoodbye,
  type Utterance,
} from "./transcript";

// Recovery budget, not a silence/completion threshold. On expiry stop media;
// never open playback to recover a stalled gate. Revisions cannot renew it.
export const RESPONSE_GATE_RECOVERY_MS = 15_000;
// Fallback for transports that cannot discard output: wait a full normal
// transcript gap with ONLY provider output blocking before replacing a source.
export const STALE_OUTPUT_REPLACEMENT_MS = 2_500;
const MAX_DELEGATION_HANDLES = 128;
// A provider offset farther than this from the matched answer is too weak a
// basis for task attribution, even when no newer transcript has arrived.
const DELEGATION_ASSOCIATION_MAX_AGE_MS = 30_000;

export type EndReason =
  "parent_stop" | "child_stop" | "model_goodbye" | "wrap_up" | "time_limit" | "connection_failure" | "page_hidden";

// Only an ending the app chose, on a session that reached the provider, asks
// for finalization. A broken or expired session releases immediately.
const GRACEFUL_CLOSE: Record<EndReason, boolean> = {
  parent_stop: true,
  child_stop: true,
  model_goodbye: true,
  wrap_up: true,
  time_limit: false,
  connection_failure: false,
  page_hidden: false,
};

export type Snapshot = {
  status: "starting" | "active" | "wrapping" | "goodbye" | "ended";
  sceneIndex: number;
  reason?: EndReason;
  error?: string;
  recordingError?: string;
  durableSessionRef?: DurableSessionRef;
};
export type Diagnostic = { at: number; type: string; detail?: unknown };

export interface Transport {
  setStartupDiagnosticSink?(sink: (stage: StartupStage) => void): void;
  setMicrophoneDiagnosticSink?(sink: (event: MicrophoneDiagnostic) => void): void;
  start(onEvent: (event: ProviderEvent) => void, onFailure: (message: string) => void): Promise<void>;
  startRecording?(): void;
  recording?(): Promise<SessionAudioRecording | null>;
  send(command: ClientCommand): void;
  /** Silence provider audio without stopping playback or provider events. */
  setOutputBlocked(blocked: boolean): void;
  /** Permanently isolate current output, retaining child input until replacement. */
  discardOutput?(): boolean;
  /** True only with a trustworthy delivery attribution for this transcript interval. */
  delivered?(startMs: number, endMs: number): boolean;
  prepareReplacement?(seed: ReplacementSeed, signal: AbortSignal): Promise<number>;
  activateSource?(id: number): boolean;
  retireSource?(id: number): void;
  readonly activeSourceId?: number;
  stopMedia(): void;
  close(): void;
}

/** What the app is waiting to see on screen before it speaks about it. */
type PendingDisplay = {
  kind: "greeting" | "advance";
  sceneIndex: number;
  answerVersion?: string;
  turnEndAt?: number;
  gateIdentity?: GateIdentity;
};
type GateIdentity = { sceneIndex: number; transcriptRevision: number; answerVersion: string };
type EvaluationRecord = GateIdentity & {
  key: string;
  utterance: string;
  sourceId?: number;
  status: "scheduled" | "in_flight" | "resolved" | "superseded";
  result?: AnswerResult;
  applicationAction?: "ADVANCE" | "STAY" | "UNAVAILABLE" | "SUPERSEDED";
  displayStatus: "not_applicable" | "waiting" | "confirmed";
  displayedSceneIndex?: number;
  applicationFeedbackSent: boolean;
  delegationIds: Set<string>;
  linkedResultsSent: Set<string>;
  origin: "application" | "delegation" | "both";
};
type DelegationHandle = { id: string; sourceId: number; offsetMs: number; recordKey?: string };
type ChildTranscriptHistoryEntry = {
  sceneIndex: number;
  transcriptRevision: number;
  answerVersion: string;
  startMs: number;
  endMs: number;
  sourceId?: number;
  answerBearing: boolean;
};
type GateDecision = "ADVANCE" | "STAY" | "UNAVAILABLE";
type DeferredAdvance = {
  sceneIndex: number;
  answerVersion: string;
  evaluatedAnswer: string;
  approvedAt: number;
  spokenChars: number;
  transcriptRevision: number;
  correctionReadyAt: number;
  vadGraceUntil?: number;
};
type DeferredStay = {
  sceneIndex: number;
  answerVersion: string;
  evaluatedAnswer: string;
  transcriptRevision: number;
  correctionReadyAt: number;
  decision: "STAY" | "UNAVAILABLE";
  vadGraceUntil?: number;
};
type AnswerResponseGate = {
  sceneIndex: number;
  transcriptRevision: number;
  answerVersion: string;
  startedAt: number;
  outputQuietAt: number;
  childUtterance: string;
  outputDiscarded?: boolean;
  outputDiscarding?: boolean;
  discardedSourceId?: number;
  outputQuietBlockedRelease?: boolean;
  replacementAttempted?: boolean;
  /** The stale A source may be permitted only by an explicit safe release. */
  sourceIsolationRequired?: boolean;
  sourceIsolationRequiredAt?: number;
  eligibleAt?: number;
  decision?: GateDecision;
  sceneCommittedAt?: number;
  sceneDisplayedAt?: number;
  evaluationTimedOutAt?: number;
};

export class LessonSession {
  snapshot: Snapshot = { status: "starting", sceneIndex: 0 };
  readonly events: Diagnostic[] = [];
  readonly createdAt = Date.now();
  startedAt?: number;
  private startupTimer?: ReturnType<typeof setTimeout>;
  private phaseTimers: ReturnType<typeof setTimeout>[] = [];
  private closeTimer?: ReturnType<typeof setTimeout>;
  private settleTimer?: ReturnType<typeof setTimeout>;
  private deferredTimer?: ReturnType<typeof setTimeout>;
  private deferredAdvance: DeferredAdvance | null = null;
  private stayTimer?: ReturnType<typeof setTimeout>;
  private displayedReleaseTimer?: ReturnType<typeof setTimeout>;
  private displayedRelease: { gateIdentity: GateIdentity; sceneIndex: number; displayedAt: number } | null = null;
  private deferredStay: DeferredStay | null = null;
  private seen = new Set<string>();
  private delegations = new Map<string, DelegationHandle>();
  private evaluationRecords = new Map<string, EvaluationRecord>();
  private contextCommands = new Map<string, { sourceId?: number; recordKey?: string; delegationId: string | null }>();
  private acknowledgedContextCommands = new Set<string>();
  private missingContextCommands = new Set<string>();
  private pending: PendingDisplay | null = null;
  private childSpeech = new TranscriptWindow();
  private sproutSpeech = new TranscriptWindow();
  // The last thing the child was heard saying, and the utterance versions
  // already sent for evaluation, so one response is never judged twice.
  private latest: Utterance | null = null;
  private lastDeltaAt = 0;
  private turnEndAt = 0;
  private vadDetectionMs?: number;
  private turnSignal: "microphone_vad" | "transcript_fallback" = "transcript_fallback";
  private microphoneSpeaking = false;
  private microphoneSpeechStartedAt?: number;
  private provisionalActivity = false;
  private speechEpoch = 0;
  private transcriptEpoch = -1;
  private transcriptRevision = 0;
  private latestSourceId?: number;
  private childTranscriptHistory: ChildTranscriptHistoryEntry[] = [];
  private scheduledEvaluation?: { sceneIndex: number; revision: number; version: string; path: string };
  private activityTranscriptRevision = 0;
  private noTranscriptTimer?: ReturnType<typeof setTimeout>;
  private evaluated = new Set<string>();
  private evaluation?: AbortController;
  // Count provider transcript characters for diagnostics only; this is never
  // used to decide whether a current answer result may release the gate.
  private sproutReply = "";
  // Application state is authoritative; provider transcript events continue
  // while playback is muted and do not imply the child heard Sprout.
  private answerResponseGate: AnswerResponseGate | null = null;
  private replacementTimer?: ReturnType<typeof setTimeout>;
  private providerOnlySince?: number;
  private replacement: { gate: AnswerResponseGate; abort: AbortController; startedAt: number; id?: number } | null =
    null;
  private responseGateRecoveryTimer?: ReturnType<typeof setTimeout>;
  private outputActivity: "active" | "quiet" | "unavailable" = "unavailable";
  private lastSproutDeltaAt?: number;
  private commands = 0;
  private closed = false;
  private ending = false;
  private ready = false;
  private startupStages = new Set<StartupStage>();
  private startupEvents: Diagnostic[] = [];
  private initialInstruction?: string;
  private initialSceneDisplayed = false;
  private recordingStarted = false;
  private evidenceOrder = 0;
  private timelineOrder = 0;
  private canonical = { child: new UtteranceAccumulator(), sprout: new UtteranceAccumulator() };
  private utteranceTimers: Partial<Record<"child" | "sprout", ReturnType<typeof setTimeout>>> = {};
  private recording = new RecordingQueue(
    (operation, error) => {
      this.log("recording.failed", { operation, message: error instanceof Error ? error.message : "Recording failed" });
      this.update({ recordingError: "Durable recording is incomplete or unavailable. The lesson can continue." });
    },
    () => this.recorder!.markIncomplete(),
  );

  recordingSettled() {
    return this.recording.drain();
  }

  private record(evidence: Evidence) {
    if (!this.recorder) return;
    if (this.startedAt === undefined) throw new Error("Canonical evidence requires a live session start");
    const eventKey = `evidence_${++this.evidenceOrder}`;
    // Canonical evidence shares the provider session.started origin with audio.
    const atMs = Date.now() - this.startedAt;
    this.recording.enqueue("append", () => this.recorder!.append(eventKey, atMs, evidence));
  }

  private timeline(event: TimelineEvent, atMs = this.startedAt === undefined ? 0 : Date.now() - this.startedAt) {
    if (!this.recorder || this.startedAt === undefined || this.snapshot.status === "ended") return;
    const eventKey = `timeline_${++this.timelineOrder}`;
    this.recording.enqueue("appendTimeline", () => this.recorder!.appendTimeline(eventKey, atMs, event));
  }

  private evaluationControl(
    record: EvaluationRecord | undefined,
    action: string,
    fields: Partial<Extract<TimelineEvent, { type: "evaluation_control" }>> = {},
  ) {
    const detail = {
      action,
      ...(record
        ? {
            correlationKey: record.key,
            sceneIndex: record.sceneIndex,
            transcriptRevision: record.transcriptRevision,
            answerVersion: record.answerVersion,
            ...(record.sourceId === undefined ? {} : { sourceId: record.sourceId }),
            origin: record.origin,
            status: record.status,
            displayStatus: record.displayStatus,
            ...(record.applicationAction === undefined ? {} : { applicationAction: record.applicationAction }),
          }
        : {}),
      ...fields,
    };
    const serializableDetail = Object.fromEntries(
      Object.entries(detail).filter(([, value]) => value !== undefined),
    ) as typeof detail;
    this.log(`evaluation.${action}`, serializableDetail);
    this.timeline({ type: "evaluation_control", ...serializableDetail });
  }

  private outputBlocked = false;
  private setOutputBlocked(blocked: boolean, reason: string) {
    this.transport.setOutputBlocked(blocked);
    if (this.outputBlocked === blocked) return;
    this.outputBlocked = blocked;
    this.timeline({ type: "playback_gate_changed", state: blocked ? "blocked" : "permitted", reason });
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
      firstObservedAtMs: utterance.firstObservedAtMs,
      lastObservedAtMs: utterance.lastObservedAtMs,
    });
  }

  private captureTranscript(event: TranscriptEvent) {
    if (!this.ready) return;
    // A transcript from either speaker ends the other speaker's canonical turn,
    // even when the incoming Sprout speech cannot be recorded as delivered.
    const priorSpeaker = event.speaker === "child" ? "sprout" : "child";
    clearTimeout(this.utteranceTimers[priorSpeaker]);
    delete this.utteranceTimers[priorSpeaker];
    this.flushUtterance(priorSpeaker, "finalized");
    const delivered =
      event.speaker === "child" ||
      (!this.answerResponseGate && this.transport.delivered?.(event.startMs, event.endMs) === true);
    const completed = this.canonical[event.speaker].append(
      event.delta,
      event.startMs,
      event.endMs,
      delivered,
      Date.now() - this.startedAt!,
    );
    if (completed) this.flushUtterance(event.speaker, "finalized", completed);
    clearTimeout(this.utteranceTimers[event.speaker]);
    this.utteranceTimers[event.speaker] = setTimeout(
      () => this.flushUtterance(event.speaker, "finalized"),
      UTTERANCE_GAP_MS,
    );
  }

  constructor(
    private transport: Transport,
    private evaluateAnswer: EvaluateAnswer,
    private changed: (snapshot: Snapshot) => void,
    private diagnosticChanged?: () => void,
    private recorder?: SessionRecorder,
    private retryOf?: DurableSessionRef,
  ) {}

  private get scene() {
    return sceneAt(this.snapshot.sceneIndex);
  }

  /** An approved ADVANCE still owns the gate until displayed context releases it. */
  private get advanceResponseTransitionActive() {
    return this.pending?.kind === "advance" || this.displayedRelease !== null;
  }

  log(type: string, detail?: unknown) {
    // Bounded, in-memory prototype diagnostics; no raw audio or SDP.
    if (this.events.length >= 8000) this.events.shift();
    this.events.push({ at: Date.now() - this.createdAt, type, detail });
    if (type.startsWith("answer.") || type.startsWith("advance.") || type === "scene.displayed")
      this.diagnosticChanged?.();
  }

  /** Observe blockers and schedule the optional source isolation path. */
  private observeResponseGate(trigger: string, extra: Record<string, unknown> = {}) {
    const gate = this.answerResponseGate;
    if (!gate) return;
    const now = Date.now();
    const advanceReadyAt = this.deferredAdvance?.correctionReadyAt;
    const stayReadyAt = this.deferredStay?.correctionReadyAt;
    const correctionReadyAt = advanceReadyAt ?? stayReadyAt;
    const vadGraceUntil = this.deferredAdvance?.vadGraceUntil ?? this.deferredStay?.vadGraceUntil;
    const scheduledEligibilityAt = Math.max(
      correctionReadyAt ?? 0,
      gate.outputQuietAt,
      vadGraceUntil ?? 0,
      gate.sceneDisplayedAt ?? 0,
    );
    const conditions: string[] = [];
    if (!gate.decision) conditions.push("answer_evaluation");
    if (correctionReadyAt !== undefined && correctionReadyAt > now) conditions.push("correction_window");
    if (this.provisionalActivity) conditions.push("provisional_vad");
    if (this.microphoneSpeaking) conditions.push("microphone_speaking");
    if (vadGraceUntil !== undefined && vadGraceUntil > now) conditions.push("vad_grace");
    if (gate.outputQuietAt > now) conditions.push("output_transcript_quiet");
    if (gate.outputDiscarded && this.transport.activeSourceId === gate.discardedSourceId)
      conditions.push("replacement_source");
    if (gate.decision === "ADVANCE" && gate.sceneCommittedAt === undefined) conditions.push("scene_commit");
    if (gate.decision === "ADVANCE" && gate.sceneCommittedAt !== undefined && gate.sceneDisplayedAt === undefined)
      conditions.push("scene_display");
    // This timestamp is the first observation where every known release
    // blocker is clear. It is deliberately not the maximum of deadlines:
    // evaluation and provisional activity can outlast those deadlines.
    const unresolvedBlockers = conditions.filter(condition => condition !== "microphone_speaking");
    if (conditions.includes("output_transcript_quiet") && this.replacementEligibleForGate(gate))
      gate.outputQuietBlockedRelease = true;
    if (unresolvedBlockers.length === 0 && gate.eligibleAt === undefined) gate.eligibleAt = now;
    if (unresolvedBlockers.length > 0) gate.eligibleAt = undefined;
    const sessionTime = (at: number | undefined) => (at === undefined ? null : at - this.createdAt);
    this.log("answer.response_gate_observed", {
      scene_index: gate.sceneIndex,
      transcript_revision: gate.transcriptRevision,
      answer_version: gate.answerVersion,
      trigger,
      decision: gate.decision ?? null,
      conditions,
      microphone_speaking: this.microphoneSpeaking,
      provisional_vad: this.provisionalActivity,
      blocked_output_activity: extra.blocked_output_activity ?? false,
      output_quiet_at: sessionTime(gate.outputQuietAt || undefined),
      correction_ready_at: sessionTime(correctionReadyAt),
      vad_grace_until: sessionTime(vadGraceUntil),
      scene_committed_at: sessionTime(gate.sceneCommittedAt),
      scene_displayed_at: sessionTime(gate.sceneDisplayedAt),
      scheduled_eligible_at: sessionTime(scheduledEligibilityAt || undefined),
      eligible_at: sessionTime(gate.eligibleAt),
      eligibility_basis: gate.eligibleAt === undefined ? null : "observed_all_blockers_clear",
      output_blocked: this.outputBlocked,
      output_discarded: gate.outputDiscarded === true,
      source_isolation_required: gate.sourceIsolationRequired === true,
      output_media_activity: this.outputActivity,
      output_media_is_release_barrier: false,
      ...extra,
    });
    this.scheduleReplacement();
  }

  async start() {
    if (this.recordingStarted || this.snapshot.status === "ended") return;
    this.recordingStarted = true;
    this.transport.setStartupDiagnosticSink?.(stage => this.startup(stage));
    this.transport.setMicrophoneDiagnosticSink?.(event => {
      if (!this.closed && this.snapshot.status !== "ended") this.log(event.type, event.detail);
    });
    if (this.recorder)
      this.recording.enqueue("create", async () => {
        const durableSessionRef = await this.recorder!.create(this.retryOf);
        // Creation may finish after the live UI ends; preserve identity in that snapshot too.
        this.update({ durableSessionRef });
      });
    this.log("attempt.started", { model: MODEL, prompt: PROMPT_VERSION });
    this.startupEvents.push(this.events[this.events.length - 1]);
    this.initialInstruction = `Start the lesson now in English. Say only: "Hi! How many ${OBJECTS[this.scene.object].plural} do you see?" Do not introduce yourself or ask to play a game. ${sceneContext(this.scene)} Then pause and listen.`;
    this.pending = { kind: "greeting", sceneIndex: 0 };
    this.startup("startup.lesson_state_ready");
    this.changed(this.snapshot);
    this.startupTimer = setTimeout(
      () => this.fail("Microphone or voice setup took too long. Check browser permission and try again."),
      TIMING.startup,
    );
    try {
      await this.transport.start(
        event => this.receive(event),
        message => this.fail(message),
      );
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "Sprout could not start. Please try again.");
    }
  }

  private startup(stage: StartupStage) {
    if (this.closed || this.snapshot.status === "ended" || this.startupStages.has(stage)) return;
    this.startupStages.add(stage);
    this.log(stage);
    this.startupEvents.push(this.events[this.events.length - 1]);
  }

  private sendInitialInstruction() {
    if (!this.ready || !this.initialSceneDisplayed || !this.initialInstruction || this.snapshot.status === "ended")
      return;
    const instruction = this.initialInstruction;
    // Consume before dispatch so repeated readiness/display callbacks cannot duplicate it.
    this.initialInstruction = undefined;
    if (this.append("session.instructions.append", instruction)) this.startup("startup.initial_instruction_sent");
  }

  private update(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.changed(this.snapshot);
  }

  private dispatch(command: ClientCommand): boolean {
    this.log("command.sent", command);
    try {
      this.transport.send(command);
      return true;
    } catch {
      return false;
    }
  }

  private append(
    type: "session.instructions.append" | "session.thinking.append",
    content: string,
    delegationId: string | null = null,
    record?: EvaluationRecord,
  ): boolean {
    if (this.snapshot.status === "ended") return false;
    const eventId = `sprout_${++this.commands}`;
    const sourceId = this.transport.activeSourceId;
    this.contextCommands.set(eventId, { sourceId, recordKey: record?.key, delegationId });
    const sent = this.dispatch({ type, event_id: eventId, content, delegation_id: delegationId });
    this.log("context.sent", {
      client_event_id: eventId,
      event_type: type,
      source_id: sourceId ?? null,
      delegation_id: delegationId,
      delivery: sent ? "transport_send_returned" : "send_failed",
    });
    this.evaluationControl(record, "context_sent", {
      contextEventId: eventId,
      ...(delegationId === null ? {} : { delegationId }),
      ...(sourceId === undefined ? {} : { sourceId }),
      reason: `${type}:${sent ? "transport_send_returned" : "send_failed"}`,
    });
    if (!sent) this.fail("The voice connection was lost. You can start a new lesson.");
    return sent;
  }

  /** Guards the entry points where late external input can still arrive. */
  private expireIfOverdue() {
    if (this.ending) return true;
    if (this.startedAt !== undefined && Date.now() - this.startedAt >= TIMING.hard) {
      this.end("time_limit");
      return true;
    }
    return this.snapshot.status === "ended";
  }

  receive(event: ProviderEvent) {
    // Finalization is accepted after ending, but no further model work is.
    if (event.type === "session.closed") {
      this.log("connection.finalized", { reason: event.reason, usage: event.usage });
      if (this.snapshot.status !== "ended")
        this.fail("The voice service ended this attempt. You can start a new lesson.");
      this.close();
      return;
    }
    if (this.expireIfOverdue()) return;
    if (event.eventId !== undefined) {
      if (this.seen.has(event.eventId)) return;
      this.seen.add(event.eventId);
    }
    switch (event.type) {
      case "output.activity":
        if (event.state === "active" && this.ready) {
          this.startup("startup.first_provider_output");
          this.startup("startup.first_tutor_speech");
        }
        if (this.outputActivity === event.state) return;
        this.outputActivity = event.state;
        if (event.state === "active") this.discardStaleOutput("blocked_output_media");
        this.log("output.media_activity", {
          state: event.state,
          output_blocked: this.outputBlocked,
          ...(this.answerResponseGate
            ? {
                scene_index: this.answerResponseGate.sceneIndex,
                transcript_revision: this.answerResponseGate.transcriptRevision,
                answer_version: this.answerResponseGate.answerVersion,
              }
            : {}),
        });
        this.observeResponseGate("output_media_activity");
        return;
      case "session.started":
        this.begin();
        return;
      case "provider.error":
        if (event.clientEventId) this.contextCommandFailed(event.clientEventId, event.sourceId, event.code);
        this.log("provider.error", { code: event.code });
        this.fail("The voice service reported a problem. This attempt has ended.");
        return;
      case "transcript":
        this.heard(event);
        return;
      case "microphone.activity_started":
        this.cancelReplacementForChild("child_speech");
        if (this.microphoneSpeaking || this.provisionalActivity) return;
        this.provisionalActivity = true;
        this.activityTranscriptRevision = this.transcriptRevision;
        this.cancelNoTranscriptRecovery();
        this.log("answer.activity_started", {
          transcript_revision: this.transcriptRevision,
          speech_epoch: this.speechEpoch,
          transcript_epoch: this.transcriptEpoch,
          pending_evaluation: Boolean(this.settleTimer),
        });
        this.observeResponseGate("provisional_vad_started");
        if (this.answerResponseGate?.sourceIsolationRequired) this.scheduleDisplayedRelease();
        return;
      case "microphone.activity_discarded": {
        if (!this.provisionalActivity) return;
        this.provisionalActivity = false;
        const heardNewTranscript = this.transcriptRevision !== this.activityTranscriptRevision;
        this.log("answer.activity_discarded", {
          heard_new_transcript: heardNewTranscript,
          speech_epoch: this.speechEpoch,
          transcript_epoch: this.transcriptEpoch,
          transcript_revision: this.transcriptRevision,
        });
        this.observeResponseGate("provisional_vad_discarded");
        if (this.answerResponseGate?.sourceIsolationRequired) this.scheduleDisplayedRelease();
        if (heardNewTranscript) {
          this.evaluation?.abort();
          if (this.latest) this.scheduleEvaluation(this.latest, TRANSCRIPT_FALLBACK_MS, "transcript_revision");
        } else if (this.deferredAdvance) this.scheduleDeferredRelease();
        else if (this.deferredStay) this.scheduleDeferredStayRelease();
        return;
      }
      case "microphone.speech_started":
        this.cancelReplacementForChild("child_speech");
        if (this.microphoneSpeaking) return;
        const wasProvisional = this.provisionalActivity;
        const heardDuringActivity =
          this.provisionalActivity && this.transcriptRevision !== this.activityTranscriptRevision;
        this.provisionalActivity = false;
        this.microphoneSpeaking = true;
        this.microphoneSpeechStartedAt = Date.now();
        this.timeline({ type: "microphone_speech_started" });
        this.speechEpoch++;
        if (heardDuringActivity) this.transcriptEpoch = this.speechEpoch;
        this.cancelNoTranscriptRecovery();
        this.vadDetectionMs = undefined;
        this.log("answer.speech_started", {
          epoch: this.speechEpoch,
          transcript_epoch: this.transcriptEpoch,
          transcript_revision: this.transcriptRevision,
          pending_evaluation: Boolean(this.settleTimer),
          decision_preserved: Boolean(this.evaluation || this.deferredAdvance),
        });
        this.observeResponseGate("microphone_speech_started");
        if (this.answerResponseGate?.sourceIsolationRequired) this.scheduleDisplayedRelease();
        this.startDeferredVadGrace(
          this.microphoneSpeechStartedAt,
          wasProvisional ? "provisional_confirmation" : "confirmed_speech",
        );
        return;
      case "microphone.speech_stopped":
        if (!this.microphoneSpeaking) return;
        this.microphoneSpeaking = false;
        this.microphoneSpeechStartedAt = undefined;
        this.turnEndAt = Date.now();
        this.vadDetectionMs = event.quietMs;
        this.timeline({
          type: "microphone_speech_stopped",
          quietMs: event.quietMs,
          estimatedAcousticEndAtMs: this.turnEndAt - event.quietMs - (this.startedAt ?? this.turnEndAt),
        });
        this.turnSignal = "microphone_vad";
        this.log("answer.turn_end", {
          signal: this.turnSignal,
          speech_epoch: this.speechEpoch,
          transcript_epoch: this.transcriptEpoch,
          transcript_revision: this.transcriptRevision,
          scene_index: this.snapshot.sceneIndex,
          answer_version: this.latest ? `${this.latest.startMs}:${this.latest.text.trim()}` : null,
          usable_for_latest_transcript: Boolean(this.latest && this.transcriptEpoch === this.speechEpoch),
          selection_reason: !this.latest
            ? "no_transcript"
            : this.transcriptEpoch !== this.speechEpoch
              ? "transcript_epoch_mismatch"
              : "matching_speech_epoch",
          quiet_threshold_ms: MICROPHONE_QUIET_MS,
          vad_detection_ms: event.quietMs,
          estimated_acoustic_end_at: this.turnEndAt - event.quietMs - this.createdAt,
        });
        this.observeResponseGate("microphone_speech_stopped");
        if (this.answerResponseGate?.sourceIsolationRequired) this.scheduleDisplayedRelease();
        if (this.latest && this.transcriptEpoch === this.speechEpoch)
          this.scheduleEvaluation(this.latest, TRANSCRIPT_TAIL_MS, "microphone_vad");
        else if (this.latest) this.scheduleNoTranscriptRecovery(this.speechEpoch);
        if (this.deferredAdvance) this.scheduleDeferredRelease();
        else if (this.deferredStay) this.scheduleDeferredStayRelease();
        return;
      case "delegation":
        this.handleDelegation(event.id, event.offsetMs, event.sourceId);
        return;
      case "delegation.unsupported":
        this.log("evaluation.delegation_rejected", { reason: "invalid_or_unsupported_delegation" });
        return;
      case "context.appended":
        this.contextAcknowledged(event.name, event.clientEventId, event.sourceId, event.startMs, event.endMs);
        return;
      case "usage":
        this.log("session.usage.updated", event.usage);
        return;
      default: {
        const unhandled: never = event;
        throw new Error(`Unhandled provider event: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  private begin() {
    if (this.snapshot.status !== "starting") return;
    clearTimeout(this.startupTimer);
    this.ready = true;
    this.startedAt = Date.now();
    this.startup("startup.live_ready");
    const startedAt = this.startedAt;
    if (this.recorder) this.recording.enqueue("activate", () => this.recorder!.activate(startedAt));
    this.timeline({ type: "playback_gate_changed", state: "permitted", reason: "session_started" });
    try {
      this.transport.startRecording?.();
    } catch (error) {
      if (this.recorder)
        this.recording.enqueue("capture", async () => {
          throw error;
        });
    }
    this.log("lesson.started");
    // Canonical evidence/audio keep their Live origin. If the visual was already
    // painted, record that it is present at Live start; diagnostics retain its actual paint time.
    if (this.initialSceneDisplayed) this.recordDisplayedScene();
    this.update({ status: "active" });
    this.sendInitialInstruction();
    if (this.expireIfOverdue()) return;
    const phases: [number, () => void][] = [
      [TIMING.wrap, () => this.wrap()],
      [TIMING.goodbye, () => this.goodbye()],
      [TIMING.finish, () => this.end("wrap_up")],
      [TIMING.hard, () => this.end("time_limit")],
    ];
    this.phaseTimers = phases.map(([delay, run]) => setTimeout(run, delay));
  }

  private heard(event: TranscriptEvent) {
    if (event.speaker === "sprout" && event.delta.trim()) {
      this.startup("startup.first_provider_output");
      this.startup("startup.first_tutor_transcript");
    }
    this.captureTranscript(event);
    const fromChild = event.speaker === "child";
    this.log(fromChild ? "transcript.child_or_nearby_speaker" : "transcript.sprout", {
      delta: event.delta,
      start_ms: event.startMs,
      end_ms: event.endMs,
      scene: this.scene.id,
      playbackVerified: false,
    });
    const speech = fromChild ? this.childSpeech : this.sproutSpeech;
    const utterance = speech.append(event.delta, event.startMs, event.endMs);
    if (fromChild) this.sproutReply = "";
    else if (!this.answerResponseGate) {
      this.lastSproutDeltaAt = Date.now();
      this.sproutReply += event.delta;
    } else {
      const gate = this.answerResponseGate;
      const alreadyDiscarded = gate.outputDiscarded === true;
      this.discardStaleOutput("blocked_provider_transcript");
      if (this.answerResponseGate !== gate) return;
      if (gate.outputDiscarded) {
        this.log("answer.stale_output_discarded", {
          ...this.replacementIdentity(gate),
          source_id: event.sourceId ?? null,
          received_after_cancellation: alreadyDiscarded,
          output_blocked: this.outputBlocked,
          provider_transcript_start_ms: event.startMs,
          provider_transcript_end_ms: event.endMs,
        });
        this.observeResponseGate("discarded_provider_transcript", { blocked_output_activity: true });
        return;
      }
      const previousOutputQuietAt = this.answerResponseGate.outputQuietAt;
      this.answerResponseGate.outputQuietAt = Date.now() + UTTERANCE_GAP_MS;
      this.log("answer.response_gate_deadline_updated", {
        scene_index: this.answerResponseGate.sceneIndex,
        transcript_revision: this.answerResponseGate.transcriptRevision,
        answer_version: this.answerResponseGate.answerVersion,
        condition: "output_transcript_quiet",
        previous_deadline_at: previousOutputQuietAt ? previousOutputQuietAt - this.createdAt : null,
        deadline_at: this.answerResponseGate.outputQuietAt - this.createdAt,
        extension_ms: Math.max(0, this.answerResponseGate.outputQuietAt - Math.max(Date.now(), previousOutputQuietAt)),
        provider_transcript_start_ms: event.startMs,
        provider_transcript_end_ms: event.endMs,
      });
      this.observeResponseGate("blocked_provider_transcript", { blocked_output_activity: true });
      if (this.deferredAdvance) this.scheduleDeferredRelease();
      if (this.deferredStay) this.scheduleDeferredStayRelease();
      if (this.displayedRelease) this.scheduleDisplayedRelease();
    }
    if (fromChild) {
      this.latestSourceId = event.sourceId;
      this.cancelReplacementForChild("newer_transcript");
      const sourceIsolationRequired = this.answerResponseGate?.sourceIsolationRequired === true;
      if (sourceIsolationRequired && requestsStop(utterance.text)) {
        // end() retires both sources before any gate cleanup.
        this.end("child_stop");
        return;
      }
      if (this.advanceResponseTransitionActive) {
        if (requestsStop(utterance.text)) {
          this.cancelAnswerResponseGate("child_stop");
          this.end("child_stop");
          return;
        }
        if (sourceIsolationRequired) {
          if (mentionsNumber(utterance.text)) {
            // The committed new scene owns this answer. The new gate inherits
            // the original recovery deadline and keeps A blocked.
            clearTimeout(this.displayedReleaseTimer);
            this.displayedRelease = null;
            this.log("answer.response_gate_superseded", {
              reason: "new_answer_on_displayed_scene",
              scene_index: this.snapshot.sceneIndex,
              transcript_revision: this.transcriptRevision,
              output_blocked: this.outputBlocked,
            });
          } else {
            this.preserveNonAnswerOnStaleSource();
            return;
          }
        } else {
          this.log("answer.advance_transition_transcript_ignored", {
            scene_index: this.snapshot.sceneIndex,
            gate_scene_index: this.answerResponseGate?.sceneIndex,
            answer_bearing: mentionsNumber(utterance.text),
          });
          // Keep transition-period speech out of the next answer window too.
          this.childSpeech = new TranscriptWindow();
          return;
        }
      }
      if (sourceIsolationRequired && !mentionsNumber(utterance.text)) {
        this.preserveNonAnswerOnStaleSource();
        return;
      }
      if (sourceIsolationRequired && this.answerResponseGate?.decision === "ADVANCE") {
        const committedGate = this.answerResponseGate;
        this.supersedeEvaluation(
          {
            sceneIndex: committedGate.sceneIndex,
            transcriptRevision: committedGate.transcriptRevision,
            answerVersion: committedGate.answerVersion,
          },
          "new_answer_on_displayed_scene",
          true,
          event.sourceId,
        );
      }
      // A transcript can arrive before local VAD notices renewed speech.
      const previous = this.latest;
      const invalidatesPendingAnswer = Boolean(
        previous && (this.settleTimer || this.evaluation || this.deferredAdvance || this.deferredStay),
      );
      const previousRevision = this.transcriptRevision;
      if (invalidatesPendingAnswer)
        this.supersedeEvaluation(
          {
            sceneIndex: this.snapshot.sceneIndex,
            transcriptRevision: previousRevision,
            answerVersion: `${previous?.startMs}:${previous?.text.trim()}`,
          },
          "transcript_revision",
          true,
        );
      this.transcriptRevision++;
      if (invalidatesPendingAnswer)
        this.log("answer.semantic_answer_invalidated", {
          reason: "transcript_revision",
          previous_revision: previousRevision,
          revision: this.transcriptRevision,
          previous_version: `${previous?.startMs}:${previous?.text.trim()}`,
          revised_utterance: utterance.text,
        });
      this.cancelNoTranscriptRecovery();
      this.evaluation?.abort();
      this.cancelDeferredAdvance();
      this.cancelDeferredStay();
      this.latest = utterance;
      this.childTranscriptHistory.push({
        sceneIndex: this.snapshot.sceneIndex,
        transcriptRevision: this.transcriptRevision,
        answerVersion: `${utterance.startMs}:${utterance.text.trim()}`,
        startMs: utterance.startMs,
        endMs: event.endMs,
        sourceId: event.sourceId,
        answerBearing: mentionsNumber(utterance.text),
      });
      if (this.childTranscriptHistory.length > 128) this.childTranscriptHistory.shift();
      this.lastDeltaAt = Date.now();
      this.transcriptEpoch = this.speechEpoch;
      this.log("answer.transcript_revision", {
        revision: this.transcriptRevision,
        sceneIndex: this.snapshot.sceneIndex,
        version: `${utterance.startMs}:${utterance.text.trim()}`,
        speech_epoch: this.speechEpoch,
        transcript_epoch: this.transcriptEpoch,
        microphone_speaking: this.microphoneSpeaking,
        provisional_activity: this.provisionalActivity,
        last_stop_usable: this.speechEpoch > 0 && this.turnSignal === "microphone_vad" && !this.microphoneSpeaking,
        utterance: utterance.text,
      });
      this.observeResponseGate("transcript_revision");
      if (requestsStop(utterance.text)) {
        this.cancelAnswerResponseGate("child_stop");
        this.end("child_stop");
      } else {
        const answerBearing = mentionsNumber(utterance.text);
        if (answerBearing && this.canGateAnswerResponse) this.updateAnswerResponseGate(utterance);
        else if (answerBearing) this.cancelAnswerResponseGate("answer_not_evaluable");
        else this.cancelAnswerResponseGate("non_answer_revision");
        // Transcript revisions are learner evidence and always get a bounded
        // evaluation attempt. A clean stop in this speech epoch lets us use
        // the short tail; otherwise keep the fallback even while VAD is active.
        if (this.speechEpoch > 0 && this.turnSignal === "microphone_vad" && !this.microphoneSpeaking)
          this.scheduleEvaluation(utterance, TRANSCRIPT_TAIL_MS, "transcript_revision");
        else this.scheduleEvaluation(utterance, TRANSCRIPT_FALLBACK_MS, "transcript_fallback");
      }
    } else if (this.snapshot.status !== "goodbye" && saidGoodbye(utterance.text)) {
      // The model ending the lesson itself, usually a stop request the
      // transcript guard could not recognize. Not proof of playback.
      this.end("model_goodbye");
    } else if (this.deferredAdvance) {
      this.scheduleDeferredRelease();
    }
  }

  /** Keep the old authoritative outcome and its A quiet fallback intact. */
  private preserveNonAnswerOnStaleSource() {
    this.log("answer.response_gate_preserved", {
      reason: "non_answer_child_interruption",
      scene_index: this.snapshot.sceneIndex,
      output_blocked: this.outputBlocked,
      source_isolation_required: true,
    });
    if (this.displayedRelease) this.scheduleDisplayedRelease();
    if (this.deferredStay) this.scheduleDeferredStayRelease();
  }

  private updateAnswerResponseGate(utterance: Utterance) {
    const answerVersion = `${utterance.startMs}:${utterance.text.trim()}`;
    const current = this.answerResponseGate;
    if (!current) {
      this.answerResponseGate = {
        sceneIndex: this.snapshot.sceneIndex,
        transcriptRevision: this.transcriptRevision,
        answerVersion,
        startedAt: Date.now(),
        outputQuietAt: 0,
        childUtterance: utterance.text.trim(),
      };
      this.canonical.sprout.invalidateDelivery();
      this.setOutputBlocked(true, "answer_evaluation");
      this.responseGateRecoveryTimer = setTimeout(() => {
        const gate = this.answerResponseGate;
        if (!gate || this.expireIfOverdue()) return;
        this.observeResponseGate("recovery_budget_exhausted");
        this.log("answer.response_gate_recovery_failed", {
          scene_index: gate.sceneIndex,
          transcript_revision: gate.transcriptRevision,
          answer_version: gate.answerVersion,
          wait_ms: Date.now() - gate.startedAt,
          output_media_activity: this.outputActivity,
        });
        this.cancelReplacement("recovery_expired");
        this.fail("Sprout could not safely resume its voice. This attempt has ended; you can start a new lesson.");
      }, RESPONSE_GATE_RECOVERY_MS);
      this.log("answer.response_gate_started", {
        scene_index: this.snapshot.sceneIndex,
        transcript_revision: this.transcriptRevision,
        answer_version: answerVersion,
      });
      if (
        this.outputActivity === "active" ||
        (this.outputActivity === "unavailable" &&
          this.lastSproutDeltaAt !== undefined &&
          Date.now() - this.lastSproutDeltaAt < UTTERANCE_GAP_MS)
      )
        this.discardStaleOutput("answer_evaluation");
      this.observeResponseGate("gate_started");
      return;
    }
    this.log("answer.response_gate_observed", {
      scene_index: current.sceneIndex,
      transcript_revision: current.transcriptRevision,
      answer_version: current.answerVersion,
      trigger: "identity_superseded",
      decision: current.decision ?? null,
      conditions: [],
      output_blocked: this.outputBlocked,
      output_quiet_at: current.outputQuietAt ? current.outputQuietAt - this.createdAt : null,
      superseded_by_transcript_revision: this.transcriptRevision,
    });
    this.cancelReplacement("gate_replaced");
    this.answerResponseGate = {
      ...current,
      childUtterance: utterance.text.trim(),
      replacementAttempted: undefined,
      // A is still the same stale source. A new answer does not clear this
      // classification or renew the original 15-second recovery budget.
      sourceIsolationRequired: current.sourceIsolationRequired,
      sourceIsolationRequiredAt: current.sourceIsolationRequiredAt,
      sceneIndex: this.snapshot.sceneIndex,
      transcriptRevision: this.transcriptRevision,
      answerVersion,
      outputQuietAt: current.outputQuietAt,
      eligibleAt: undefined,
      decision: undefined,
      sceneCommittedAt: undefined,
      sceneDisplayedAt: undefined,
      evaluationTimedOutAt: undefined,
    };
    this.log("answer.response_gate_updated", {
      scene_index: this.snapshot.sceneIndex,
      transcript_revision: this.transcriptRevision,
      answer_version: answerVersion,
    });
    this.observeResponseGate("gate_identity_updated");
  }

  private discardStaleOutput(reason: string) {
    const gate = this.answerResponseGate;
    if (
      !gate ||
      gate.outputDiscarded ||
      gate.outputDiscarding ||
      !this.transport.discardOutput ||
      !this.transport.prepareReplacement ||
      !this.transport.activateSource ||
      !this.transport.retireSource
    )
      return;
    const sourceId = this.transport.activeSourceId;
    gate.outputDiscarding = true;
    this.log("answer.output_cancellation_requested", {
      ...this.replacementIdentity(gate),
      reason,
      source_id: sourceId ?? null,
      mechanism: "transport_output_discard",
    });
    try {
      if (!this.transport.discardOutput()) {
        gate.outputDiscarding = false;
        this.log("answer.output_cancellation_failed", { ...this.replacementIdentity(gate), reason: "unavailable" });
        return;
      }
    } catch {
      this.log("answer.output_cancellation_failed", { ...this.replacementIdentity(gate), reason: "transport_failure" });
      this.fail("Sprout could not safely discard its voice. You can start a new lesson.");
      return;
    }
    gate.outputDiscarded = true;
    gate.outputDiscarding = false;
    gate.discardedSourceId = sourceId;
    gate.outputQuietAt = 0;
    gate.sourceIsolationRequired = true;
    gate.sourceIsolationRequiredAt = Date.now();
    this.outputActivity = "unavailable";
    this.log("answer.source_isolation_required", {
      ...this.replacementIdentity(gate),
      reason: "stale_output_discarded",
      at: gate.sourceIsolationRequiredAt - this.createdAt,
      active_source_id: sourceId ?? null,
      output_blocked: this.outputBlocked,
    });
    this.log("answer.output_cancellation_completed", {
      ...this.replacementIdentity(gate),
      source_id: sourceId ?? null,
      completion_basis: "local_output_isolated",
      provider_acknowledged: false,
    });
  }

  private cancelAnswerResponseGate(reason: string) {
    const protectedGate = this.answerResponseGate;
    if (protectedGate?.sourceIsolationRequired && !this.ending) {
      // No ordinary cancellation path can establish A's quiet or B authority.
      // If a caller cannot preserve the explicit fallback, stop every source
      // before clearing the gate instead of stranding it without a deadline.
      this.log("answer.unsafe_gate_cancellation", {
        ...this.replacementIdentity(protectedGate),
        reason,
        active_source_id: this.transport.activeSourceId ?? null,
        output_blocked: this.outputBlocked,
      });
      this.fail("Sprout could not safely resume its voice. This attempt has ended; you can start a new lesson.");
      return;
    }
    this.cancelReplacement(this.ending ? "lesson_end" : "gate_replaced");
    const gate = this.answerResponseGate;
    if (!gate) return;
    this.answerResponseGate = null;
    clearTimeout(this.responseGateRecoveryTimer);
    clearTimeout(this.displayedReleaseTimer);
    this.displayedReleaseTimer = undefined;
    this.displayedRelease = null;
    // Only explicit outcome release can establish A quiet or B promotion.
    // Generic cancellation does not prove that stale A is safe to hear.
    if (!gate.sourceIsolationRequired) this.setOutputBlocked(false, reason);
    this.log("answer.response_gate_cancelled", {
      scene_index: gate.sceneIndex,
      transcript_revision: gate.transcriptRevision,
      answer_version: gate.answerVersion,
      reason,
      wait_ms: Date.now() - gate.startedAt,
      output_transcript_quiet_blocked_release: gate.outputQuietBlockedRelease === true,
      source_isolation_required: gate.sourceIsolationRequired === true,
      preserved_output_block: gate.sourceIsolationRequired === true && this.outputBlocked,
      active_source_id: this.transport.activeSourceId ?? null,
    });
    this.log("answer.response_gate_observed", {
      scene_index: gate.sceneIndex,
      transcript_revision: gate.transcriptRevision,
      answer_version: gate.answerVersion,
      trigger: "cancelled",
      decision: gate.decision ?? null,
      conditions: [],
      output_blocked: this.outputBlocked,
      output_quiet_at: gate.outputQuietAt ? gate.outputQuietAt - this.createdAt : null,
      cancellation_reason: reason,
      cancelled: true,
    });
  }

  private gateMatches(identity: GateIdentity) {
    const gate = this.answerResponseGate;
    return Boolean(
      gate &&
      gate.sceneIndex === identity.sceneIndex &&
      gate.transcriptRevision === identity.transcriptRevision &&
      gate.answerVersion === identity.answerVersion,
    );
  }

  private releaseAnswerResponseGate(
    identity: GateIdentity,
    decision: GateDecision,
    reason: string,
    sendContext: () => void,
  ) {
    if (!this.gateMatches(identity)) return false;
    const gate = this.answerResponseGate!;
    this.observeResponseGate("release_eligibility_check");
    const contextSentAt = Date.now() - this.createdAt;
    sendContext();
    if (!this.gateMatches(identity)) return false;
    this.cancelReplacement("gate_released");
    this.answerResponseGate = null;
    clearTimeout(this.responseGateRecoveryTimer);
    this.setOutputBlocked(false, reason === "replacement_source" ? reason : decision.toLowerCase());
    this.log("answer.response_gate_released", {
      scene_index: identity.sceneIndex,
      transcript_revision: identity.transcriptRevision,
      answer_version: identity.answerVersion,
      decision,
      reason,
      wait_ms: Date.now() - gate.startedAt,
      context_sent_at: contextSentAt,
      ...(gate.evaluationTimedOutAt === undefined
        ? {}
        : { timeout_to_release_ms: Date.now() - gate.evaluationTimedOutAt }),
      output_transcript_quiet_blocked_release: gate.outputQuietBlockedRelease === true,
      output_quiet_at: gate.outputQuietAt ? gate.outputQuietAt - this.createdAt : null,
      eligible_at: gate.eligibleAt === undefined ? null : gate.eligibleAt - this.createdAt,
      eligibility_basis: gate.eligibleAt === undefined ? null : "observed_all_blockers_clear",
    });
    this.log("answer.response_gate_observed", {
      scene_index: identity.sceneIndex,
      transcript_revision: identity.transcriptRevision,
      answer_version: identity.answerVersion,
      trigger: "released",
      decision,
      conditions: [],
      output_blocked: false,
      output_quiet_at: gate.outputQuietAt ? gate.outputQuietAt - this.createdAt : null,
      release_reason: reason,
      released: true,
    });
    const record = this.findEvaluationRecord(identity);
    if (record)
      this.evaluationControl(record, "gate_released", {
        applicationAction: decision,
        reason,
      });
    return true;
  }

  /** Application authority only; PCM state never participates. */
  private replacementEligibleForGate(gate: AnswerResponseGate) {
    if (
      this.ending ||
      this.snapshot.status !== "active" ||
      !this.gateMatches(gate) ||
      this.transcriptRevision !== gate.transcriptRevision ||
      !gate.decision ||
      this.microphoneSpeaking ||
      this.provisionalActivity ||
      this.evaluation ||
      this.settleTimer ||
      this.pending
    )
      return false;
    if (gate.decision === "ADVANCE")
      return (
        gate.sceneCommittedAt !== undefined &&
        gate.sceneDisplayedAt !== undefined &&
        this.snapshot.sceneIndex === gate.sceneIndex + 1 &&
        Boolean(this.displayedRelease)
      );
    const deferred = this.deferredStay;
    return Boolean(
      deferred &&
      this.snapshot.sceneIndex === gate.sceneIndex &&
      deferred.answerVersion === gate.answerVersion &&
      deferred.transcriptRevision === gate.transcriptRevision &&
      Date.now() >= Math.max(deferred.correctionReadyAt, deferred.vadGraceUntil ?? 0),
    );
  }

  private scheduleReplacement() {
    clearTimeout(this.replacementTimer);
    const gate = this.answerResponseGate;
    if (!gate || !this.transport.prepareReplacement || !this.transport.activateSource || !this.transport.retireSource)
      return;
    if (this.replacement || gate.replacementAttempted) return;
    if (!this.replacementEligibleForGate(gate) || (!gate.outputDiscarded && gate.outputQuietAt <= Date.now())) {
      this.providerOnlySince = undefined;
      // Observe correction/grace completion even if quiet keeps moving later.
      const deferred = this.deferredStay;
      if (deferred && !this.microphoneSpeaking && !this.provisionalActivity && !this.evaluation && !this.settleTimer) {
        const readyAt = Math.max(deferred.correctionReadyAt, deferred.vadGraceUntil ?? 0);
        if (readyAt > Date.now())
          this.replacementTimer = setTimeout(() => this.scheduleReplacement(), readyAt - Date.now());
      }
      return;
    }
    this.providerOnlySince ??= Date.now();
    const threshold = gate.outputDiscarded ? 0 : STALE_OUTPUT_REPLACEMENT_MS;
    const delay = this.providerOnlySince + threshold - Date.now();
    if (delay > 0) {
      this.replacementTimer = setTimeout(() => this.scheduleReplacement(), delay);
      return;
    }
    if (!gate.sourceIsolationRequired) {
      gate.sourceIsolationRequired = true;
      gate.sourceIsolationRequiredAt = Date.now();
      this.log("answer.source_isolation_required", {
        ...this.replacementIdentity(gate),
        reason: "stale_output_threshold",
        at: gate.sourceIsolationRequiredAt - this.createdAt,
        active_source_id: this.transport.activeSourceId ?? null,
        output_blocked: this.outputBlocked,
      });
    }
    gate.replacementAttempted = true; // At most one paid attempt per answer identity.
    const owner = { gate, abort: new AbortController(), startedAt: Date.now(), id: undefined as number | undefined };
    this.replacement = owner;
    const seed: ReplacementSeed = {
      sceneIndex: this.snapshot.sceneIndex,
      decision: gate.decision!,
      evaluatedSceneIndex: gate.sceneIndex,
      childUtterance: gate.childUtterance,
      transcriptRevision: gate.transcriptRevision,
      answerVersion: gate.answerVersion,
    };
    this.log("replacement.triggered", {
      ...this.replacementIdentity(gate),
      decision: gate.decision,
      gate_age_ms: Date.now() - gate.startedAt,
      provider_only_hold_ms: Date.now() - this.providerOnlySince,
      remaining_output_quiet_ms: Math.max(0, gate.outputQuietAt - Date.now()),
      threshold_ms: threshold,
      reason: gate.outputDiscarded ? "stale_output_discarded" : "stale_output_threshold",
      source_isolation_required: true,
    });
    void this.prepareGateReplacement(owner, seed);
  }

  private replacementIdentity(gate: AnswerResponseGate) {
    return {
      scene_index: gate.sceneIndex,
      transcript_revision: gate.transcriptRevision,
      answer_version: gate.answerVersion,
    };
  }

  private cancelReplacement(reason: string) {
    clearTimeout(this.replacementTimer);
    this.providerOnlySince = undefined;
    const owner = this.replacement;
    if (!owner) return;
    this.replacement = null; // Invalidate before abort/retirement callbacks.
    owner.abort.abort();
    if (owner.id !== undefined) this.transport.retireSource?.(owner.id);
    this.log("replacement.cancelled", { ...this.replacementIdentity(owner.gate), reason, source_id: owner.id });
  }

  private cancelReplacementForChild(reason: string) {
    const owner = this.replacement;
    if (!owner) return;
    this.cancelReplacement(reason);
    if (owner.gate.outputDiscarded) owner.gate.replacementAttempted = undefined;
    // The stale classification was made at the trigger. Retiring B cannot
    // remove the answer gate or make A safe for any decision.
    this.log("answer.response_gate_preserved", {
      reason,
      decision: owner.gate.decision,
      scene_index: this.snapshot.sceneIndex,
      output_blocked: this.outputBlocked,
      source_isolation_required: owner.gate.sourceIsolationRequired === true,
    });
  }

  private async prepareGateReplacement(owner: NonNullable<LessonSession["replacement"]>, seed: ReplacementSeed) {
    try {
      const id = await this.transport.prepareReplacement!(seed, owner.abort.signal);
      owner.id = id;
      if (this.replacement !== owner || owner.abort.signal.aborted) {
        this.transport.retireSource!(id);
        return;
      }
      this.log("replacement.ready", {
        ...this.replacementIdentity(owner.gate),
        source_id: id,
        prepare_latency_ms: Date.now() - owner.startedAt,
      });
      if (Date.now() >= owner.gate.startedAt + RESPONSE_GATE_RECOVERY_MS) {
        this.cancelReplacement("recovery_expired");
        this.fail("Sprout could not safely resume its voice. This attempt has ended; you can start a new lesson.");
        return;
      }
      if (!this.replacementEligibleForGate(owner.gate)) {
        this.cancelReplacement("gate_replaced");
        return;
      }
      const oldSourceId = this.transport.activeSourceId;
      this.setOutputBlocked(true, "replacement_source");
      this.retireEvaluationDelegations(oldSourceId, id);
      if (!this.transport.activateSource!(id) || this.transport.activeSourceId !== id) {
        this.cancelReplacement("promotion_failure");
        this.fail("Sprout could not safely switch its voice. You can start a new lesson.");
        return;
      }
      this.log("replacement.promoted", {
        ...this.replacementIdentity(owner.gate),
        decision: seed.decision,
        source_id: id,
        old_source_id: oldSourceId,
        remaining_old_output_quiet_ms: Math.max(0, owner.gate.outputQuietAt - Date.now()),
      });
      // Provider timestamps restart for each source. Keep the committed A
      // outcome above, but make every subsequent transcript identity and
      // canonical utterance source-local to promoted B.
      for (const speaker of ["child", "sprout"] as const) {
        clearTimeout(this.utteranceTimers[speaker]);
        delete this.utteranceTimers[speaker];
        this.flushUtterance(speaker, "finalized");
      }
      this.childSpeech = new TranscriptWindow();
      this.sproutSpeech = new TranscriptWindow();
      this.latest = null;
      this.lastSproutDeltaAt = undefined;
      // Source authority replaced transcript quiet; do not rewrite A's deadline.
      this.replacement = null;
      clearTimeout(this.stayTimer);
      clearTimeout(this.displayedReleaseTimer);
      this.deferredStay = null;
      this.displayedRelease = null;
      this.cancelNoTranscriptRecovery();
      const content = evaluationResultContext({
        evaluatedAnswer: seed.childUtterance,
        evaluatedScene: sceneAt(seed.evaluatedSceneIndex),
        transcriptRevision: seed.transcriptRevision,
        answerVersion: seed.answerVersion,
        meaning:
          seed.decision === "ADVANCE"
            ? "met_advancement_criterion"
            : seed.decision === "STAY"
              ? "did_not_meet_advancement_criterion"
              : "unavailable",
        action: seed.decision,
        displayedScene: this.scene,
      });
      this.releaseAnswerResponseGate(owner.gate, seed.decision, "replacement_source", () => {
        this.append("session.instructions.append", content);
        this.releaseEvaluationRecord(owner.gate, seed.decision);
        if (!this.ending)
          this.log("replacement.instruction_sent", {
            ...this.replacementIdentity(owner.gate),
            decision: seed.decision,
            source_id: id,
          });
      });
    } catch {
      if (this.replacement === owner) this.cancelReplacement("startup_failure");
      // The existing transcript gate and original recovery deadline keep control.
    }
  }

  private scheduleEvaluation(
    utterance: Utterance,
    delay: number,
    reason: "transcript_revision" | "transcript_fallback" | "microphone_vad",
  ) {
    const transcriptRevision = this.transcriptRevision;
    const sceneIndex = this.snapshot.sceneIndex;
    const version = `${utterance.startMs}:${utterance.text.trim()}`;
    const record =
      mentionsNumber(utterance.text) && this.evaluable
        ? this.ensureEvaluationRecord(
            sceneIndex,
            transcriptRevision,
            version,
            utterance.text.trim(),
            this.latestSourceId,
          )
        : undefined;
    if (record) {
      if (record.origin === "delegation" || record.origin === "both") record.origin = "both";
      else record.origin = "application";
      if (record.status === "superseded" || record.status === "resolved") return;
      record.status = "scheduled";
      this.evaluationControl(record, "evaluation_scheduled", { origin: record.origin });
    }
    const restarting = Boolean(this.settleTimer);
    if (this.scheduledEvaluation)
      this.log("answer.evaluation_replaced", {
        ...this.scheduledEvaluation,
        reason,
        replacement_scene_index: sceneIndex,
        replacement_revision: transcriptRevision,
        replacement_version: version,
      });
    clearTimeout(this.settleTimer);
    const path = delay === TRANSCRIPT_TAIL_MS ? "microphone_vad" : "transcript_fallback";
    const selectionReason =
      path === "microphone_vad"
        ? "usable_microphone_stop"
        : this.microphoneSpeaking
          ? "microphone_stop_not_observed"
          : this.speechEpoch === 0
            ? "no_confirmed_speech"
            : this.transcriptEpoch !== this.speechEpoch
              ? "transcript_epoch_mismatch"
              : "no_usable_microphone_stop";
    this.scheduledEvaluation = { sceneIndex, revision: transcriptRevision, version, path };
    this.log("answer.evaluation_scheduled", {
      revision: transcriptRevision,
      sceneIndex,
      version,
      delay_ms: delay,
      reason,
      path,
      selection_reason: selectionReason,
      deadline_at: Date.now() + delay - this.createdAt,
      speech_epoch: this.speechEpoch,
      transcript_epoch: this.transcriptEpoch,
      microphone_speaking: this.microphoneSpeaking,
      provisional_activity: this.provisionalActivity,
      restarted_existing_timer: restarting,
    });
    this.log("answer.candidate", {
      sceneIndex,
      revision: transcriptRevision,
      utterance: utterance.text,
      version,
      signal: delay === TRANSCRIPT_TAIL_MS ? "microphone_vad" : "transcript_fallback",
      transcript_at: this.lastDeltaAt - this.createdAt,
    });
    this.settleTimer = setTimeout(() => {
      this.settleTimer = undefined;
      this.scheduledEvaluation = undefined;
      if (
        transcriptRevision !== this.transcriptRevision ||
        sceneIndex !== this.snapshot.sceneIndex ||
        this.latest?.startMs !== utterance.startMs ||
        this.latest.text !== utterance.text
      ) {
        const invalidationReason =
          transcriptRevision !== this.transcriptRevision
            ? "transcript_revision"
            : sceneIndex !== this.snapshot.sceneIndex
              ? "scene_changed"
              : "answer_version_changed";
        this.log("answer.evaluation_invalidated", {
          reason: invalidationReason,
          revision: transcriptRevision,
          sceneIndex,
          version,
          path,
          current_revision: this.transcriptRevision,
          current_scene_index: this.snapshot.sceneIndex,
        });
        return;
      }
      if (this.microphoneSpeaking || this.provisionalActivity)
        this.log("answer.evaluation_proceeding_despite_vad", {
          revision: transcriptRevision,
          sceneIndex,
          version,
          microphone_speaking: this.microphoneSpeaking,
          provisional_activity: this.provisionalActivity,
        });
      if (delay === TRANSCRIPT_FALLBACK_MS) {
        this.turnEndAt = Date.now();
        this.vadDetectionMs = undefined;
        this.turnSignal = "transcript_fallback";
        this.log("answer.turn_end", { signal: this.turnSignal });
      }
      this.log("answer.evaluation_timer_fired", {
        sceneIndex,
        revision: transcriptRevision,
        version,
        path,
        microphone_speaking: this.microphoneSpeaking,
        provisional_activity: this.provisionalActivity,
      });
      this.evaluate(utterance);
    }, delay);
  }

  /** Whether the app owns answer checking in the current lesson phase. */
  private get canGateAnswerResponse() {
    return this.snapshot.status === "active" && this.snapshot.sceneIndex < LAST_SCENE;
  }

  /** True while the app could act on an answer about the displayed scene. */
  private get evaluable() {
    return (
      this.snapshot.status === "active" &&
      !this.pending &&
      !this.deferredAdvance &&
      !this.deferredStay &&
      this.snapshot.sceneIndex < LAST_SCENE
    );
  }

  private evaluate(utterance: Utterance) {
    const text = utterance.text.trim();
    const version = `${utterance.startMs}:${text}`;
    const key = this.evaluationKey(this.snapshot.sceneIndex, this.transcriptRevision, version, this.latestSourceId);
    const skipped = !this.evaluable
      ? this.snapshot.status !== "active"
        ? "session_not_active"
        : this.pending
          ? "display_pending"
          : this.deferredAdvance || this.deferredStay
            ? "decision_pending_release"
            : "scene_not_evaluable"
      : !text
        ? "empty_transcript"
        : this.evaluated.has(key)
          ? "already_requested"
          : !mentionsNumber(text)
            ? "no_count"
            : null;
    if (skipped) {
      this.log("answer.evaluation_not_requested", {
        sceneIndex: this.snapshot.sceneIndex,
        revision: this.transcriptRevision,
        version,
        reason: skipped,
        signal: this.turnSignal,
      });
      if (skipped === "no_count") {
        this.evaluated.add(key);
        this.log("answer.skipped", { version, reason: "no_count" });
      }
      return;
    }
    const record = this.ensureEvaluationRecord(
      this.snapshot.sceneIndex,
      this.transcriptRevision,
      version,
      text,
      this.latestSourceId,
    );
    // A revised answer is a different version of the same utterance, so it is
    // judged again; an unchanged one never is.
    if (record.status === "in_flight" || record.status === "resolved") {
      this.evaluationControl(record, "evaluation_joined", { reason: record.status });
      return;
    }
    this.evaluated.add(key);
    record.status = "in_flight";
    this.evaluationControl(record, "evaluation_started", { origin: record.origin });
    const sceneIndex = this.snapshot.sceneIndex;
    const finalDeltaAt = this.lastDeltaAt;
    const turnEndAt = this.turnEndAt;
    const transcriptRevision = this.transcriptRevision;
    const correlationKey = `${sceneIndex}:${version}`;
    const requestedAt = Date.now();
    this.timeline({
      type: "answer_evaluation_requested",
      correlationKey,
      sceneIndex,
      turnSignal: this.turnSignal,
      turnEndToRequestMs: requestedAt - turnEndAt,
    });
    this.log("answer.requesting", {
      sceneIndex,
      revision: transcriptRevision,
      version,
      signal: this.turnSignal,
      speech_epoch: this.speechEpoch,
      transcript_epoch: this.transcriptEpoch,
      turn_end_at: turnEndAt - this.createdAt,
      timeout_ms: EVALUATION_TIMEOUT_MS,
      timeout_deadline_at: requestedAt + EVALUATION_TIMEOUT_MS - this.createdAt,
      transcript_to_request_ms: Date.now() - finalDeltaAt,
      turn_end_to_request_ms: Date.now() - turnEndAt,
      ...(this.vadDetectionMs === undefined ? {} : { vad_detection_ms: this.vadDetectionMs }),
    });
    this.evaluation?.abort();
    const evaluation = new AbortController();
    this.evaluation = evaluation;
    let cancellationRecorded = false;
    let finished = false;
    const finish = (result: AnswerResult) => {
      if (finished) {
        // This answer identity already has its authoritative outcome. Never
        // let an abort-insensitive evaluator overwrite its record or decision.
        this.log("answer.result_ignored", {
          correlation_key: record.key,
          sceneIndex,
          revision: transcriptRevision,
          version,
          decision: "STALE",
          reason: "evaluation_already_resolved",
          elapsed_ms: Date.now() - requestedAt,
        });
        return;
      }
      finished = true;
      clearTimeout(deadline);
      if (result.status === "unavailable" && result.reason === "timeout" && !evaluation.signal.aborted)
        this.log("answer.timeout", {
          sceneIndex,
          revision: transcriptRevision,
          version,
          timeout_ms: EVALUATION_TIMEOUT_MS,
          timeout_deadline_at: requestedAt + EVALUATION_TIMEOUT_MS - this.createdAt,
          elapsed_ms: Date.now() - requestedAt,
        });
      if (this.evaluation === evaluation) this.evaluation = undefined;
      this.decide(
        utterance,
        sceneIndex,
        version,
        finalDeltaAt,
        turnEndAt,
        transcriptRevision,
        evaluation.signal,
        result,
        !cancellationRecorded,
      );
    };
    // Bound application waiting as well as fetch: abort alone cannot settle an
    // evaluator that ignores cancellation. Commit UNAVAILABLE before aborting
    // so the existing revision/scene guards and neutral release path apply.
    const deadline = setTimeout(() => {
      finish({ status: "unavailable", reason: "timeout", latencyMs: Date.now() - requestedAt });
      evaluation.abort();
    }, EVALUATION_TIMEOUT_MS);
    evaluation.signal.addEventListener(
      "abort",
      () => {
        clearTimeout(deadline);
        if (finished) return;
        cancellationRecorded = true;
        this.timeline({
          type: "answer_evaluation_resolved",
          correlationKey,
          sceneIndex,
          status: "unavailable",
          reason: "cancelled",
          latencyMs: Date.now() - requestedAt,
          decision: "STALE",
        });
      },
      { once: true },
    );
    void Promise.resolve()
      .then(() => this.evaluateAnswer({ sceneIndex, utterance: text }, evaluation.signal))
      .catch((): AnswerResult => ({
        status: "unavailable",
        reason: "request_failed",
        latencyMs: Date.now() - requestedAt,
      }))
      .then(finish);
  }

  private scheduleNoTranscriptRecovery(epoch: number) {
    this.cancelNoTranscriptRecovery();
    const transcriptRevision = this.transcriptRevision;
    const sceneIndex = this.snapshot.sceneIndex;
    this.log("answer.no_transcript_scheduled", {
      epoch,
      transcript_revision: transcriptRevision,
      scene_index: sceneIndex,
    });
    this.noTranscriptTimer = setTimeout(() => {
      this.noTranscriptTimer = undefined;
      if (
        this.speechEpoch !== epoch ||
        this.transcriptRevision !== transcriptRevision ||
        this.snapshot.sceneIndex !== sceneIndex ||
        this.transcriptEpoch === epoch ||
        !this.evaluable
      )
        return;
      if (this.evaluation || this.deferredAdvance || this.deferredStay) return;
      this.log("answer.no_transcript", { epoch, transcript_revision: transcriptRevision, scene_index: sceneIndex });
      this.append(
        "session.instructions.append",
        "I could not hear the child's latest answer clearly. Gently ask them to say it again without judging the earlier count or changing the scene.",
      );
    }, TRANSCRIPT_FALLBACK_MS);
  }

  private cancelNoTranscriptRecovery() {
    clearTimeout(this.noTranscriptTimer);
    this.noTranscriptTimer = undefined;
  }

  private decide(
    utterance: Utterance,
    sceneIndex: number,
    version: string,
    finalDeltaAt: number,
    turnEndAt: number,
    transcriptRevision: number,
    evaluationSignal: AbortSignal,
    result: AnswerResult,
    recordResult = true,
  ) {
    // The question was about a moment that may have passed: the child may have
    // said more, or the lesson may have moved on while the answer was in flight.
    const stale =
      !this.evaluable ||
      evaluationSignal.aborted ||
      this.transcriptRevision !== transcriptRevision ||
      this.snapshot.sceneIndex !== sceneIndex ||
      this.latest?.startMs !== utterance.startMs ||
      this.latest.text !== utterance.text;
    const staleReason = !stale
      ? undefined
      : evaluationSignal.aborted
        ? "evaluation_cancelled"
        : this.transcriptRevision !== transcriptRevision
          ? "transcript_revision"
          : this.snapshot.status !== "active" || this.snapshot.sceneIndex !== sceneIndex
            ? "lesson_or_scene_changed"
            : "answer_version_changed";
    const advancing = !stale && shouldAdvance(result);
    // Stale results need no release: newer speech gets its own decision, and a
    // scene change or wrap-up tells GPT-Live itself.
    const releasing = !stale && !advancing;
    const record = this.evaluationRecords.get(
      this.evaluationKey(sceneIndex, transcriptRevision, version, this.latestSourceId),
    );
    if (record) {
      record.result = result;
      record.status = stale ? "superseded" : "resolved";
      record.applicationAction = stale
        ? "SUPERSEDED"
        : result.status === "unavailable"
          ? "UNAVAILABLE"
          : advancing
            ? "ADVANCE"
            : "STAY";
      this.evaluationControl(record, stale ? "result_superseded" : "evaluation_result", {
        result: stale ? "STALE" : result.status,
        applicationAction: record.applicationAction,
        reason: staleReason,
      });
    }
    if (recordResult)
      this.timeline({
        type: "answer_evaluation_resolved",
        correlationKey: `${sceneIndex}:${version}`,
        sceneIndex,
        status: result.status,
        latencyMs: result.latencyMs,
        ...(result.status === "evaluated"
          ? { probability: result.probability, model: result.model }
          : { reason: result.reason }),
        decision: stale ? "STALE" : result.status === "unavailable" ? "UNAVAILABLE" : advancing ? "ADVANCE" : "STAY",
      });
    this.log("answer.evaluated", {
      scene: sceneAt(sceneIndex).id,
      sceneIndex,
      revision: transcriptRevision,
      version,
      utterance: utterance.text,
      ...(result.status === "evaluated"
        ? { probability: result.probability, model: result.model }
        : { unavailable: result.reason }),
      latency_ms: result.latencyMs,
      transcript_to_decision_ms: Date.now() - finalDeltaAt,
      turn_end_to_decision_ms: Date.now() - turnEndAt,
      decision: stale ? "STALE" : result.status === "unavailable" ? "UNAVAILABLE" : advancing ? "ADVANCE" : "STAY",
      stale,
      ...(staleReason ? { stale_reason: staleReason } : {}),
      advancing,
      releasing,
    });
    // An unavailable check leaves the scene alone without judging the child.
    if (advancing) {
      this.deferAdvance(sceneIndex, version, transcriptRevision, utterance.text.trim());
    } else if (releasing) {
      if (result.status === "unavailable" && result.reason === "timeout" && this.answerResponseGate)
        this.answerResponseGate.evaluationTimedOutAt = Date.now();
      this.deferStay(
        sceneIndex,
        version,
        transcriptRevision,
        utterance.text.trim(),
        result.status === "unavailable" ? "UNAVAILABLE" : "STAY",
      );
    }
  }

  private deferAdvance(sceneIndex: number, answerVersion: string, transcriptRevision: number, evaluatedAnswer: string) {
    if (this.deferredAdvance) return;
    this.deferredAdvance = {
      sceneIndex,
      answerVersion,
      evaluatedAnswer,
      approvedAt: Date.now(),
      spokenChars: this.sproutReply.length,
      transcriptRevision,
      correctionReadyAt: Math.max(this.turnEndAt, this.lastDeltaAt) + CORRECTION_WINDOW_MS,
    };
    if (this.microphoneSpeaking && this.microphoneSpeechStartedAt !== undefined)
      this.startDeferredVadGrace(this.microphoneSpeechStartedAt, "active_speech_at_decision");
    this.log("advance.deferred", {
      answer_version: answerVersion,
      scene: sceneAt(sceneIndex).id,
      reason: "correction_window",
      correction_window_ms: CORRECTION_WINDOW_MS,
      spoken_chars: this.sproutReply.length,
    });
    if (this.answerResponseGate) {
      this.answerResponseGate.decision = "ADVANCE";
      this.observeResponseGate("advance_deferred");
    }
    this.scheduleDeferredRelease();
  }

  private scheduleDeferredRelease() {
    clearTimeout(this.deferredTimer);
    const deferred = this.deferredAdvance;
    if (!deferred || this.provisionalActivity) return;
    const releaseAt = this.deferredAdvanceReleaseAt(deferred);
    this.deferredTimer = setTimeout(() => this.releaseDeferredAdvance(), Math.max(0, releaseAt - Date.now()));
  }

  private deferredAdvanceReleaseAt(deferred: DeferredAdvance) {
    return Math.max(deferred.correctionReadyAt, deferred.vadGraceUntil ?? 0);
  }

  private releaseDeferredAdvance() {
    const deferred = this.deferredAdvance;
    if (!deferred || this.provisionalActivity) return;
    this.deferredAdvance = null;
    clearTimeout(this.deferredTimer);
    if (
      this.expireIfOverdue() ||
      this.snapshot.status !== "active" ||
      this.pending ||
      this.transcriptRevision !== deferred.transcriptRevision ||
      `${this.latest?.startMs}:${this.latest?.text.trim()}` !== deferred.answerVersion ||
      this.snapshot.sceneIndex !== deferred.sceneIndex ||
      deferred.sceneIndex >= LAST_SCENE ||
      !this.answerResponseGate ||
      !this.gateMatches({
        sceneIndex: deferred.sceneIndex,
        transcriptRevision: deferred.transcriptRevision,
        answerVersion: deferred.answerVersion,
      })
    )
      return;
    // This is the correction-protected application ADVANCE decision. Audible
    // playback remains gated until the committed scene has been displayed.
    this.log("advance.released", {
      scene: sceneAt(deferred.sceneIndex).id,
      answer_version: deferred.answerVersion,
      spoken_chars_at_approval: deferred.spokenChars,
      delay_ms: Date.now() - deferred.approvedAt,
      reason:
        deferred.vadGraceUntil !== undefined && deferred.vadGraceUntil > deferred.correctionReadyAt
          ? "vad_grace"
          : "correction_window",
    });
    if (deferred.vadGraceUntil !== undefined)
      this.log("answer.vad_grace_expired", { decision: "ADVANCE", answer_version: deferred.answerVersion });
    this.advance(deferred.answerVersion);
  }

  private cancelDeferredAdvance() {
    clearTimeout(this.deferredTimer);
    if (this.deferredAdvance)
      this.log("advance.cancelled", {
        answer_version: this.deferredAdvance.answerVersion,
        delay_ms: Date.now() - this.deferredAdvance.approvedAt,
      });
    this.deferredAdvance = null;
  }

  private deferStay(
    sceneIndex: number,
    answerVersion: string,
    transcriptRevision: number,
    evaluatedAnswer: string,
    decision: "STAY" | "UNAVAILABLE",
  ) {
    if (!this.answerResponseGate) return;
    this.deferredStay = {
      sceneIndex,
      answerVersion,
      evaluatedAnswer,
      transcriptRevision,
      correctionReadyAt: Math.max(this.turnEndAt, this.lastDeltaAt) + CORRECTION_WINDOW_MS,
      decision,
    };
    if (this.microphoneSpeaking && this.microphoneSpeechStartedAt !== undefined)
      this.startDeferredVadGrace(this.microphoneSpeechStartedAt, "active_speech_at_decision");
    this.log("answer.release_deferred", { answer_version: answerVersion, scene: sceneAt(sceneIndex).id });
    this.answerResponseGate.decision = decision;
    this.observeResponseGate("decision_deferred");
    this.scheduleDeferredStayRelease();
  }

  private scheduleDeferredStayRelease() {
    clearTimeout(this.stayTimer);
    const deferred = this.deferredStay;
    if (!deferred || this.provisionalActivity) return;
    const releaseAt = Math.max(
      deferred.correctionReadyAt,
      this.answerResponseGate?.outputQuietAt ?? 0,
      deferred.vadGraceUntil ?? 0,
    );
    this.stayTimer = setTimeout(() => this.releaseDeferredStay(), Math.max(0, releaseAt - Date.now()));
  }

  private releaseDeferredStay() {
    const deferred = this.deferredStay;
    if (
      !deferred ||
      this.answerResponseGate?.outputDiscarded ||
      this.provisionalActivity ||
      (this.answerResponseGate?.sourceIsolationRequired && this.microphoneSpeaking)
    )
      return;
    this.deferredStay = null;
    clearTimeout(this.stayTimer);
    if (
      this.expireIfOverdue() ||
      this.snapshot.status !== "active" ||
      this.pending ||
      this.transcriptRevision !== deferred.transcriptRevision ||
      `${this.latest?.startMs}:${this.latest?.text.trim()}` !== deferred.answerVersion ||
      this.snapshot.sceneIndex !== deferred.sceneIndex ||
      !this.latest ||
      !this.answerResponseGate ||
      !this.gateMatches({
        sceneIndex: deferred.sceneIndex,
        transcriptRevision: deferred.transcriptRevision,
        answerVersion: deferred.answerVersion,
      })
    )
      return;
    const identity = {
      sceneIndex: deferred.sceneIndex,
      transcriptRevision: deferred.transcriptRevision,
      answerVersion: deferred.answerVersion,
    };
    const gate = this.answerResponseGate;
    const releaseAt = Math.max(deferred.correctionReadyAt, gate.outputQuietAt, deferred.vadGraceUntil ?? 0);
    const reason =
      deferred.vadGraceUntil !== undefined && deferred.vadGraceUntil >= releaseAt
        ? "vad_grace"
        : gate.outputQuietAt >= deferred.correctionReadyAt && gate.outputQuietAt > 0
          ? "output_transcript_quiet"
          : "correction_window";
    this.log("answer.release_sent", {
      answer_version: deferred.answerVersion,
      scene: sceneAt(deferred.sceneIndex).id,
      reason,
    });
    if (deferred.vadGraceUntil !== undefined)
      this.log("answer.vad_grace_expired", { decision: deferred.decision, answer_version: deferred.answerVersion });
    this.cancelNoTranscriptRecovery();
    this.releaseAnswerResponseGate(identity, deferred.decision, reason, () => {
      const record = this.findEvaluationRecord(identity);
      this.append(
        "session.instructions.append",
        evaluationResultContext({
          evaluatedAnswer: deferred.evaluatedAnswer,
          evaluatedScene: sceneAt(deferred.sceneIndex),
          transcriptRevision: deferred.transcriptRevision,
          answerVersion: deferred.answerVersion,
          meaning: deferred.decision === "STAY" ? "did_not_meet_advancement_criterion" : "unavailable",
          action: deferred.decision,
          displayedScene: this.scene,
        }),
        null,
        record,
      );
      this.releaseEvaluationRecord(identity, deferred.decision);
    });
  }

  /** Confirmed renewed speech buys one fallback interval for a late transcript. */
  private startDeferredVadGrace(
    speechStartedAt: number,
    reason: "confirmed_speech" | "provisional_confirmation" | "active_speech_at_decision",
  ) {
    const advance = this.deferredAdvance;
    const stay = this.deferredStay;
    if (!advance && !stay) return;
    const decision = advance ? "ADVANCE" : stay!.decision;
    const answerVersion = advance?.answerVersion ?? stay?.answerVersion;
    if (advance?.vadGraceUntil !== undefined || stay?.vadGraceUntil !== undefined) {
      this.log("answer.vad_grace_ignored", { decision, answer_version: answerVersion, reason: "already_active" });
      return;
    }
    const normalReleaseAt = advance
      ? advance.correctionReadyAt
      : Math.max(stay!.correctionReadyAt, this.answerResponseGate?.outputQuietAt ?? 0);
    // Release consumes the deferred object before committing or opening the gate.
    // Its presence, rather than the nominal deadline, protects speech that began
    // before the actual release callback (including while evaluation was pending).
    const graceUntil = speechStartedAt + TRANSCRIPT_FALLBACK_MS;
    if (graceUntil <= normalReleaseAt) {
      this.log("answer.vad_grace_ignored", {
        decision,
        answer_version: answerVersion,
        reason: "too_early",
        candidate_release_at_ms: graceUntil - this.createdAt,
        normal_release_at_ms: normalReleaseAt - this.createdAt,
      });
      return;
    }
    if (advance) advance.vadGraceUntil = graceUntil;
    else stay!.vadGraceUntil = graceUntil;
    this.log("answer.vad_grace_started", {
      reason,
      decision,
      answer_version: answerVersion,
      grace_ms: TRANSCRIPT_FALLBACK_MS,
      added_ms: graceUntil - normalReleaseAt,
      release_at_ms: graceUntil - this.createdAt,
    });
    if (advance) this.scheduleDeferredRelease();
    else this.scheduleDeferredStayRelease();
    this.observeResponseGate("vad_grace_started");
  }

  private cancelDeferredStay() {
    clearTimeout(this.stayTimer);
    if (this.deferredStay) this.log("answer.release_cancelled", { answer_version: this.deferredStay.answerVersion });
    this.deferredStay = null;
  }

  /** The application, not the model, commits the next deterministic scene. */
  private advance(answerVersion: string) {
    this.log("advance.committed", {
      scene_index: this.snapshot.sceneIndex,
      transcript_revision: this.answerResponseGate?.transcriptRevision,
      answer_version: answerVersion,
      turn_end_to_commit_ms: Date.now() - this.turnEndAt,
    });
    if (this.answerResponseGate) {
      this.answerResponseGate.decision = "ADVANCE";
      this.answerResponseGate.sceneCommittedAt = Date.now();
      const record = this.findEvaluationRecord({
        sceneIndex: this.answerResponseGate.sceneIndex,
        transcriptRevision: this.answerResponseGate.transcriptRevision,
        answerVersion: this.answerResponseGate.answerVersion,
      });
      if (record) {
        record.displayStatus = "waiting";
        this.evaluationControl(record, "scene_commit", { applicationAction: "ADVANCE", result: "evaluated" });
      }
      this.observeResponseGate("scene_committed");
    }
    const sceneIndex = this.snapshot.sceneIndex + 1;
    this.timeline({
      type: "scene_advance_committed",
      fromScene: this.snapshot.sceneIndex,
      toScene: sceneIndex,
      correlationKey: `${this.snapshot.sceneIndex}:${answerVersion}`,
    });
    const gate = this.answerResponseGate;
    this.pending = {
      kind: "advance",
      sceneIndex,
      answerVersion,
      turnEndAt: this.turnEndAt,
      gateIdentity: gate
        ? {
            sceneIndex: gate.sceneIndex,
            transcriptRevision: gate.transcriptRevision,
            answerVersion: gate.answerVersion,
          }
        : undefined,
    };
    this.cancelNoTranscriptRecovery();
    this.latest = null;
    this.childSpeech = new TranscriptWindow();
    this.update({ sceneIndex });
  }

  private evaluationKey(sceneIndex: number, revision: number, version: string, sourceId?: number) {
    return `${sceneIndex}|${revision}|${version}|${sourceId ?? "unknown-source"}`;
  }

  private ensureEvaluationRecord(
    sceneIndex: number,
    transcriptRevision: number,
    answerVersion: string,
    utterance: string,
    sourceId?: number,
  ) {
    const key = this.evaluationKey(sceneIndex, transcriptRevision, answerVersion, sourceId);
    let record = this.evaluationRecords.get(key);
    if (!record) {
      record = {
        key,
        sceneIndex,
        transcriptRevision,
        answerVersion,
        utterance,
        sourceId,
        status: "scheduled",
        displayStatus: "not_applicable",
        applicationFeedbackSent: false,
        delegationIds: new Set(),
        linkedResultsSent: new Set(),
        origin: "application",
      };
      this.evaluationRecords.set(key, record);
      while (this.evaluationRecords.size > 40) {
        const oldest = this.evaluationRecords.keys().next().value as string | undefined;
        if (!oldest) break;
        const retired = this.evaluationRecords.get(oldest);
        if (retired) {
          this.evaluationControl(retired, "evaluation_record_evicted", {
            applicationAction: "SUPERSEDED",
            reason: "bounded_evaluation_record_capacity",
          });
          for (const id of retired.delegationIds) {
            this.delegations.delete(id);
            if (retired.sourceId === this.transport.activeSourceId)
              this.append(
                "session.thinking.append",
                "The application's bounded record for this evaluation has expired. Do not use an old result; continue from the currently displayed scene and current application outcome.",
                id,
              );
          }
        }
        this.evaluationRecords.delete(oldest);
      }
    }
    return record;
  }

  private declineDelegation(id: string, sourceId: number, offsetMs: number | undefined, reason: string) {
    this.delegations.set(id, { id, sourceId, offsetMs: offsetMs ?? -1 });
    this.log("evaluation.delegation_rejected", {
      delegation_id: id,
      source_id: sourceId,
      offset_ms: offsetMs ?? null,
      reason,
    });
    this.evaluationControl(undefined, "delegation_rejected", {
      delegationId: id,
      sourceId,
      ...(offsetMs === undefined ? {} : { offsetMs }),
      reason,
    });
    this.append(
      "session.thinking.append",
      "This evaluation request could not be matched unambiguously to a current counting answer. No evaluation result was produced; continue from the scene currently displayed and wait for the app's outcome if one is pending.",
      id,
    );
  }

  private handleDelegation(id: string, offsetMs: number | undefined, sourceId: number | undefined) {
    if (this.delegations.has(id)) {
      this.log("evaluation.delegation_duplicate", { delegation_id: id, source_id: sourceId ?? null });
      return;
    }
    if (this.delegations.size >= MAX_DELEGATION_HANDLES) {
      this.log("evaluation.delegation_rejected", {
        delegation_id: id,
        source_id: sourceId ?? null,
        offset_ms: offsetMs ?? null,
        reason: "delegation_handle_capacity_reached",
      });
      this.evaluationControl(undefined, "delegation_rejected", {
        delegationId: id,
        ...(sourceId === undefined ? {} : { sourceId }),
        ...(offsetMs === undefined ? {} : { offsetMs }),
        reason: "delegation_handle_capacity_reached",
      });
      return;
    }
    const activeSourceId = this.transport.activeSourceId;
    // BrowserTransport stamps provider events with an application-owned source
    // ID. Missing or retired-source identity can never authorize work or be
    // forwarded through whichever source happens to be active now.
    if (sourceId === undefined || activeSourceId === undefined || sourceId !== activeSourceId) {
      this.log("evaluation.delegation_rejected", {
        delegation_id: id,
        source_id: sourceId ?? null,
        active_source_id: activeSourceId ?? null,
        offset_ms: offsetMs ?? null,
        reason: "unknown_or_retired_source",
      });
      this.evaluationControl(undefined, "delegation_rejected", {
        delegationId: id,
        ...(sourceId === undefined ? {} : { sourceId }),
        ...(offsetMs === undefined ? {} : { offsetMs }),
        reason: "unknown_or_retired_source",
      });
      this.delegations.set(id, { id, sourceId: sourceId ?? -1, offsetMs: offsetMs ?? -1 });
      return;
    }
    if (offsetMs === undefined || !Number.isFinite(offsetMs) || offsetMs < 0) {
      this.declineDelegation(id, sourceId, offsetMs, "missing_or_invalid_provider_offset");
      return;
    }
    // Select by provider-clock transcript history instead of assigning every
    // request to `latest`. Revisions share an utterance start, so the newest
    // observed revision at the delegation offset is the only candidate.
    const candidates = this.childTranscriptHistory
      .filter(entry => entry.sourceId === sourceId && entry.startMs <= offsetMs)
      .sort((left, right) => right.startMs - left.startMs || right.transcriptRevision - left.transcriptRevision);
    const candidate = candidates[0];
    if (!candidate || candidate.endMs > offsetMs) {
      this.declineDelegation(id, sourceId, offsetMs, "offset_does_not_identify_a_settled_transcript");
      return;
    }
    if (offsetMs - candidate.endMs > DELEGATION_ASSOCIATION_MAX_AGE_MS) {
      this.declineDelegation(id, sourceId, offsetMs, "delegation_offset_is_stale_for_the_matched_answer");
      return;
    }
    if (!candidate.answerBearing) {
      this.declineDelegation(id, sourceId, offsetMs, "latest_transcript_at_offset_is_not_counting_answer");
      return;
    }
    if (candidate.sceneIndex >= LAST_SCENE || this.snapshot.status !== "active") {
      this.declineDelegation(id, sourceId, offsetMs, "no_applicable_evaluation_phase");
      return;
    }
    const record = this.evaluationRecords.get(
      this.evaluationKey(candidate.sceneIndex, candidate.transcriptRevision, candidate.answerVersion, sourceId),
    );
    if (!record || record.status === "superseded" || record.applicationAction === "SUPERSEDED") {
      this.declineDelegation(id, sourceId, offsetMs, "transcript_identity_is_stale_or_superseded");
      return;
    }
    if (
      candidate.sceneIndex !== this.snapshot.sceneIndex &&
      !record.applicationFeedbackSent &&
      !(record.applicationAction === "ADVANCE" && record.displayStatus === "waiting")
    ) {
      this.declineDelegation(id, sourceId, offsetMs, "answer_scene_is_no_longer_applicable");
      return;
    }
    if (record.origin === "application") record.origin = "both";
    record.delegationIds.add(id);
    this.delegations.set(id, { id, sourceId, offsetMs, recordKey: record.key });
    this.evaluationControl(record, "delegation_associated", { delegationId: id, offsetMs, sourceId });
    if (record.applicationFeedbackSent) this.sendLinkedEvaluationResult(record, id);
  }

  private supersedeEvaluation(identity: GateIdentity, reason: string, notify: boolean, sourceId = this.latestSourceId) {
    const record = this.evaluationRecords.get(
      this.evaluationKey(identity.sceneIndex, identity.transcriptRevision, identity.answerVersion, sourceId),
    );
    if (!record || record.status === "superseded") return;
    record.status = "superseded";
    const committedAdvance = record.applicationAction === "ADVANCE" && record.displayStatus === "confirmed";
    if (!committedAdvance) record.applicationAction = "SUPERSEDED";
    this.evaluationControl(record, "superseded", {
      applicationAction: committedAdvance ? "ADVANCE" : "SUPERSEDED",
      reason: committedAdvance ? "pending_delegation_work_superseded_after_displayed_advance" : reason,
    });
    for (const id of record.delegationIds) {
      if (!notify || record.sourceId !== this.transport.activeSourceId) continue;
      this.append(
        "session.thinking.append",
        committedAdvance
          ? `Earlier answer "${record.utterance}" about ${sceneAt(record.sceneIndex).quantity} ${objectName(sceneAt(record.sceneIndex))} (${sceneAt(record.sceneIndex).id}) committed ADVANCE, and the app displayed ${sceneAt(record.displayedSceneIndex ?? this.snapshot.sceneIndex).quantity} ${objectName(sceneAt(record.displayedSceneIndex ?? this.snapshot.sceneIndex))} (${sceneAt(record.displayedSceneIndex ?? this.snapshot.sceneIndex).id}). A newer answer now owns the displayed scene. This delegation's pending work is superseded; do not use the earlier evaluation as authority for the newer answer, repeat a correctness acknowledgment, or change the displayed scene. Follow only the app's outcome for the newer answer.`
          : "This answer was corrected or superseded before it became authoritative. Disregard any pending evaluation for it; use only the app's outcome for the current answer and displayed scene.",
        id,
        record,
      );
    }
    record.delegationIds.clear();
  }

  private invalidatePendingEvaluations(reason: string, notify: boolean) {
    for (const record of this.evaluationRecords.values()) {
      if (record.status === "superseded" || record.applicationFeedbackSent) continue;
      record.status = "superseded";
      record.applicationAction = "SUPERSEDED";
      this.evaluationControl(record, "invalidated", { applicationAction: "SUPERSEDED", reason });
      for (const id of record.delegationIds) {
        if (!notify || record.sourceId !== this.transport.activeSourceId) continue;
        this.append(
          "session.thinking.append",
          "The lesson phase changed before this answer could become authoritative. Disregard any pending evaluation and follow only the app's current lesson instruction.",
          id,
        );
      }
      record.delegationIds.clear();
    }
  }

  private retireEvaluationDelegations(sourceId: number | undefined, replacementSourceId: number) {
    if (sourceId === undefined) return;
    for (const record of this.evaluationRecords.values()) {
      if (record.sourceId !== sourceId || record.delegationIds.size === 0) continue;
      for (const id of record.delegationIds)
        this.evaluationControl(record, "delegation_handle_retired", {
          delegationId: id,
          reason: `source_replaced_by_${replacementSourceId}; handle_not_forwarded`,
        });
      record.delegationIds.clear();
    }
  }

  private sendLinkedEvaluationResult(record: EvaluationRecord, id: string) {
    if (
      record.linkedResultsSent.has(id) ||
      record.status !== "resolved" ||
      !record.applicationFeedbackSent ||
      record.applicationAction === undefined ||
      (record.applicationAction === "ADVANCE" && record.displayStatus !== "confirmed") ||
      record.sourceId !== this.transport.activeSourceId
    )
      return;
    const result = record.result;
    if (!result) return;
    const meaning =
      result.status === "unavailable"
        ? "evaluation was unavailable"
        : record.applicationAction === "ADVANCE"
          ? "the answer met the advancement criterion"
          : "the answer did not meet the advancement criterion";
    const outcomeScene = sceneAt(record.displayedSceneIndex ?? this.snapshot.sceneIndex);
    const currentScene = this.scene;
    const content = `Linked application result for the child's answer "${record.utterance}" about ${sceneAt(record.sceneIndex).quantity} ${objectName(sceneAt(record.sceneIndex))} (${sceneAt(record.sceneIndex).id}), transcript revision ${record.transcriptRevision}, answer version "${record.answerVersion}": ${meaning}; the app committed ${record.applicationAction}. After this outcome, the app confirmed ${outcomeScene.quantity} ${objectName(outcomeScene)} (${outcomeScene.id}) on screen. Currently displayed: ${currentScene.quantity} ${objectName(currentScene)} (${currentScene.id}). The app has already sent its next-feedback instruction; do not repeat or add another correctness acknowledgment.`;
    if (!this.append("session.thinking.append", content, id, record)) return;
    record.linkedResultsSent.add(id);
    this.evaluationControl(record, "linked_result_sent", {
      delegationId: id,
      applicationAction: record.applicationAction,
      result: result.status,
    });
  }

  private findEvaluationRecord(identity: GateIdentity) {
    const activeKey = this.evaluationKey(
      identity.sceneIndex,
      identity.transcriptRevision,
      identity.answerVersion,
      this.latestSourceId,
    );
    const exact = this.evaluationRecords.get(activeKey);
    if (exact) return exact;
    return [...this.evaluationRecords.values()].find(
      candidate =>
        candidate.sceneIndex === identity.sceneIndex &&
        candidate.transcriptRevision === identity.transcriptRevision &&
        candidate.answerVersion === identity.answerVersion &&
        candidate.status !== "superseded",
    );
  }

  private contextAcknowledged(
    name: string,
    clientEventId: string | undefined,
    sourceId: number | undefined,
    startMs: number | undefined,
    endMs: number | undefined,
  ) {
    const command = clientEventId ? this.contextCommands.get(clientEventId) : undefined;
    const state = !clientEventId
      ? "missing"
      : !command || command.sourceId !== sourceId
        ? "stale"
        : this.acknowledgedContextCommands.has(clientEventId)
          ? "duplicate"
          : "estimated_injection";
    if (clientEventId && state === "estimated_injection") this.acknowledgedContextCommands.add(clientEventId);
    const record = command?.recordKey ? this.evaluationRecords.get(command.recordKey) : undefined;
    this.log(name, {
      client_event_id: clientEventId ?? null,
      source_id: sourceId ?? null,
      start_ms: startMs ?? null,
      end_ms: endMs ?? null,
      acknowledgment: state,
      semantics: "estimated_context_injection_only",
    });
    this.evaluationControl(record, "context_acknowledgment", {
      ...(clientEventId ? { contextEventId: clientEventId } : {}),
      ...(command?.delegationId ? { delegationId: command.delegationId } : {}),
      ...(sourceId === undefined ? {} : { sourceId }),
      ackState: state,
      reason: "estimated_injection_is_not_speech_or_playback_evidence",
    });
  }

  private contextCommandFailed(clientEventId: string, sourceId: number | undefined, code?: string) {
    const command = this.contextCommands.get(clientEventId);
    const record = command?.recordKey ? this.evaluationRecords.get(command.recordKey) : undefined;
    const current = Boolean(command && command.sourceId === sourceId);
    this.evaluationControl(record, "context_acknowledgment", {
      contextEventId: clientEventId,
      ...(command?.delegationId ? { delegationId: command.delegationId } : {}),
      ...(sourceId === undefined ? {} : { sourceId }),
      ackState: current ? "error" : "stale",
      reason: code ?? "provider_rejected_context_command",
    });
  }

  private recordMissingContextAcks(record: EvaluationRecord) {
    for (const [id, command] of this.contextCommands) {
      if (
        command.recordKey !== record.key ||
        this.acknowledgedContextCommands.has(id) ||
        this.missingContextCommands.has(id)
      )
        continue;
      this.missingContextCommands.add(id);
      this.evaluationControl(record, "context_acknowledgment", {
        contextEventId: id,
        ...(command.delegationId ? { delegationId: command.delegationId } : {}),
        ackState: "missing",
        reason: "no_acknowledgment_observed_before_application_release",
      });
    }
  }

  private releaseEvaluationRecord(identity: GateIdentity, action: "ADVANCE" | "STAY" | "UNAVAILABLE") {
    const record = this.findEvaluationRecord(identity);
    if (!record || record.status !== "resolved") return;
    record.applicationAction = action;
    record.applicationFeedbackSent = true;
    record.displayStatus = action === "ADVANCE" ? "confirmed" : "not_applicable";
    record.displayedSceneIndex = this.snapshot.sceneIndex;
    this.recordMissingContextAcks(record);
    this.evaluationControl(record, "application_outcome_released", {
      applicationAction: action,
      result: record.result?.status,
    });
    for (const id of record.delegationIds) this.sendLinkedEvaluationResult(record, id);
  }

  // Called after React commits and the browser has a paint opportunity.
  displayed(sceneIndex: number) {
    if (this.expireIfOverdue()) return;
    const pending = this.pending;
    if (!pending || pending.sceneIndex !== sceneIndex) return;
    this.pending = null;
    this.log("scene.displayed", this.scene);
    if (pending.kind === "greeting") {
      this.initialSceneDisplayed = true;
      this.startup("startup.initial_scene_displayed");
      if (this.ready) this.recordDisplayedScene();
      this.sendInitialInstruction();
      return;
    }
    this.recordDisplayedScene();
    if (pending.answerVersion)
      this.log("advance.displayed", {
        scene_index: pending.sceneIndex - 1,
        transcript_revision: pending.gateIdentity?.transcriptRevision,
        answer_version: pending.answerVersion,
        turn_end_to_display_ms: Date.now() - (pending.turnEndAt ?? this.turnEndAt),
      });
    if (pending.gateIdentity) {
      const record = this.findEvaluationRecord(pending.gateIdentity);
      if (record) {
        record.displayStatus = "confirmed";
        this.evaluationControl(record, "scene_display_confirmed", { applicationAction: "ADVANCE" });
      }
    }
    switch (pending.kind) {
      case "advance":
        if (!pending.gateIdentity || !this.gateMatches(pending.gateIdentity)) return;
        this.displayedRelease = {
          gateIdentity: pending.gateIdentity,
          sceneIndex,
          displayedAt: Date.now(),
        };
        if (this.answerResponseGate) {
          this.answerResponseGate.sceneDisplayedAt = Date.now();
          this.observeResponseGate("scene_displayed");
        }
        this.scheduleDisplayedRelease();
        return;
      default: {
        const unhandled: never = pending.kind;
        throw new Error(`Unhandled pending display: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  private recordDisplayedScene() {
    const object = OBJECTS[this.scene.object];
    this.record({
      type: "scene_displayed",
      sceneId: this.scene.id,
      targetQuantity: this.scene.quantity,
      items: Array.from({ length: this.scene.quantity }, () => ({ emoji: object.emoji, label: object.singular })),
      arrangement: "Centered flex row, wrapping in display order",
    });
  }

  private scheduleDisplayedRelease() {
    clearTimeout(this.displayedReleaseTimer);
    const deferred = this.displayedRelease;
    const gate = this.answerResponseGate;
    if (!deferred || !gate) return;
    if (gate.outputDiscarded) return;
    if (gate.sourceIsolationRequired && (this.provisionalActivity || this.microphoneSpeaking)) return;
    const releaseAt = Math.max(deferred.displayedAt, gate.outputQuietAt);
    const release = () => {
      if (this.expireIfOverdue()) return;
      const current = this.displayedRelease;
      if (
        !current ||
        current !== deferred ||
        this.snapshot.status !== "active" ||
        this.snapshot.sceneIndex !== deferred.sceneIndex ||
        !this.gateMatches(deferred.gateIdentity)
      )
        return;
      const reason = gate.outputQuietAt > deferred.displayedAt ? "output_transcript_quiet" : "scene_displayed";
      this.displayedRelease = null;
      this.releaseAnswerResponseGate(deferred.gateIdentity, "ADVANCE", reason, () => {
        const record = this.findEvaluationRecord(deferred.gateIdentity);
        this.append(
          "session.instructions.append",
          evaluationResultContext({
            evaluatedAnswer: this.answerResponseGate?.childUtterance ?? "",
            evaluatedScene: sceneAt(deferred.gateIdentity.sceneIndex),
            transcriptRevision: deferred.gateIdentity.transcriptRevision,
            answerVersion: deferred.gateIdentity.answerVersion,
            meaning: "met_advancement_criterion",
            action: "ADVANCE",
            displayedScene: this.scene,
          }),
          null,
          record,
        );
        this.releaseEvaluationRecord(deferred.gateIdentity, "ADVANCE");
      });
    };
    const delay = releaseAt - Date.now();
    if (delay <= 0) release();
    else this.displayedReleaseTimer = setTimeout(release, delay);
  }

  private wrap() {
    if (this.snapshot.status !== "active") return;
    if (this.answerResponseGate?.sourceIsolationRequired) {
      this.fail("Sprout could not safely finish its voice. This attempt has ended; you can start a new lesson.");
      return;
    }
    this.cancelAnswerResponseGate("wrap_up");
    this.invalidatePendingEvaluations("wrap_up", true);
    this.cancelNoTranscriptRecovery();
    this.cancelDeferredAdvance();
    this.cancelDeferredStay();
    this.update({ status: "wrapping" });
    this.log("lesson.wrap_up");
    this.append(
      "session.instructions.append",
      "We have played for four and a half minutes. Gently finish this exchange. No new scenes or questions after it. We will say goodbye shortly.",
    );
  }

  private goodbye() {
    if (this.snapshot.status === "ended") return;
    if (this.answerResponseGate?.sourceIsolationRequired) {
      this.fail("Sprout could not safely finish its voice. This attempt has ended; you can start a new lesson.");
      return;
    }
    this.cancelAnswerResponseGate("goodbye");
    this.invalidatePendingEvaluations("goodbye", true);
    this.cancelNoTranscriptRecovery();
    this.cancelDeferredAdvance();
    this.cancelDeferredStay();
    this.update({ status: "goodbye" });
    this.log("lesson.goodbye_requested");
    this.append(
      "session.instructions.append",
      "The lesson is finished. Say a brief warm goodbye now, then remain quiet. No questions, new activities, or delegation.",
    );
  }

  fail(message: string) {
    if (this.snapshot.status !== "ended") this.end("connection_failure", message);
  }

  end(reason: EndReason, error?: string) {
    if (this.snapshot.status === "ended" || this.ending) return;
    this.ending = true;
    // Stop physical media before gate cancellation can request an unmute.
    this.transport.stopMedia();
    const remaining = this.startedAt === undefined ? TIMING.hard : TIMING.hard - (Date.now() - this.startedAt);
    if (remaining <= 0) reason = "time_limit";
    for (const speaker of ["child", "sprout"] as const) {
      clearTimeout(this.utteranceTimers[speaker]);
      this.flushUtterance(speaker, "interrupted");
    }
    if (this.recorder && this.startedAt === undefined)
      this.recording.enqueue("capture", async () => {
        throw new Error("Attempt ended before live audio capture");
      });
    this.invalidatePendingEvaluations(reason, false);
    this.evaluation?.abort();
    this.cancelAnswerResponseGate(reason);
    if (this.recorder)
      this.recording.enqueue("finalize", () => this.recorder!.finalize(reason, this.recording.incomplete));
    clearTimeout(this.startupTimer);
    clearTimeout(this.settleTimer);
    if (this.scheduledEvaluation)
      this.log("answer.evaluation_cancelled", { ...this.scheduledEvaluation, reason: "session_ended" });
    this.scheduledEvaluation = undefined;
    this.cancelNoTranscriptRecovery();
    this.provisionalActivity = false;
    this.cancelDeferredAdvance();
    this.cancelDeferredStay();
    this.phaseTimers.forEach(clearTimeout);
    this.evaluation?.abort();
    this.pending = null;
    this.log("lesson.ended", { reason });
    // External input was invalidated before stopping media; now publish the ending.
    this.update({ status: "ended", reason, error });
    if (this.recorder)
      this.recording.enqueue("attachRecording", async () => {
        const audio = await this.transport.recording?.();
        if (!audio) throw new Error("No usable full-session audio recording");
        await this.recorder!.attachRecording(audio);
      });
    if (
      this.ready &&
      GRACEFUL_CLOSE[reason] &&
      this.dispatch({ type: "session.close", event_id: `sprout_close_${++this.commands}` })
    ) {
      // Media is already stopped; briefly keep only transport for final usage.
      this.closeTimer = setTimeout(
        () => {
          this.log("connection.finalization_unconfirmed");
          this.close();
        },
        Math.min(1500, remaining),
      );
      return;
    }
    this.log("connection.finalization_unconfirmed");
    this.close();
  }

  dispose() {
    this.end("page_hidden");
    this.close();
  }

  private close() {
    clearTimeout(this.closeTimer);
    if (this.closed) return;
    this.closed = true;
    this.transport.close();
  }

  report(browser: string) {
    return {
      model: MODEL,
      promptVersion: PROMPT_VERSION,
      createdAt: new Date(this.createdAt).toISOString(),
      liveStartedAtMs: this.startedAt === undefined ? null : this.startedAt - this.createdAt,
      startup: startupTiming(this.startupEvents),
      ending: this.snapshot.reason,
      browser,
      note: "Prototype diagnostics only. Transcript timing is approximate; speaker identity and audio delivery are unverified. This download excludes the separately retained session audio and contains no learning conclusions.",
      events: [...this.events],
    };
  }
}
