import { runtimeSource, type ClassificationSource, type LessonRuntimeState } from "./lesson-runtime-reducer";

export type TutorStabilizationTiming = {
  tutorTranscriptStableMs: number;
  tutorClassificationQuietMs: number;
};
export type TutorStabilizationDiagnostic = {
  type:
    | "tutor_stabilization.scheduled"
    | "tutor_stabilization.cancelled"
    | "tutor_stabilization.waiting_for_transcript"
    | "tutor_stabilization.waiting_for_quiet"
    | "tutor_stabilization.ready";
  source: ClassificationSource;
  revision: number;
  transcriptStableDurationMs: number;
  quietDurationMs: number;
  outputActivity: LessonRuntimeState["outputActivity"];
  thresholds: TutorStabilizationTiming;
  reason: string;
  delayMs: number | null;
};

/** Tutor classification boundary. It never uses the reducer's audio-drain evidence. */
export class TutorStabilizationGate {
  private snapshot?: { identity: ClassificationSource; changedAtMs: number };
  private state?: LessonRuntimeState;
  private enabled = false;
  private quietSinceMs: number | null = null;
  private outputActivity: LessonRuntimeState["outputActivity"] = "unavailable";
  private timer?: ReturnType<typeof setTimeout>;
  private timerDueMs: number | null = null;
  private generation = 0;
  private readyKey?: string;
  private waitingKey?: string;

  constructor(
    private readonly timing: TutorStabilizationTiming,
    private readonly now: () => number,
    private readonly ready: () => void,
    private readonly diagnostic: (event: TutorStabilizationDiagnostic) => void,
  ) {}

  observe(state: LessonRuntimeState, enabled: boolean, trigger: string) {
    const now = this.now();
    // Quiet is measured independently, including before transcript stability and
    // without needing another quiet event (the PCM observer reports changes only).
    if (state.outputActivity !== "quiet") this.quietSinceMs = null;
    else if (this.outputActivity !== "quiet") this.quietSinceMs = now;
    this.outputActivity = state.outputActivity;
    this.state = state;
    this.enabled = enabled;

    // This is diagnostic/scheduling identity only. classificationSource(state)
    // and the exact transcript are captured by the caller once ready fires.
    const identity = { ...runtimeSource(state), nodeId: state.nodeId, transcriptRevision: state.transcriptRevision };
    if (JSON.stringify(identity) !== JSON.stringify(this.snapshot?.identity)) {
      const previous = this.snapshot?.identity;
      const reason =
        previous && (previous.runtimeId !== identity.runtimeId || previous.visitId !== identity.visitId)
          ? "node_visit_changed"
          : previous && previous.childTurnId !== identity.childTurnId
            ? "child_turn_started"
            : "newer_transcript_snapshot";
      this.cancel(reason);
      this.snapshot = { identity, changedAtMs: now };
    }
    this.evaluate(trigger);
  }

  cancel(reason: string) {
    this.clearSchedule(reason);
    this.snapshot = undefined;
  }

  private clearSchedule(reason: string) {
    if (this.snapshot && (this.timerDueMs !== null || this.waitingKey !== undefined))
      this.emit("tutor_stabilization.cancelled", reason);
    clearTimeout(this.timer);
    this.timer = undefined;
    this.timerDueMs = null;
    this.waitingKey = undefined;
    this.generation++;
  }

  private emit(type: TutorStabilizationDiagnostic["type"], reason: string, delayMs: number | null = null) {
    if (!this.snapshot) return;
    const now = this.now();
    this.diagnostic({
      type,
      source: this.snapshot.identity,
      revision: this.snapshot.identity.transcriptRevision,
      transcriptStableDurationMs: Math.max(0, now - this.snapshot.changedAtMs),
      quietDurationMs: this.quietSinceMs === null ? 0 : Math.max(0, now - this.quietSinceMs),
      outputActivity: this.outputActivity,
      thresholds: { ...this.timing },
      reason,
      delayMs,
    });
  }

  private evaluate(trigger: string) {
    const state = this.state;
    if (!state || !this.snapshot) return;
    if (
      !this.enabled ||
      state.phase !== "active" ||
      state.childSpeaking ||
      !state.hasChildTranscript ||
      state.transcriptSource !== "tutor"
    ) {
      this.clearSchedule(
        state.childSpeaking ? "child_speaking" : state.phase !== "active" ? "node_inactive" : "snapshot_ineligible",
      );
      return;
    }
    const key = JSON.stringify(this.snapshot.identity);
    if (this.readyKey === key) return;
    const now = this.now();
    const transcriptRemainingMs = Math.max(0, this.timing.tutorTranscriptStableMs - (now - this.snapshot.changedAtMs));
    if (this.quietSinceMs === null) {
      if (this.timerDueMs !== null) {
        this.emit(
          "tutor_stabilization.cancelled",
          this.outputActivity === "active" ? "output_active" : "output_unavailable",
        );
        clearTimeout(this.timer);
        this.timer = undefined;
        this.timerDueMs = null;
        this.generation++;
      }
      this.wait("tutor_stabilization.waiting_for_quiet", key, trigger);
      return;
    }
    const dueMs = Math.max(
      this.snapshot.changedAtMs + this.timing.tutorTranscriptStableMs,
      this.quietSinceMs + this.timing.tutorClassificationQuietMs,
    );
    const delayMs = Math.max(0, dueMs - now);
    if (delayMs === 0) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.timerDueMs = null;
      this.waitingKey = undefined;
      this.readyKey = key;
      this.emit("tutor_stabilization.ready", trigger);
      this.ready();
      return;
    }
    this.wait(
      transcriptRemainingMs > 0
        ? "tutor_stabilization.waiting_for_transcript"
        : "tutor_stabilization.waiting_for_quiet",
      key,
      trigger,
    );
    if (this.timerDueMs === dueMs) return;
    clearTimeout(this.timer);
    this.timerDueMs = dueMs;
    const generation = ++this.generation;
    this.emit("tutor_stabilization.scheduled", trigger, delayMs);
    this.timer = setTimeout(() => {
      if (generation !== this.generation) return;
      this.timer = undefined;
      this.timerDueMs = null;
      this.evaluate("stabilization_timer_elapsed");
    }, delayMs);
  }

  private wait(
    type: "tutor_stabilization.waiting_for_transcript" | "tutor_stabilization.waiting_for_quiet",
    key: string,
    reason: string,
  ) {
    const waitingKey = `${key}:${type}:${this.outputActivity}`;
    if (this.waitingKey === waitingKey) return;
    this.waitingKey = waitingKey;
    this.emit(type, reason);
  }
}
