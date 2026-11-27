import type { LessonDefinition, SilenceNudgeDefinition } from "./lesson-definition";
import { runtimeSource, type LessonRuntimeState, type RuntimeSource } from "./lesson-runtime-reducer";

/** After a provisional burst ends, wait at least this long before a nudge so Rex never talks straight
 * over a sound the child just made. */
export const SILENCE_NUDGE_AFTER_BURST_MS = 1_000;

/** The tutor has spoken on this visit (its transcript is the latest) and gone quiet, and the learner
 * has not begun a turn: no confirmed turn, no speech and no provisional microphone burst. Nothing is
 * pending that a prompt could talk over (an accepted answer, a scene change or a learner advance). */
export function awaitingFirstLearnerTurn(state: LessonRuntimeState, lesson: LessonDefinition) {
  return (
    state.phase === "active" &&
    state.outputActivity === "quiet" &&
    state.transcriptSource === "tutor" &&
    !state.hasChildTurn &&
    !state.childSpeaking &&
    !state.childCandidate &&
    !state.answerAccepted &&
    state.pendingRender === null &&
    !state.conversationAdvanceRequested &&
    !lesson.nodes[state.nodeId].completeAfterTutorOutput
  );
}

/** Bounded conversational prompts for a learner who has not answered at all, e.g. because they do not
 * know to speak. Each authored step fires at most once per visit (send failures also spend it). Silence
 * is measured from when the tutor went quiet: tutor speech or a learner turn restarts it, while a
 * provisional microphone burst (room noise, a cough) only pauses it. Never a reducer proposal or evidence. */
export class SilenceNudge {
  /** The current step's silence, started when the tutor last went quiet with the learner still silent. */
  private wait?: { visit: string; step: number; since: number; timer?: ReturnType<typeof setTimeout> };
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
    if (state.childCandidate) {
      // A burst may be the start of an answer: hold the nudge, but keep the silence already waited.
      clearTimeout(wait.timer);
      wait.timer = undefined;
      return;
    }
    if (wait.timer) return;
    const nudge = steps[step];
    const elapsed = Date.now() - wait.since;
    const waitMs = Math.max(nudge.afterQuietMs - elapsed, elapsed > 0 ? SILENCE_NUDGE_AFTER_BURST_MS : 0);
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
