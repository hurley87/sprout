import type { PlaybackFact } from "../browser-transport";
import type { LessonDiagnostic, LessonEventCursor } from "./diagnostic-journal";
import { parseConversationStateProposal, type ConversationStateProposal } from "./conversation-state-classifier";
import type { LessonDefinition, LessonNodeDefinition } from "./lesson-definition";
import { hasCurrentCompletionEvidence, meetsAuthoredCompletionPolicy } from "./lesson-runtime-reducer";
import type {
  ClassificationSource,
  LessonRuntimeEvent,
  LessonRuntimeResult,
  LessonRuntimeState,
  ProposalConsumption,
} from "./lesson-runtime-reducer";
import type { LiveClassificationDiagnostic } from "./live-classification-diagnostic";
import { transcriptMessages } from "./tutor-observation";

export type TrackingOrigin = {
  source: ClassificationSource;
  sceneId: string | null;
  transportSourceId: number | null;
  // Composite request snapshots have no single provider packet identity.
  providerEventId: string | null;
  providerInterval: { startMs: number; endMs: number } | null;
};
type Support = {
  transcript: string | null;
  authored: Pick<LessonNodeDefinition, "learningObjective" | "concepts" | "completionPolicy"> | null;
};
export type EvidenceTracking = {
  kind: "evidence";
  origin: TrackingOrigin;
  support: Support;
  proposal: ConversationStateProposal | null;
  consumption: "consumed" | "ignored" | "not_dispatched";
  reason: string | null;
  accepted: ProposalConsumption["accepted"];
  prior: LessonEventCursor | null;
  subject: "answer_authority" | "source_validity";
  change: "observed" | "authority_suspended" | "superseded";
  countingAttribution: "unknown";
  countingIndependence: "unknown";
};
export type FeedbackTracking = {
  kind: "feedback";
  origin: TrackingOrigin;
  support: Support;
  semantic: ConversationStateProposal["tutorState"] | null;
  mapping: LiveClassificationDiagnostic | null;
  tutorMessageIndex: number | null;
  evidence: LessonEventCursor | null;
  correction: "unknown";
  contradiction: "unknown";
  prompting: "unknown";
};
export type DeliveryTracking = {
  kind: "delivery";
  origin: TrackingOrigin;
  attachmentGeneration: number | null;
  feedback: LessonEventCursor | null;
  correlation: "inferred_temporal" | null;
  pcm: "active" | "quiet" | "unavailable" | null;
  playbackFact: PlaybackFact | null;
  responseId: null;
  responseComplete: "unknown";
  speechHeard: "unknown";
  // Exact existing gate values at receipt, not a second eligibility evaluator.
  outputGate: Pick<LessonRuntimeState, "outputActivity" | "tutorOutputObserved" | "tutorOutputDrained"> | null;
};
export type TrackingDetail = EvidenceTracking | FeedbackTracking | DeliveryTracking;

export function trackDelivery(
  detail: Omit<
    DeliveryTracking,
    "kind" | "feedback" | "correlation" | "responseId" | "responseComplete" | "speechHeard"
  >,
  history: readonly LessonDiagnostic[],
): DeliveryTracking {
  const offset = history.findLastIndex(event => {
    if (event.type !== "tracking.feedback") return false;
    const feedback = event.detail as FeedbackTracking;
    return (
      feedback.tutorMessageIndex !== null &&
      sameExchange(feedback.origin.source, detail.origin.source) &&
      feedback.origin.transportSourceId === detail.origin.transportSourceId &&
      detail.origin.transportSourceId !== null &&
      feedback.origin.source.transcriptRevision <= detail.origin.source.transcriptRevision
    );
  });
  return {
    ...detail,
    kind: "delivery",
    feedback: offset < 0 ? null : { runtimeId: detail.origin.source.runtimeId, offset },
    correlation: offset < 0 ? null : "inferred_temporal",
    responseId: null,
    responseComplete: "unknown",
    speechHeard: "unknown",
  };
}

export function trackingOrigin(
  source: ClassificationSource,
  lesson: LessonDefinition,
  transportSourceId?: number,
): TrackingOrigin {
  const node = lesson.nodes[source.nodeId];
  return {
    source,
    sceneId: node ? String(node.presentation.sceneId ?? node.id) : null,
    transportSourceId: transportSourceId ?? null,
    providerEventId: null,
    providerInterval: null,
  };
}
function support(origin: TrackingOrigin, transcript: string | null, lesson: LessonDefinition): Support {
  const node = lesson.nodes[origin.source.nodeId];
  return {
    transcript,
    authored: node
      ? {
          learningObjective: node.learningObjective,
          concepts: node.concepts,
          completionPolicy: node.completionPolicy,
        }
      : null,
  };
}
function evidenceDetail(event: LessonDiagnostic): EvidenceTracking | null {
  // Old exports have no tracking fields and are simply skipped.
  if (event.type !== "tracking.evidence") return null;
  const detail = event.detail as EvidenceTracking | null;
  return detail?.kind === "evidence" ? detail : null;
}
function sameExchange(a: ClassificationSource, b: ClassificationSource) {
  return (
    a.runtimeId === b.runtimeId && a.nodeId === b.nodeId && a.visitId === b.visitId && a.childTurnId === b.childTurnId
  );
}
function findEvidence(history: readonly LessonDiagnostic[], source: ClassificationSource) {
  for (let offset = history.length - 1; offset >= 0; offset--) {
    const detail = evidenceDetail(history[offset]);
    if (detail?.consumption !== "consumed" || !detail.accepted || !sameExchange(detail.origin.source, source)) continue;
    if (detail.origin.source.transcriptRevision > source.transcriptRevision) continue;
    return { detail, ref: { runtimeId: source.runtimeId, offset } };
  }
  return null;
}

