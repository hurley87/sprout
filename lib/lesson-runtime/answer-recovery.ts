import { runtimeSource, type ClassificationSource, type LessonRuntimeState } from "./lesson-runtime-reducer";

export const ANSWER_RECOVERY_WAIT_MS = 4_000;
export const ANSWER_RECOVERY_INSTRUCTION =
  "One-time clarification for the still-rendered current scene: the application cannot yet establish a settled child answer. If the child is still waiting and has not spoken again, naturally ask them to repeat their answer. If they are speaking or have responded since this request, ignore it and follow their response. Ask at most once. Do not supply or repeat a count, total, answer, counting method, hint, or imply success. Wait for a fresh child answer; if it establishes settled correct current-scene success, explicitly confirm it with its number and object, then pause. For unfinished or uncertain answers, wait or clarify without giving the total. Never change scenes. This request grants no completion authority.";

const turnKey = (source: ClassificationSource) =>
  JSON.stringify([source.runtimeId, source.nodeId, source.visitId, source.childTurnId]);
const sourceFor = (state: LessonRuntimeState): ClassificationSource => ({
  ...runtimeSource(state),
  nodeId: state.nodeId,
  transcriptRevision: state.transcriptRevision,
});

/** Conversational recovery for missing text or canonical semantic holds; never restores
 * earlier evidence or makes a classification request without a child transcript. */
export class AnswerRecovery {
  private turn?: ClassificationSource;
  private reason: "missing_transcript" | "semantic_hold" = "missing_transcript";
  private timer?: ReturnType<typeof setTimeout>;
  private state?: LessonRuntimeState;
  private enabled = false;
  private readonly requestedVisits = new Set<string>();

  constructor(
    private readonly request: (source: ClassificationSource) => void,
    private readonly diagnostic: (type: string, source: ClassificationSource, detail: unknown) => void,
  ) {}

  arm(state: LessonRuntimeState, enabled: boolean) {
    this.cancel("new_confirmed_turn");
    if (
      state.phase !== "active" ||
      !state.hasChildTurn ||
      state.childSpeaking ||
      state.childCandidate ||
      state.hasChildTranscript
    )
      return;
    this.turn = sourceFor(state);
    this.reason = "missing_transcript";
    this.observe(state, enabled);
  }

  armSemanticHold(state: LessonRuntimeState, enabled: boolean, source: ClassificationSource) {
    // Only a successful canonical response for the exact current snapshot may
    // request this recovery. Network errors or cancelled requests are not holds.
    if (!state.hasChildTranscript || JSON.stringify(sourceFor(state)) !== JSON.stringify(source)) return;
    this.cancel("semantic_hold");
    this.turn = source;
    this.reason = "semantic_hold";
    this.observe(state, enabled);
  }

  observe(state: LessonRuntimeState, enabled: boolean) {
    this.state = state;
    this.enabled = enabled;
    if (!this.turn) return;
    if (
      !enabled ||
      state.phase !== "active" ||
      !state.hasChildTurn ||
      state.childSpeaking ||
      state.childCandidate ||
      (this.reason === "missing_transcript"
        ? state.hasChildTranscript
        : !state.hasChildTranscript || state.transcriptRevision !== this.turn.transcriptRevision) ||
      turnKey(sourceFor(state)) !== turnKey(this.turn)
    ) {
      this.cancel("turn_or_eligibility_changed");
      return;
    }
    if (state.outputActivity !== "quiet") {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = undefined;
        this.diagnostic("answer_recovery.waiting_for_quiet", this.turn, null);
      }
      return;
    }
    const visit = `${state.runtimeId}:${state.visitId}`;
    if (this.timer || this.requestedVisits.has(visit)) return;
    this.diagnostic("answer_recovery.scheduled", sourceFor(state), {
      waitMs: ANSWER_RECOVERY_WAIT_MS,
      reason: this.reason,
    });
    this.timer = setTimeout(() => {
      this.timer = undefined;
      // Every runtime transition updates this state; tutor fragments may change
      // revision without supplying the missing child evidence or resetting quiet.
      const current = this.state;
      if (!current || !this.enabled || !this.turn || current.outputActivity !== "quiet") return;
      const source = sourceFor(current);
      this.requestedVisits.add(visit); // Send failures also spend the budget.
      this.turn = undefined;
      this.diagnostic("answer_recovery.requested", source, { waitMs: ANSWER_RECOVERY_WAIT_MS, reason: this.reason });
      this.request(source);
    }, ANSWER_RECOVERY_WAIT_MS);
  }

  cancel(reason: string) {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.turn) this.diagnostic("answer_recovery.cancelled", this.turn, { reason });
    this.turn = undefined;
  }
}
