import { runtimeSource, type ClassificationSource, type LessonRuntimeState } from "./lesson-runtime-reducer";

// Compatibility export for counting-specific callers; runtime prompt selection uses LessonDefinition.
export { COUNTING_ANSWER_RECOVERY_INSTRUCTION as ANSWER_RECOVERY_INSTRUCTION } from "./counting-lesson";

export const ANSWER_RECOVERY_WAIT_MS = 4_000;
export const ANSWER_COMPLETION_WAIT_MS = 1_000;
const turnKey = (source: ClassificationSource) =>
  JSON.stringify([source.runtimeId, source.nodeId, source.visitId, source.childTurnId]);
const sourceFor = (state: LessonRuntimeState): ClassificationSource => ({
  ...runtimeSource(state),
  nodeId: state.nodeId,
  transcriptRevision: state.transcriptRevision,
});

/** Conversational recovery for missing text or canonical semantic holds. A caller
 * may recheck visit-local closure before prompting, without restoring mastery. */
export class AnswerRecovery {
  private turn?: ClassificationSource;
  private reason: "missing_transcript" | "semantic_hold" = "missing_transcript";
  private completionReady = false;
  private allowRecheck = true;
  private missingQuietSince?: number;
  private missingCandidateTurn?: number;
  private timer?: ReturnType<typeof setTimeout>;
  private state?: LessonRuntimeState;
  private enabled = false;
  private readonly requestedStages = new Set<string>();
  private readonly completionRequests = new Map<string, number>();

  constructor(
    private readonly request: (source: ClassificationSource) => void,
    private readonly diagnostic: (type: string, source: ClassificationSource, detail: unknown) => void,
    private readonly preserveMissingAcrossCandidates = false,
    // Closure rechecks have no mastery authority and do not spend the prompt
    // budget. A later microphone-only turn can retry a cancelled recheck.
    private readonly recheckBeforePrompt?: (source: ClassificationSource) => boolean,
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
    this.allowRecheck = true;
    this.completionReady = false;
    this.observe(state, enabled);
  }

  armSemanticHold(state: LessonRuntimeState, enabled: boolean, source: ClassificationSource, completionReady = false) {
    // Only a successful canonical response for the exact current snapshot may
    // request this recovery. Network errors or cancelled requests are not holds.
    if (!state.hasChildTranscript || JSON.stringify(sourceFor(state)) !== JSON.stringify(source)) return;
    this.cancel("semantic_hold");
    this.turn = source;
    this.reason = "semantic_hold";
    this.completionReady = completionReady;
    this.observe(state, enabled);
  }

  observe(state: LessonRuntimeState, enabled: boolean) {
    this.state = state;
    this.enabled = enabled;
    if (!this.turn) return;
    // Energy candidates are not confirmed learner speech. Keep a missing-text
    // recovery pending across discarded bursts, but never send while a candidate
    // is active and never restore answer or acknowledgment authority.
    const missingText = this.reason === "missing_transcript" && this.preserveMissingAcrossCandidates;
    if (
      !enabled ||
      state.phase !== "active" ||
      !state.hasChildTurn ||
      (state.childSpeaking && !(missingText && state.childCandidate)) ||
      (!missingText && state.childCandidate) ||
      (this.reason === "missing_transcript"
        ? state.hasChildTranscript
        : !state.hasChildTranscript || state.transcriptRevision !== this.turn.transcriptRevision) ||
      (missingText
        ? state.runtimeId !== this.turn.runtimeId ||
          state.visitId !== this.turn.visitId ||
          state.nodeId !== this.turn.nodeId ||
          (state.childTurnId !== this.turn.childTurnId &&
            !state.childCandidate &&
            this.missingCandidateTurn !== state.childTurnId)
        : turnKey(sourceFor(state)) !== turnKey(this.turn))
    ) {
      this.cancel("turn_or_eligibility_changed");
      return;
    }
    if (missingText && state.childCandidate) this.missingCandidateTurn = state.childTurnId;
    if (state.outputActivity !== "quiet") {
      this.missingQuietSince = undefined;
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = undefined;
        this.diagnostic("answer_recovery.waiting_for_quiet", this.turn, null);
      }
      return;
    }
    if (missingText) {
      this.missingQuietSince ??= Date.now();
      if (state.childCandidate) return;
      this.turn = sourceFor(state);
      this.missingCandidateTurn = undefined;
    }
    // A support prompt must not exhaust the later completion prompt. Each stage
    // remains bounded to one request per visit, including failed sends.
    const stage = `${state.runtimeId}:${state.visitId}:${this.completionReady ? "completion" : "support"}`;
    // One repair is allowed after a completion request produces new tutor text
    // but still no closure. Candidate noise or reclassifying identical text must
    // not replenish the budget. Existing speech, revision and quiet gates apply.
    const priorRevision = this.completionRequests.get(stage);
    const repairStage = `${stage}:repair`;
    const repair =
      this.completionReady &&
      !!this.recheckBeforePrompt &&
      priorRevision !== undefined &&
      state.transcriptSource === "tutor" &&
      state.transcriptRevision > priorRevision &&
      !this.requestedStages.has(repairStage);
    const requestStage = repair ? repairStage : stage;
    if (
      this.timer ||
      (this.requestedStages.has(requestStage) && (this.reason !== "missing_transcript" || !this.recheckBeforePrompt))
    )
      return;
    const waitMs = this.completionReady && !repair ? ANSWER_COMPLETION_WAIT_MS : ANSWER_RECOVERY_WAIT_MS;
    this.diagnostic("answer_recovery.scheduled", sourceFor(state), {
      waitMs,
      reason: this.reason,
    });
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        // Every runtime transition updates this state; tutor fragments may change
        // revision without supplying the missing child evidence or resetting quiet.
        const current = this.state;
        if (!current || !this.enabled || !this.turn || current.outputActivity !== "quiet") return;
        if (current.childSpeaking || current.childCandidate) return;
        const source = sourceFor(current);
        this.turn = undefined;
        this.diagnostic("answer_recovery.requested", source, { waitMs, reason: this.reason });
        if (this.reason === "missing_transcript" && this.allowRecheck && this.recheckBeforePrompt?.(source)) return;
        if (this.requestedStages.has(requestStage)) return;
        this.requestedStages.add(requestStage);
        if (this.completionReady && !repair) this.completionRequests.set(stage, source.transcriptRevision); // Send failures also spend the budget.
        this.request(source);
      },
      missingText ? Math.max(0, waitMs - (Date.now() - this.missingQuietSince!)) : waitMs,
    );
  }

  /** A failed/held closure check still waits for quiet and shares the support prompt budget. */
  armMissingFallback(state: LessonRuntimeState, enabled: boolean) {
    this.arm(state, enabled);
    this.allowRecheck = false;
  }

  cancel(reason: string) {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.turn) this.diagnostic("answer_recovery.cancelled", this.turn, { reason });
    this.turn = undefined;
    this.missingQuietSince = undefined;
    this.missingCandidateTurn = undefined;
  }
}
