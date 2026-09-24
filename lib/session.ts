import {
  CORRECTION_WINDOW_MS,
  MICROPHONE_QUIET_MS,
  TRANSCRIPT_FALLBACK_MS,
  TRANSCRIPT_TAIL_MS,
  shouldAdvance,
  type AnswerResult,
  type EvaluateAnswer,
} from "./answer";
import type { ClientCommand, ProviderEvent, TranscriptEvent } from "./events";
import {
  BRIEF_ACK_WORDS,
  LAST_SCENE,
  MODEL,
  PROMPT_VERSION,
  TIMING,
  advanceContext,
  evaluationUnavailableContext,
  sceneAt,
  sceneContext,
  stayContext,
} from "./lesson";
import {
  TranscriptWindow,
  UTTERANCE_GAP_MS,
  mentionsNumber,
  requestsStop,
  saidGoodbye,
  type Utterance,
} from "./transcript";

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
};
export type Diagnostic = { at: number; type: string; detail?: unknown };

export interface Transport {
  start(onEvent: (event: ProviderEvent) => void, onFailure: (message: string) => void): Promise<void>;
  send(command: ClientCommand): void;
  stopMedia(): void;
  close(): void;
}

/** What the app is waiting to see on screen before it speaks about it. */
type PendingDisplay = { kind: "greeting" | "advance"; sceneIndex: number; answerVersion?: string; turnEndAt?: number };
type DeferredAdvance = {
  sceneIndex: number;
  answerVersion: string;
  approvedAt: number;
  spokenChars: number;
  speechEpoch: number;
  correctionReadyAt: number;
  outputQuietAt: number;
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
  private seen = new Set<string>();
  private delegations = new Set<string>();
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
  private provisionalActivity = false;
  private speechEpoch = 0;
  private transcriptEpoch = -1;
  private transcriptRevision = 0;
  private activityTranscriptRevision = 0;
  private activityRecoveryUntil = 0;
  private recoveryTimer?: ReturnType<typeof setTimeout>;
  private noTranscriptTimer?: ReturnType<typeof setTimeout>;
  private heldDecision?: () => void;
  private evaluated = new Set<string>();
  private evaluation?: AbortController;
  // What Sprout has said since the child last spoke, to tell a held turn from
  // one it has already taken.
  private sproutReply = "";
  private commands = 0;
  private closed = false;
  private ready = false;

  constructor(
    private transport: Transport,
    private evaluateAnswer: EvaluateAnswer,
    private changed: (snapshot: Snapshot) => void,
    private diagnosticChanged?: () => void,
  ) {}

  private get scene() {
    return sceneAt(this.snapshot.sceneIndex);
  }

  log(type: string, detail?: unknown) {
    // Bounded, in-memory prototype diagnostics; no raw audio or SDP.
    if (this.events.length >= 8000) this.events.shift();
    this.events.push({ at: Date.now() - this.createdAt, type, detail });
    if (type.startsWith("answer.") || type.startsWith("advance.") || type === "scene.displayed")
      this.diagnosticChanged?.();
  }

  async start() {
    this.log("attempt.started", { model: MODEL, prompt: PROMPT_VERSION });
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
  ) {
    if (this.snapshot.status === "ended") return;
    const sent = this.dispatch({ type, event_id: `sprout_${++this.commands}`, content, delegation_id: delegationId });
    if (!sent) this.fail("The voice connection was lost. You can start a new lesson.");
  }

  /** Guards the entry points where late external input can still arrive. */
  private expireIfOverdue() {
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
      case "session.started":
        this.begin();
        return;
      case "provider.error":
        this.log("provider.error", { code: event.code });
        this.fail("The voice service reported a problem. This attempt has ended.");
        return;
      case "transcript":
        this.heard(event);
        return;
      case "microphone.activity_started":
        if (this.microphoneSpeaking || this.provisionalActivity) return;
        this.provisionalActivity = true;
        this.activityTranscriptRevision = this.transcriptRevision;
        clearTimeout(this.settleTimer);
        clearTimeout(this.deferredTimer);
        clearTimeout(this.recoveryTimer);
        clearTimeout(this.noTranscriptTimer);
        this.log("answer.activity_started");
        return;
      case "microphone.activity_discarded": {
        if (!this.provisionalActivity) return;
        this.provisionalActivity = false;
        const heardNewTranscript = this.transcriptRevision !== this.activityTranscriptRevision;
        this.activityRecoveryUntil = Date.now() + TRANSCRIPT_FALLBACK_MS;
        this.log("answer.activity_discarded", { heard_new_transcript: heardNewTranscript });
        if (heardNewTranscript) {
          this.heldDecision = undefined;
          this.evaluation?.abort();
          if (this.latest) this.scheduleEvaluation(this.latest, TRANSCRIPT_FALLBACK_MS);
        } else if (this.deferredAdvance) this.scheduleDeferredRelease();
        else if (this.heldDecision) this.scheduleHeldDecision();
        else if (!this.evaluation && this.latest) this.scheduleEvaluation(this.latest, TRANSCRIPT_FALLBACK_MS);
        return;
      }
      case "microphone.speech_started":
        if (this.microphoneSpeaking) return;
        const heardDuringActivity =
          this.provisionalActivity && this.transcriptRevision !== this.activityTranscriptRevision;
        this.provisionalActivity = false;
        this.microphoneSpeaking = true;
        this.speechEpoch++;
        if (heardDuringActivity) this.transcriptEpoch = this.speechEpoch;
        this.activityRecoveryUntil = 0;
        this.heldDecision = undefined;
        clearTimeout(this.recoveryTimer);
        clearTimeout(this.noTranscriptTimer);
        this.vadDetectionMs = undefined;
        clearTimeout(this.settleTimer);
        this.evaluation?.abort();
        this.cancelDeferredAdvance();
        this.log("answer.speech_started", { epoch: this.speechEpoch });
        return;
      case "microphone.speech_stopped":
        if (!this.microphoneSpeaking) return;
        this.microphoneSpeaking = false;
        this.turnEndAt = Date.now();
        this.vadDetectionMs = event.quietMs;
        this.turnSignal = "microphone_vad";
        this.log("answer.turn_end", {
          signal: this.turnSignal,
          quiet_threshold_ms: MICROPHONE_QUIET_MS,
          vad_detection_ms: event.quietMs,
          estimated_acoustic_end_at: this.turnEndAt - event.quietMs - this.createdAt,
        });
        if (this.latest && this.transcriptEpoch === this.speechEpoch)
          this.scheduleEvaluation(this.latest, TRANSCRIPT_TAIL_MS);
        else if (this.latest) this.scheduleNoTranscriptRecovery(this.speechEpoch);
        return;
      case "delegation":
        this.refuseDelegation(event.id);
        return;
      case "delegation.unsupported":
        this.log("action.rejected", "Invalid delegation");
        return;
      case "context.appended":
        this.log(event.name, { client_event_id: event.clientEventId, start_ms: event.startMs, end_ms: event.endMs });
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
    this.log("lesson.started");
    this.pending = { kind: "greeting", sceneIndex: 0 };
    this.update({ status: "active" });
    const phases: [number, () => void][] = [
      [TIMING.wrap, () => this.wrap()],
      [TIMING.goodbye, () => this.goodbye()],
      [TIMING.finish, () => this.end("wrap_up")],
      [TIMING.hard, () => this.end("time_limit")],
    ];
    this.phaseTimers = phases.map(([delay, run]) => setTimeout(run, delay));
  }

  private heard(event: TranscriptEvent) {
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
    this.sproutReply = fromChild ? "" : this.sproutReply + event.delta;
    if (fromChild) {
      // A transcript can arrive before local VAD notices renewed speech.
      this.transcriptRevision++;
      this.heldDecision = undefined;
      this.activityRecoveryUntil = 0;
      clearTimeout(this.recoveryTimer);
      clearTimeout(this.noTranscriptTimer);
      this.evaluation?.abort();
      this.cancelDeferredAdvance();
      this.latest = utterance;
      this.lastDeltaAt = Date.now();
      this.transcriptEpoch = this.speechEpoch;
      if (requestsStop(utterance.text)) this.end("child_stop");
      else {
        // Provider transcript delivery can lag VAD; each fragment after the
        // latest detected stop restarts the short tail regardless of arrival time.
        if (this.provisionalActivity) return;
        if (this.speechEpoch > 0 && this.turnSignal === "microphone_vad" && !this.microphoneSpeaking)
          this.scheduleEvaluation(utterance, TRANSCRIPT_TAIL_MS);
        else if (!this.microphoneSpeaking) this.scheduleEvaluation(utterance, TRANSCRIPT_FALLBACK_MS);
      }
    } else if (this.snapshot.status !== "goodbye" && saidGoodbye(utterance.text)) {
      // The model ending the lesson itself, usually a stop request the
      // transcript guard could not recognize. Not proof of playback.
      this.end("model_goodbye");
    } else if (this.deferredAdvance) {
      this.scheduleDeferredRelease(true);
    }
  }

  private scheduleEvaluation(utterance: Utterance, delay: number) {
    clearTimeout(this.settleTimer);
    this.log("answer.candidate", {
      sceneIndex: this.snapshot.sceneIndex,
      utterance: utterance.text,
      version: `${utterance.startMs}:${utterance.text.trim()}`,
      signal: delay === TRANSCRIPT_TAIL_MS ? "microphone_vad" : "transcript_fallback",
      transcript_at: this.lastDeltaAt - this.createdAt,
    });
    this.settleTimer = setTimeout(() => {
      if (this.microphoneSpeaking || this.provisionalActivity) return;
      if (delay === TRANSCRIPT_FALLBACK_MS) {
        this.turnEndAt = Date.now();
        this.vadDetectionMs = undefined;
        this.turnSignal = "transcript_fallback";
        this.log("answer.turn_end", { signal: this.turnSignal });
      }
      this.evaluate(utterance);
    }, delay);
  }

  /** True while the app could act on an answer about the displayed scene. */
  private get evaluable() {
    return (
      this.snapshot.status === "active" &&
      !this.provisionalActivity &&
      !this.pending &&
      !this.deferredAdvance &&
      this.snapshot.sceneIndex < LAST_SCENE
    );
  }

  private evaluate(utterance: Utterance) {
    const text = utterance.text.trim();
    if (!this.evaluable || !text) return;
    // A revised answer is a different version of the same utterance, so it is
    // judged again; an unchanged one never is.
    const version = `${utterance.startMs}:${text}`;
    if (this.evaluated.has(version)) return;
    this.evaluated.add(version);
    if (!mentionsNumber(text)) {
      this.log("answer.skipped", { version, reason: "no_count" });
      return;
    }
    const sceneIndex = this.snapshot.sceneIndex;
    const finalDeltaAt = this.lastDeltaAt;
    const turnEndAt = this.turnEndAt;
    const speechEpoch = this.speechEpoch;
    this.log("answer.requesting", {
      version,
      signal: this.turnSignal,
      turn_end_at: turnEndAt - this.createdAt,
      transcript_to_request_ms: Date.now() - finalDeltaAt,
      turn_end_to_request_ms: Date.now() - turnEndAt,
      ...(this.vadDetectionMs === undefined ? {} : { vad_detection_ms: this.vadDetectionMs }),
    });
    this.evaluation?.abort();
    const evaluation = new AbortController();
    this.evaluation = evaluation;
    void this.evaluateAnswer({ sceneIndex, utterance: text }, evaluation.signal).then(result => {
      if (this.evaluation === evaluation) this.evaluation = undefined;
      this.holdOrDecide(() =>
        this.decide(utterance, sceneIndex, version, finalDeltaAt, turnEndAt, speechEpoch, evaluation.signal, result),
      );
    });
  }

  private holdOrDecide(decision: () => void) {
    if (this.provisionalActivity || Date.now() < this.activityRecoveryUntil) {
      this.heldDecision = decision;
      if (!this.provisionalActivity) this.scheduleHeldDecision();
    } else decision();
  }

  private scheduleHeldDecision() {
    clearTimeout(this.recoveryTimer);
    this.recoveryTimer = setTimeout(
      () => {
        const decision = this.heldDecision;
        this.heldDecision = undefined;
        decision?.();
      },
      Math.max(0, this.activityRecoveryUntil - Date.now()),
    );
  }

  private scheduleNoTranscriptRecovery(epoch: number) {
    clearTimeout(this.noTranscriptTimer);
    this.noTranscriptTimer = setTimeout(() => {
      if (this.speechEpoch !== epoch || this.transcriptEpoch === epoch || !this.evaluable) return;
      this.log("answer.no_transcript", { epoch });
      this.append(
        "session.instructions.append",
        "I could not hear the child's latest answer clearly. Gently ask them to say it again without judging the earlier count or changing the scene.",
      );
    }, TRANSCRIPT_FALLBACK_MS);
  }

  private decide(
    utterance: Utterance,
    sceneIndex: number,
    version: string,
    finalDeltaAt: number,
    turnEndAt: number,
    speechEpoch: number,
    evaluationSignal: AbortSignal,
    result: AnswerResult,
  ) {
    // The question was about a moment that may have passed: the child may have
    // said more, or the lesson may have moved on while the answer was in flight.
    const stale =
      !this.evaluable ||
      evaluationSignal.aborted ||
      this.microphoneSpeaking ||
      this.speechEpoch !== speechEpoch ||
      this.snapshot.sceneIndex !== sceneIndex ||
      this.latest?.startMs !== utterance.startMs ||
      this.latest.text !== utterance.text;
    const advancing = !stale && shouldAdvance(result);
    // Stale results need no release: newer speech gets its own decision, and a
    // scene change or wrap-up tells GPT-Live itself.
    const releasing = !stale && !advancing && this.holding(utterance);
    this.log("answer.evaluated", {
      scene: sceneAt(sceneIndex).id,
      sceneIndex,
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
      advancing,
      releasing,
    });
    // An unavailable check leaves the scene alone without judging the child.
    if (advancing) {
      this.deferAdvance(sceneIndex, version);
    } else if (releasing)
      this.append(
        "session.instructions.append",
        result.status === "unavailable" ? evaluationUnavailableContext(this.scene) : stayContext(this.scene),
      );
  }

  /**
   * Whether GPT-Live is pausing for this decision, as its prompt asks after a
   * count. If it has already said more than a brief acknowledgment, it took its
   * turn anyway and an instruction now would talk over it.
   */
  private holding(utterance: Utterance) {
    const said = this.sproutReply.trim();
    const words = said ? said.split(/\s+/).length : 0;
    return mentionsNumber(utterance.text) && words <= BRIEF_ACK_WORDS;
  }

  /** Only silence or an explicitly neutral, tiny acknowledgment is safe for an immediate advance. */
  private sproutIsHoldingForDecision() {
    return /^(?:oh|ooh|okay)[.!?]*$/i.test(this.sproutReply.trim()) || !this.sproutReply.trim();
  }

  private deferAdvance(sceneIndex: number, answerVersion: string) {
    if (this.deferredAdvance) return;
    this.deferredAdvance = {
      sceneIndex,
      answerVersion,
      approvedAt: Date.now(),
      spokenChars: this.sproutReply.length,
      speechEpoch: this.speechEpoch,
      correctionReadyAt: Math.max(this.turnEndAt, this.lastDeltaAt) + CORRECTION_WINDOW_MS,
      outputQuietAt: 0,
    };
    this.log("advance.deferred", {
      answer_version: answerVersion,
      scene: sceneAt(sceneIndex).id,
      reason: "correction_window",
      correction_window_ms: CORRECTION_WINDOW_MS,
      spoken_chars: this.sproutReply.length,
    });
    this.scheduleDeferredRelease();
  }

  private scheduleDeferredRelease(outputDelta = false) {
    clearTimeout(this.deferredTimer);
    const deferred = this.deferredAdvance;
    if (!deferred) return;
    // Output has no completed-turn event. A substantive reply needs one
    // transcript gap before a scene change; each fragment extends that gap.
    if (!this.sproutIsHoldingForDecision() && (outputDelta || deferred.outputQuietAt === 0))
      deferred.outputQuietAt = Date.now() + UTTERANCE_GAP_MS;
    const releaseAt = Math.max(deferred.correctionReadyAt, deferred.outputQuietAt, this.activityRecoveryUntil);
    this.deferredTimer = setTimeout(() => this.releaseDeferredAdvance(), Math.max(0, releaseAt - Date.now()));
  }

  private releaseDeferredAdvance() {
    const deferred = this.deferredAdvance;
    if (!deferred) return;
    this.deferredAdvance = null;
    clearTimeout(this.deferredTimer);
    if (
      this.expireIfOverdue() ||
      this.snapshot.status !== "active" ||
      this.pending ||
      this.provisionalActivity ||
      this.microphoneSpeaking ||
      this.speechEpoch !== deferred.speechEpoch ||
      `${this.latest?.startMs}:${this.latest?.text.trim()}` !== deferred.answerVersion ||
      this.snapshot.sceneIndex !== deferred.sceneIndex ||
      deferred.sceneIndex >= LAST_SCENE
    )
      return;
    this.log("advance.released", {
      scene: sceneAt(deferred.sceneIndex).id,
      answer_version: deferred.answerVersion,
      spoken_chars_at_approval: deferred.spokenChars,
      delay_ms: Date.now() - deferred.approvedAt,
      reason: deferred.outputQuietAt > deferred.correctionReadyAt ? "output_transcript_quiet" : "correction_window",
    });
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

  /** The application, not the model, commits the next deterministic scene. */
  private advance(answerVersion: string) {
    this.log("advance.committed", {
      answer_version: answerVersion,
      turn_end_to_commit_ms: Date.now() - this.turnEndAt,
    });
    const sceneIndex = this.snapshot.sceneIndex + 1;
    this.pending = { kind: "advance", sceneIndex, answerVersion, turnEndAt: this.turnEndAt };
    this.update({ sceneIndex });
  }

  private refuseDelegation(delegationId: string) {
    if (this.delegations.has(delegationId)) return;
    this.delegations.add(delegationId);
    this.log("action.rejected", { action: "delegation", id: delegationId, reason: "The app owns scene changes" });
    this.append(
      "session.thinking.append",
      "Nothing happened; you have no backend tools. The app changes the scene by itself and will tell you. Keep playing with the group on screen and do not delegate again.",
      delegationId,
    );
  }

  // Called after React commits and the browser has a paint opportunity.
  displayed(sceneIndex: number) {
    if (this.expireIfOverdue()) return;
    const pending = this.pending;
    if (!pending || pending.sceneIndex !== sceneIndex) return;
    this.pending = null;
    this.log("scene.displayed", this.scene);
    if (pending.answerVersion)
      this.log("advance.displayed", {
        answer_version: pending.answerVersion,
        turn_end_to_display_ms: Date.now() - (pending.turnEndAt ?? this.turnEndAt),
      });
    switch (pending.kind) {
      case "greeting":
        this.append(
          "session.instructions.append",
          `Greet the child now in English: introduce yourself as Sprout and invite them to play. ${sceneContext(this.scene)} Then pause and listen.`,
        );
        return;
      case "advance":
        this.append("session.instructions.append", advanceContext(this.scene));
        return;
      default: {
        const unhandled: never = pending.kind;
        throw new Error(`Unhandled pending display: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  private wrap() {
    if (this.snapshot.status !== "active") return;
    this.cancelDeferredAdvance();
    this.update({ status: "wrapping" });
    this.log("lesson.wrap_up");
    this.append(
      "session.instructions.append",
      "We have played for four and a half minutes. Gently finish this exchange. No new scenes or questions after it. We will say goodbye shortly.",
    );
  }

  private goodbye() {
    if (this.snapshot.status === "ended") return;
    this.cancelDeferredAdvance();
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
    if (this.snapshot.status === "ended") return;
    const remaining = this.startedAt === undefined ? TIMING.hard : TIMING.hard - (Date.now() - this.startedAt);
    if (remaining <= 0) reason = "time_limit";
    clearTimeout(this.startupTimer);
    clearTimeout(this.settleTimer);
    clearTimeout(this.recoveryTimer);
    clearTimeout(this.noTranscriptTimer);
    this.heldDecision = undefined;
    this.provisionalActivity = false;
    this.activityRecoveryUntil = 0;
    this.cancelDeferredAdvance();
    this.phaseTimers.forEach(clearTimeout);
    this.evaluation?.abort();
    this.pending = null;
    this.log("lesson.ended", { reason });
    // Invalidate actions BEFORE any resource callback can fire.
    this.update({ status: "ended", reason, error });
    this.transport.stopMedia();
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
      ending: this.snapshot.reason,
      browser,
      note: "Prototype diagnostics only. Transcript timing is approximate; speaker identity and audio delivery are unverified. No recording or learning conclusions.",
      events: [...this.events],
    };
  }
}
