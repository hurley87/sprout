import type { AnswerRecoveryActivity } from "./answer-recovery";
import type { LessonDefinition, SilenceNudgeDefinition } from "./lesson-definition";
import { runtimeSource, type LessonRuntimeState, type RuntimeSource } from "./lesson-runtime-reducer";

/** After a provisional burst ends, wait at least this long before a nudge so Rex never talks straight
 * over a sound the child just made. */
export const SILENCE_NUDGE_AFTER_BURST_MS = 1_000;

type QuietWait = {
  since: number;
  timer?: ReturnType<typeof setTimeout>;
  inBurst?: boolean;
  resumeAfter?: number;
};

function pauseForBurst(wait: QuietWait, state: LessonRuntimeState) {
  if (state.childCandidate) {
    // The burst could be speech. Hold the timer, keeping the quiet already waited.
    clearTimeout(wait.timer);
    wait.timer = undefined;
    wait.inBurst = true;
    return true;
  }
  if (wait.inBurst) {
    wait.inBurst = false;
    wait.resumeAfter = Date.now() + SILENCE_NUDGE_AFTER_BURST_MS;
  }
  return false;
}

function nudgeDelay(wait: QuietWait, afterQuietMs: number) {
  const now = Date.now();
  return Math.max(wait.since + afterQuietMs - now, (wait.resumeAfter ?? now) - now, 0);
}

function quietScene(state: LessonRuntimeState, lesson: LessonDefinition) {
  return (
    state.phase === "active" &&
    state.outputActivity === "quiet" &&
    !state.answerAccepted &&
    state.pendingRender === null &&
    !state.conversationAdvanceRequested &&
    !lesson.nodes[state.nodeId].completeAfterTutorOutput
  );
}

/** The tutor has spoken on this visit (its transcript is the latest) and gone quiet, and the learner
 * has not begun a turn: no confirmed turn, no speech and no provisional microphone burst. Nothing is
 * pending that a prompt could talk over (an accepted answer, a scene change or a learner advance). */
export function awaitingFirstLearnerTurn(state: LessonRuntimeState, lesson: LessonDefinition) {
  return (
    quietScene(state, lesson) &&
    state.transcriptSource === "tutor" &&
    !state.hasChildTurn &&
    !state.childSpeaking &&
    !state.childCandidate
  );
}

/** Bounded conversational prompts for a learner who has not answered at all, e.g. because they do not
 * know to speak. Each authored step fires at most once per visit (send failures also spend it). Silence
 * is measured from when the tutor went quiet: tutor speech or a learner turn restarts it, while a
 * provisional microphone burst (room noise, a cough) only pauses it. Never a reducer proposal or evidence. */
export class SilenceNudge {
  /** The current step's silence, started when the tutor last went quiet with the learner still silent. */
  private wait?: QuietWait & { visit: string; step: number };
  private current?: { state: LessonRuntimeState; enabled: boolean };
  private readonly sent = new Set<string>();
  /** Visits whose tutor output was heard after steering settled. The reducer's transcript source
   * survives a scene change, so it alone cannot show the tutor has asked the current question. */
  private readonly spoke = new Set<string>();

  constructor(
    private readonly lesson: LessonDefinition,
    private readonly request: (source: RuntimeSource, step: number, nudge: SilenceNudgeDefinition) => void,
    private readonly diagnostic: (type: string, source: RuntimeSource, detail: unknown) => void,
  ) {}

  /** Waiting for a first answer, treating a provisional burst as still silent when `allowBurst`. */
  private waiting(allowBurst: boolean) {
    const current = this.current;
    if (!current?.enabled || !this.spoke.has(`${current.state.runtimeId}:${current.state.visitId}`)) return false;
    // A deferred burst also marks the child as speaking until the turn is confirmed or discarded.
    const burst = allowBurst && current.state.childCandidate;
    const state = burst ? { ...current.state, childCandidate: null, childSpeaking: false } : current.state;
    return awaitingFirstLearnerTurn(state, this.lesson);
  }

