import type { LessonDefinition, SilenceNudgeDefinition } from "./lesson-definition";
import { runtimeSource, type LessonRuntimeState, type RuntimeSource } from "./lesson-runtime-reducer";

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
 * know to speak. Each authored step fires at most once per visit (send failures also spend it), and
 * any learner or tutor activity restarts the current step's wait. Never a reducer proposal or evidence. */
export class SilenceNudge {
  private pending?: { visit: string; step: number; timer: ReturnType<typeof setTimeout> };
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

  private eligible() {
    const current = this.current;
    return (
      !!current &&
      current.enabled &&
      this.spoke.has(`${current.state.runtimeId}:${current.state.visitId}`) &&
      awaitingFirstLearnerTurn(current.state, this.lesson)
    );
  }

  observe(state: LessonRuntimeState | null | undefined, enabled: boolean) {
    const steps = this.lesson.silenceNudges ?? [];
    if (!steps.length) return;
    this.current = state ? { state, enabled } : undefined;
    if (state && enabled && state.phase === "active" && state.outputActivity === "active")
      this.spoke.add(`${state.runtimeId}:${state.visitId}`);
    if (!state || !this.eligible()) {
      this.cancel("learner_or_tutor_activity");
      return;
    }
    const visit = `${state.runtimeId}:${state.visitId}`;
    const step = steps.findIndex((_, index) => !this.sent.has(`${visit}:${index}`));
    if (step < 0 || (this.pending?.visit === visit && this.pending.step === step)) return;
    this.cancel("superseded");
    const nudge = steps[step];
    const source = runtimeSource(state);
    this.pending = {
      visit,
      step,
      timer: setTimeout(() => {
        this.pending = undefined;
        const now = this.current?.state;
        if (!now || !this.eligible() || `${now.runtimeId}:${now.visitId}` !== visit) return;
        this.sent.add(`${visit}:${step}`);
        this.diagnostic("silence_nudge.requested", runtimeSource(now), { step, afterQuietMs: nudge.afterQuietMs });
        this.request(runtimeSource(now), step, nudge);
      }, nudge.afterQuietMs),
    };
    this.diagnostic("silence_nudge.scheduled", source, { step, afterQuietMs: nudge.afterQuietMs });
  }

  cancel(reason: string) {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending = undefined;
    const state = this.current?.state;
    if (state) this.diagnostic("silence_nudge.cancelled", runtimeSource(state), { step: pending.step, reason });
  }
}
