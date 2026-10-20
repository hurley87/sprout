import { trackReduction, trackClassification, trackDelivery, type TrackingDetail } from "./evidence-tracking";
import { CLASSIFIER_VERSION } from "./conversation-observer-contract";
import type { ConversationAssessment, ConversationVisit } from "./conversation-assessment";
import type { ClassificationSource, LessonRuntimeState, RuntimeSource } from "./lesson-runtime-reducer";

export type DiagnosticSpeaker = "child" | "tutor" | "unknown";
export type LessonDiagnostic = {
  timestamp: string;
  atMs: number;
  type: string;
  runtimeId: string;
  visitId: number | null;
  childTurnId: number | null;
  nodeId: string;
  transcriptRevision: number;
  transcriptSpeaker: DiagnosticSpeaker;
  classifierVersion?: typeof CLASSIFIER_VERSION;
  detail: unknown;
};
export type LessonEventCursor = { runtimeId: string; offset: number };

/** Attempt-local bookkeeping only. The runtime chooses when to append and publish. */
export class DiagnosticJournal {
  private readonly events: LessonDiagnostic[] = [];

  constructor(
    private readonly runtimeId: string,
    private readonly now: () => number,
    private readonly initialNodeId: string,
  ) {}

  append(
    type: string,
    detail: unknown,
    {
      state,
      revision,
      source,
      speaker,
    }: {
      state: LessonRuntimeState | null;
      revision: number;
      source?: ClassificationSource | RuntimeSource;
      speaker?: DiagnosticSpeaker;
    },
  ) {
    this.events.push({
      timestamp: new Date().toISOString(),
      atMs: this.now(),
      type,
      ...(type.startsWith("classifier.") ? { classifierVersion: CLASSIFIER_VERSION } : {}),
      runtimeId: source?.runtimeId ?? this.runtimeId,
      visitId: source?.visitId ?? state?.visitId ?? null,
      childTurnId: source?.childTurnId ?? state?.childTurnId ?? null,
      nodeId: source && "nodeId" in source ? source.nodeId : (state?.nodeId ?? this.initialNodeId),
      transcriptRevision: source && "transcriptRevision" in source ? source.transcriptRevision : revision,
      transcriptSpeaker: speaker ?? state?.transcriptSource ?? "unknown",
      detail,
    });
  }

  trackReduction(input: Omit<Parameters<typeof trackReduction>[0], "history">) {
    this.appendTracking(trackReduction({ ...input, history: this.events }), input.result.state);
  }

  trackClassification(
    input: Omit<Parameters<typeof trackClassification>[0], "history" | "journalRuntimeId">,
    state: LessonRuntimeState | null,
  ) {
    this.appendTracking(
      trackClassification({ ...input, history: this.events, journalRuntimeId: this.runtimeId }),
      state,
    );
  }

  trackDelivery(input: Parameters<typeof trackDelivery>[0], state: LessonRuntimeState | null) {
    this.appendTracking([trackDelivery(input, this.events)], state);
  }

  private appendTracking(details: TrackingDetail[], state: LessonRuntimeState | null) {
    for (const detail of details)
      this.append(`tracking.${detail.kind}`, detail, {
        state,
        revision: detail.origin.source.transcriptRevision,
        source: detail.origin.source,
      });
  }

  recent() {
    return this.events.slice(-100);
  }

  /** Read the complete journal independently of React publication; never return runtime references. */
  observe<Snapshot>(after: LessonEventCursor | undefined, snapshot: () => Snapshot) {
    if (
      after &&
      (after.runtimeId !== this.runtimeId ||
        !Number.isSafeInteger(after.offset) ||
        after.offset < 0 ||
        after.offset > this.events.length)
    )
      throw new Error("Lesson observation cursor does not belong to this runtime journal");
    return structuredClone({
      nowMs: this.now(),
      cursor: { runtimeId: this.runtimeId, offset: this.events.length },
      snapshot: snapshot(),
      events: this.events.slice(after?.offset ?? 0),
    });
  }

  report<Timing>({
    timing,
    runtime,
    status,
    error,
    transcript,
    conversation,
    assessment,
  }: {
    timing: Timing;
    runtime: LessonRuntimeState | null;
    status: "prepared" | "connecting" | "live" | "ended";
    error: string | null;
    transcript: string;
    conversation: ConversationVisit[];
    assessment: ConversationAssessment;
  }) {
    const report = {
      product: "sprout",
      classifierVersion: CLASSIFIER_VERSION,
      version: 1,
      runtimeId: this.runtimeId,
      clock: "browser.performance.now-relative-to-attempt",
      timing,
      runtime,
      status,
      error,
      transcript,
      events: [...this.events],
      conversation,
      assessment,
    };
    // Additive fields remain optional for older exported-report consumers.
    return report as Omit<typeof report, "conversation" | "assessment"> &
      Partial<Pick<typeof report, "conversation" | "assessment">>;
  }
}