  observe(state: LessonRuntimeState | null | undefined, enabled: boolean) {
    const steps = this.lesson.silenceNudges ?? [];
    if (!steps.length) return;
    this.current = state ? { state, enabled } : undefined;
    if (state && enabled && state.phase === "active" && state.outputActivity === "active")
      this.spoke.add(`${state.runtimeId}:${state.visitId}`);
    const visit = state ? `${state.runtimeId}:${state.visitId}` : "";
    const step = steps.findIndex((_, index) => !this.sent.has(`${visit}:${index}`));
    if (!state || step < 0 || !this.waiting(true)) {
      this.cancel("learner_or_tutor_activity");
      return;
    }
    if (this.wait?.visit !== visit || this.wait.step !== step) {
      this.cancel("superseded");
      this.wait = { visit, step, since: Date.now() };
    }
    const wait = this.wait;
    if (pauseForBurst(wait, state) || wait.timer) return;
    const nudge = steps[step];
    const waitMs = nudgeDelay(wait, nudge.afterQuietMs);
    wait.timer = setTimeout(() => {
      wait.timer = undefined;
      const now = this.current?.state;
      if (this.wait !== wait || !now || !this.waiting(false)) return;
      this.wait = undefined;
      this.sent.add(`${visit}:${step}`);
      this.diagnostic("silence_nudge.requested", runtimeSource(now), { step, afterQuietMs: nudge.afterQuietMs });
      this.request(runtimeSource(now), step, nudge);
    }, waitMs);
    this.diagnostic("silence_nudge.scheduled", runtimeSource(state), { step, waitMs });
  }

  cancel(reason: string) {
    const wait = this.wait;
    if (!wait) return;
    clearTimeout(wait.timer);
    this.wait = undefined;
    const state = this.current?.state;
    if (state) this.diagnostic("silence_nudge.cancelled", runtimeSource(state), { step: wait.step, reason });
  }
}

/** A conversational prompt after an unanswered learner turn. It supplies no completion evidence. */
export class ReplyNudge {
  private endedTurnVisit?: number;
  private wait?: QuietWait & { visitId: number; scheduledSource?: RuntimeSource };
  private readonly sent = new Set<number>();

  constructor(
    private readonly lesson: LessonDefinition,
    private readonly request: (source: RuntimeSource, nudge: SilenceNudgeDefinition) => void,
    private readonly diagnostic: (type: string, source: RuntimeSource, detail: unknown) => void,
  ) {}

  childTurnEnded(source: RuntimeSource) {
    // Some lessons mark hasChildTurn on provisional activity. A discarded burst
    // alone cannot start a reply wait, even if a previous child transcript remains.
    this.endedTurnVisit = source.visitId;
  }

  observe(state: LessonRuntimeState | null | undefined, enabled: boolean, recovery: AnswerRecoveryActivity) {
    const nudge = this.lesson.replyNudge;
    if (
      !nudge ||
      !state ||
      !quietScene(state, this.lesson) ||
      !state.hasChildTurn ||
      this.endedTurnVisit !== state.visitId ||
      this.sent.has(state.visitId) ||
      (state.childSpeaking && !state.childCandidate) ||
      state.tutorClosure ||
      state.supportLimitReached?.closeSent
    ) {
      this.cancel("learner_or_tutor_activity");
      return;
    }

    if (this.wait?.visitId !== state.visitId) {
      this.cancel("superseded");
      this.wait = { visitId: state.visitId, since: Date.now() };
    }
    const wait = this.wait;
    if (recovery.lastRequest?.visitId === state.visitId && recovery.lastRequest.at > wait.since) {
      this.cancelTimer("answer_recovery");
      wait.since = recovery.lastRequest.at;
    }
    const paused = pauseForBurst(wait, state);
    if (!enabled) {
      this.cancelTimer("disabled");
      return;
    }
    if (state.transcriptSource !== "child" || recovery.pending) {
      this.cancelTimer(recovery.pending ? "answer_recovery" : "latest_transcript_not_child");
      return;
    }
    if (paused || wait.timer) return;

    const source = runtimeSource(state);
    const waitMs = nudgeDelay(wait, nudge.afterQuietMs);
    wait.scheduledSource = source;
    wait.timer = setTimeout(() => {
      this.wait = undefined;
      this.sent.add(source.visitId); // Send failures also spend this visit's budget.
      this.diagnostic("reply_nudge.requested", source, { afterQuietMs: nudge.afterQuietMs });
      this.request(source, nudge);
    }, waitMs);
    this.diagnostic("reply_nudge.scheduled", source, { waitMs });
  }

  cancel(reason: string) {
    this.cancelTimer(reason);
    this.wait = undefined;
  }

  private cancelTimer(reason: string) {
    const wait = this.wait;
    if (!wait?.scheduledSource) return;
    clearTimeout(wait.timer);
    wait.timer = undefined;
    const source = wait.scheduledSource;
    wait.scheduledSource = undefined;
    this.diagnostic("reply_nudge.cancelled", source, { reason });
  }
}
