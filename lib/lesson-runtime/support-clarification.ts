import { classificationSource, type ClassificationSource, type LessonRuntimeState } from "./lesson-runtime-reducer";

// Compatibility export for counting-specific callers; runtime prompt selection uses LessonDefinition.
export { COUNTING_SUPPORT_CLARIFICATION_INSTRUCTION as SUPPORT_CLARIFICATION_INSTRUCTION } from "./counting-lesson";

export const SUPPORT_CLARIFICATION_POLICY = { waitMs: 4_000, maxRequestsPerVisit: 1 } as const;
const key = (source: ClassificationSource) =>
  JSON.stringify([source.runtimeId, source.nodeId, source.visitId, source.childTurnId, source.transcriptRevision]);
const visitKey = (source: ClassificationSource) => `${source.runtimeId}:${source.visitId}`;

/** Shared support/acknowledgment ambiguity recovery. A bounded conversational
 * request, never a reducer proposal or completion fact. Historical name retained. */
export class SupportClarification {
  private pending?: { source: ClassificationSource; timer: ReturnType<typeof setTimeout> };
  private sent?: ClassificationSource;
  private readonly considered = new Set<string>();
  private readonly requestedVisits = new Set<string>();

  constructor(
    private readonly request: (source: ClassificationSource) => void,
    private readonly diagnostic: (type: string, source: ClassificationSource, detail: unknown) => void,
  ) {}

  private eligible(state: LessonRuntimeState, enabled: boolean, source: ClassificationSource) {
    const current = classificationSource(state);
    return (
      enabled &&
      current !== null &&
      key(current) === key(source) &&
      state.transcriptSource === "tutor" &&
      state.outputActivity === "quiet" &&
      state.tutorOutputObserved &&
      state.tutorOutputDrained
    );
  }

  consider(state: LessonRuntimeState, enabled: boolean, source: ClassificationSource) {
    if (this.considered.has(key(source)) || this.requestedVisits.has(visitKey(source))) return;
    if (!this.eligible(state, enabled, source)) return;
    this.considered.add(key(source));
    this.cancel("superseded_ambiguity");
    this.pending = {
      source,
      timer: setTimeout(() => {
        this.pending = undefined;
        this.requestedVisits.add(visitKey(source)); // Budget is spent even if transport send fails.
        this.sent = source;
        this.diagnostic("clarification.requested", source, SUPPORT_CLARIFICATION_POLICY);
        this.request(source);
      }, SUPPORT_CLARIFICATION_POLICY.waitMs),
    };
    this.diagnostic("clarification.scheduled", source, SUPPORT_CLARIFICATION_POLICY);
  }

  observe(state: LessonRuntimeState, enabled: boolean) {
    const source = this.pending?.source ?? this.sent;
    if (source && !this.eligible(state, enabled, source)) this.cancel("snapshot_or_activity_changed");
  }

  acknowledge(state: LessonRuntimeState, enabled: boolean, source: ClassificationSource) {
    const accepted = this.sent !== undefined && key(this.sent) === key(source) && this.eligible(state, enabled, source);
    this.diagnostic(accepted ? "clarification.acknowledged" : "clarification.acknowledgment_ignored", source, null);
    // An append acknowledgment establishes no transcript boundary or completion evidence.
  }

  cancel(reason: string) {
    const source = this.pending?.source ?? this.sent;
    if (this.pending) clearTimeout(this.pending.timer);
    if (source)
      this.diagnostic(this.pending ? "clarification.cancelled" : "clarification.invalidated", source, { reason });
    this.pending = undefined;
    this.sent = undefined;
  }
}