/** Pure projection of actual reducer outcomes. Never interprets semantic guards or grants authority. */
export function trackReduction({
  before,
  event,
  result,
  origin,
  lesson,
  history,
}: {
  before: LessonRuntimeState;
  event: LessonRuntimeEvent;
  result: LessonRuntimeResult;
  origin: TrackingOrigin;
  lesson: LessonDefinition;
  history: readonly LessonDiagnostic[];
}): EvidenceTracking[] {
  if (event.type === "proposal.received" && result.proposalConsumption) {
    const outcome = result.proposalConsumption;
    const observation: EvidenceTracking = {
      kind: "evidence",
      origin,
      support: support(origin, event.transcriptSnapshot ?? null, lesson),
      proposal: parseConversationStateProposal(event.proposal),
      ...outcome,
      prior: findEvidence(history, origin.source)?.ref ?? null,
      subject: outcome.consumption === "ignored" ? "source_validity" : "answer_authority",
      change:
        outcome.consumption === "consumed" &&
        before.acceptedAnswerRevision !== null &&
        outcome.accepted?.acceptedAnswerRevision === null
          ? "superseded"
          : "observed",
      countingAttribution: "unknown",
      countingIndependence: "unknown",
    };
    const records = [observation];
    if (outcome.consumption === "consumed" && result.state.visitId !== before.visitId) {
      records.push({
        ...observation,
        proposal: null,
        consumption: "not_dispatched",
        accepted: null,
        change: "superseded",
        reason: "node_visit_changed",
        prior: { runtimeId: origin.source.runtimeId, offset: history.length },
      });
    }
    return records;
  }
  // Suspension describes lost current authority, never deletion of accepted history.
  if (
    (before.answerAccepted && !result.state.answerAccepted) ||
    (before.acceptedAnswerRevision !== null && result.state.acceptedAnswerRevision === null) ||
    (before.answerAccepted && result.state.visitId !== before.visitId)
  ) {
    const previous = findEvidence(history, {
      ...origin.source,
      nodeId: before.nodeId,
      visitId: before.visitId,
      childTurnId: before.childTurnId,
      transcriptRevision: before.transcriptRevision,
    });
    const tutorRevision = event.type === "transcript.updated" && event.speaker === "tutor";
    return [
      {
        kind: "evidence",
        origin: previous?.detail.origin ?? origin,
        support: previous?.detail.support ?? support(origin, null, lesson),
        proposal: null,
        consumption: "not_dispatched",
        accepted: null,
        prior: previous?.ref ?? null,
        subject: "answer_authority",
        change: tutorRevision ? "authority_suspended" : "superseded",
        reason: tutorRevision
          ? "tutor_revision_revalidation"
          : result.state.visitId !== before.visitId
            ? "node_visit_changed"
            : event.type,
        countingAttribution: "unknown",
        countingIndependence: "unknown",
      },
    ];
  }
  return [];
}

/** Mapping acceptance is Jev's judgment, independent of reducer consumption. */
export function trackClassification({
  origin,
  transcript,
  proposal,
  mapping,
  lesson,
  history,
  journalRuntimeId,
}: {
  origin: TrackingOrigin;
  transcript: string;
  proposal: ConversationStateProposal | null;
  mapping: LiveClassificationDiagnostic | null;
  lesson: LessonDefinition;
  history: readonly LessonDiagnostic[];
  journalRuntimeId: string;
}): TrackingDetail[] {
  const messages = transcriptMessages(transcript);
  const index = messages?.findLastIndex(message => message.speaker === "Tutor") ?? -1;
  const offset = proposal
    ? history.findLastIndex(event => {
        const detail = evidenceDetail(event);
        return (
          detail !== null &&
          detail.proposal !== null &&
          detail.consumption !== "not_dispatched" &&
          sameExchange(detail.origin.source, origin.source) &&
          detail.origin.source.transcriptRevision === origin.source.transcriptRevision
        );
      })
    : -1;
  const evidence = offset < 0 ? null : { runtimeId: journalRuntimeId, offset };
  const feedback: FeedbackTracking = {
    kind: "feedback",
    origin,
    support: support(origin, transcript, lesson),
    semantic: proposal?.tutorState ?? null,
    mapping,
    tutorMessageIndex: index < 0 ? null : index,
    evidence,
    correction: "unknown",
    contradiction: "unknown",
    prompting: "unknown",
  };
  return [
    ...(proposal
      ? []
      : [
          {
            kind: "evidence",
            origin,
            support: feedback.support,
            proposal: null,
            consumption: "not_dispatched",
            reason: mapping?.reason ?? null,
            accepted: null,
            prior: null,
            subject: "source_validity",
            change: "observed",
            countingAttribution: "unknown",
            countingIndependence: "unknown",
          } satisfies EvidenceTracking,
        ]),
    feedback,
  ];
}

/** Existing gates only. Historical observations are never inputs to these predicates. */
export function currentEvidenceEligibility(state: LessonRuntimeState | null, lesson: LessonDefinition) {
  return state
    ? {
        phase: state.phase,
        semanticCompletionEvidence: hasCurrentCompletionEvidence(state, lesson),
        authoredCompletionPolicyMet: meetsAuthoredCompletionPolicy(state, lesson),
        transitionReady: state.transitionReady,
        pendingRender: state.pendingRender,
      }
    : null;
}
