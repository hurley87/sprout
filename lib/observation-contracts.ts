import type { Evidence } from "./session-recorder";

export type ObservationBehavior = "quantity_identification" | "counting_aloud_with_total" | "uncertain_exchange";
export type ObservationOutcome = "correct" | "incorrect" | "uncertain";
export type SupportKind = "hint" | "choice" | "modeled_answer" | "counting_together" | "parent_reported_assistance";
export type UncertaintyReason =
  | "ambiguous_speaker"
  | "unclear_speech"
  | "silence"
  | "missing_scene_context"
  | "disrupted_exchange"
  | "conflicting_context";

export type ObservationClaim = {
  behavior: ObservationBehavior;
  outcome: ObservationOutcome;
  speakerAttribution: "child_or_nearby_speaker" | "unknown";
  statedTotal?: number;
  countSequenceObserved: boolean;
  targetQuantity?: number;
  description: string;
  support: {
    status: "recorded" | "not_established";
    kinds: SupportKind[];
    sourceEventIds: string[];
    recordingSourceIds?: string[];
  };
  uncertaintyReasons: UncertaintyReason[];
};

export type ObservationSourceRole = "response" | "scene" | "support" | "exchange_context";
export type ObservationSource =
  | { eventId: string; role: ObservationSourceRole }
  | {
      sourceId: string;
      role: "recording_support";
      provenance: "recording_review";
      sessionId: string;
      recordingId: string;
      recordingStartMs: number;
      recordingEndMs: number;
      sessionStartMs: number;
      sessionEndMs: number;
    };

/** Immutable Observer output. Parent decisions are a different contract below. */
export type ObserverProposal = {
  kind: "observer_proposal";
  proposalId: string;
  sessionId: string;
  exchangeAtMs: number;
  observation: ObservationClaim;
  sources: ObservationSource[];
};

export type ParentDecision = {
  kind: "parent_decision";
  proposalId: string;
  decision: "accepted" | "corrected" | "rejected";
  reviewedAt: number;
  correction?: ObservationClaim;
  rejectionReason?: string;
  parentContext?: {
    provenance: "parent_review";
    note: string;
    assistance?: SupportKind[];
    pointingOrTouchCounting?: boolean;
  };
};

export type CanonicalObservationRecord = {
  session: { _id: string; state: string; recordStatus: string };
  recording?: { recordingId: string; startOffsetMs: number; durationMs: number };
  events: Array<{
    _id: string;
    atMs: number;
    evidence?: Evidence;
    timeline?: unknown;
  }>;
};

export type ValidationIssue = { path: string; message: string };
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

const oneOf = <T extends string>(value: unknown, choices: readonly T[]): value is T =>
  typeof value === "string" && choices.includes(value as T);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const nonnegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const nonnegativeFinite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const stringArray = (value: unknown, choices: readonly string[]) =>
  Array.isArray(value) && value.every(item => oneOf(item, choices));

const behaviorValues = ["quantity_identification", "counting_aloud_with_total", "uncertain_exchange"] as const;
const outcomeValues = ["correct", "incorrect", "uncertain"] as const;
const supportValues = ["hint", "choice", "modeled_answer", "counting_together", "parent_reported_assistance"] as const;
const uncertaintyValues = [
  "ambiguous_speaker",
  "unclear_speech",
  "silence",
  "missing_scene_context",
  "disrupted_exchange",
  "conflicting_context",
] as const;

function validateClaim(value: unknown, path: string, issues: ValidationIssue[]): value is ObservationClaim {
  if (!record(value)) {
    issues.push({ path, message: "must be an object" });
    return false;
  }
  const valid =
    oneOf(value.behavior, behaviorValues) &&
    oneOf(value.outcome, outcomeValues) &&
    oneOf(value.speakerAttribution, ["child_or_nearby_speaker", "unknown"] as const) &&
    typeof value.countSequenceObserved === "boolean" &&
    (value.targetQuantity === undefined
      ? value.behavior === "uncertain_exchange"
      : nonnegativeInteger(value.targetQuantity) && value.targetQuantity >= 1) &&
    nonEmpty(value.description) &&
    record(value.support) &&
    oneOf(value.support.status, ["recorded", "not_established"] as const) &&
    stringArray(value.support.kinds, supportValues) &&
    Array.isArray(value.support.sourceEventIds) &&
    value.support.sourceEventIds.every(nonEmpty) &&
    (value.support.recordingSourceIds === undefined ||
      (Array.isArray(value.support.recordingSourceIds) && value.support.recordingSourceIds.every(nonEmpty))) &&
    stringArray(value.uncertaintyReasons, uncertaintyValues) &&
    (value.statedTotal === undefined || nonnegativeInteger(value.statedTotal));
  if (!valid) {
    issues.push({ path, message: "has invalid or missing observation fields" });
    return false;
  }
  const claim = value as unknown as ObservationClaim;
  if (claim.behavior === "uncertain_exchange") {
    if (claim.outcome !== "uncertain" || claim.uncertaintyReasons.length === 0 || claim.statedTotal !== undefined) {
      issues.push({ path, message: "uncertain exchanges cannot assert an answer or omit their uncertainty reason" });
    }
  } else {
    if (claim.outcome === "uncertain" || claim.statedTotal === undefined || claim.uncertaintyReasons.length > 0) {
      issues.push({ path, message: "a concrete behavior needs a stated total and a determinate outcome" });
    }
    if (claim.behavior === "quantity_identification" && claim.countSequenceObserved) {
      issues.push({ path, message: "quantity identification cannot assert a spoken count sequence" });
    }
    if (claim.behavior === "counting_aloud_with_total" && !claim.countSequenceObserved) {
      issues.push({ path, message: "counting aloud requires an observed count sequence and total" });
    }
  }
  const recordingSourceIds = claim.support.recordingSourceIds ?? [];
  if (
    claim.support.status === "not_established" &&
    (claim.support.kinds.length || claim.support.sourceEventIds.length || recordingSourceIds.length)
  ) {
    issues.push({ path: `${path}.support`, message: "unestablished support cannot list help or source events" });
  }
  if (
    claim.support.status === "recorded" &&
    (!claim.support.kinds.length || (!claim.support.sourceEventIds.length && !recordingSourceIds.length))
  ) {
    issues.push({ path: `${path}.support`, message: "recorded support requires its kind and canonical source" });
  }
  return true;
}

export function validateObserverProposal(
  input: unknown,
  sourceRecord: CanonicalObservationRecord,
): ValidationResult<ObserverProposal> {
  const issues: ValidationIssue[] = [];
  if (!record(input)) return { ok: false, issues: [{ path: "$", message: "must be an object" }] };
  if (input.kind !== "observer_proposal") issues.push({ path: "kind", message: "must be observer_proposal" });
  if (!nonEmpty(input.proposalId)) issues.push({ path: "proposalId", message: "is required" });
  if (input.sessionId !== sourceRecord.session._id)
    issues.push({ path: "sessionId", message: "does not match the source session" });
  if (sourceRecord.session.state !== "ended" || sourceRecord.session.recordStatus === "pending") {
    issues.push({ path: "session", message: "observations require an ended, assembled session record" });
  }
  if (!nonnegativeInteger(input.exchangeAtMs))
    issues.push({ path: "exchangeAtMs", message: "must be session-relative milliseconds" });
  const observationInput = input.observation;
  const claimValid = validateClaim(observationInput, "observation", issues);
  const observation = claimValid ? observationInput : undefined;
  const validRoles = ["response", "scene", "support", "exchange_context"] as const;
  const sources = Array.isArray(input.sources) ? input.sources : [];
  if (!sources.length) issues.push({ path: "sources", message: "must reference canonical session events" });
  const sourceById = new Map(sourceRecord.events.map(event => [event._id, event]));
  const normalizedSources: ObservationSource[] = [];
  for (const [index, source] of sources.entries()) {
    if (record(source) && source.role === "recording_support") {
      const path = `sources.${index}`;
      const recording = sourceRecord.recording;
      const recordingStartMs = source.recordingStartMs;
      const recordingEndMs = source.recordingEndMs;
      const sessionStartMs = source.sessionStartMs;
      const sessionEndMs = source.sessionEndMs;
      const intervalValid =
        nonnegativeInteger(recordingStartMs) &&
        nonnegativeInteger(recordingEndMs) &&
        recordingEndMs > recordingStartMs &&
        nonnegativeInteger(sessionStartMs) &&
        nonnegativeInteger(sessionEndMs) &&
        sessionEndMs > sessionStartMs;
      if (
        !nonEmpty(source.sourceId) ||
        source.provenance !== "recording_review" ||
        source.sessionId !== sourceRecord.session._id ||
        source.sessionId !== input.sessionId ||
        !nonEmpty(source.recordingId) ||
        !recording ||
        source.recordingId !== recording.recordingId ||
        sourceRecord.session.recordStatus !== "complete"
      ) {
        issues.push({
          path,
          message: "recording support must identify the available recording for this complete session",
        });
        continue;
      }
      if (
        !nonnegativeInteger(recording.startOffsetMs) ||
        !nonnegativeFinite(recording.durationMs) ||
        recording.durationMs <= 0 ||
        !intervalValid ||
        recordingEndMs > recording.durationMs ||
        !Number.isSafeInteger(recording.startOffsetMs + recordingStartMs) ||
        !Number.isSafeInteger(recording.startOffsetMs + recordingEndMs) ||
        sessionStartMs !== recording.startOffsetMs + recordingStartMs ||
        sessionEndMs !== recording.startOffsetMs + recordingEndMs
      ) {
        issues.push({ path, message: "recording support interval must be in bounds and map exactly to session time" });
        continue;
      }
      normalizedSources.push({
        sourceId: source.sourceId,
        role: "recording_support",
        provenance: "recording_review",
        sessionId: source.sessionId,
        recordingId: source.recordingId,
        recordingStartMs,
        recordingEndMs,
        sessionStartMs,
        sessionEndMs,
      });
      continue;
    }
    if (!record(source) || !nonEmpty(source.eventId) || !oneOf(source.role, validRoles)) {
      issues.push({ path: `sources.${index}`, message: "must identify a canonical event and role" });
      continue;
    }
    const event = sourceById.get(source.eventId);
    if (!event?.evidence) {
      issues.push({
        path: `sources.${index}.eventId`,
        message: "must reference learner evidence, not generated or control timeline data",
      });
      continue;
    }
    const matchesRole =
      (source.role === "response" && event.evidence.type === "utterance") ||
      (source.role === "scene" && event.evidence.type === "scene_displayed") ||
      (source.role === "support" && event.evidence.type === "support") ||
      source.role === "exchange_context";
    if (!matchesRole) issues.push({ path: `sources.${index}.role`, message: "does not match the referenced event" });
    normalizedSources.push({ eventId: source.eventId, role: source.role });
  }
  if (observation) {
    const supportSourceIds = new Set(
      normalizedSources
        .filter(
          (source): source is ObservationSource & { eventId: string; role: "support" } => source.role === "support",
        )
        .map(source => source.eventId),
    );
    for (const eventId of observation.support.sourceEventIds) {
      const event = sourceById.get(eventId);
      if (event?.evidence?.type !== "support") {
        issues.push({
          path: "observation.support.sourceEventIds",
          message: "must reference canonical support evidence",
        });
      }
      if (!supportSourceIds.has(eventId)) {
        issues.push({ path: "sources", message: "must include each support event cited by the observation" });
      }
      if (
        event?.evidence?.type === "support" &&
        observation.support.kinds.includes("parent_reported_assistance") &&
        event.evidence.source !== "parent"
      ) {
        issues.push({
          path: "observation.support.kinds",
          message: "parent-reported assistance must cite a parent-source event",
        });
      }
    }
    const recordingSupportSources = normalizedSources.filter(
      (source): source is Extract<ObservationSource, { role: "recording_support" }> =>
        source.role === "recording_support",
    );
    const citedRecordingSupportIds = new Set(observation.support.recordingSourceIds ?? []);
    for (const sourceId of citedRecordingSupportIds) {
      if (!recordingSupportSources.some(source => source.sourceId === sourceId)) {
        issues.push({
          path: "observation.support.recordingSourceIds",
          message: "must reference recording support sources",
        });
      }
    }
    for (const source of recordingSupportSources) {
      if (!citedRecordingSupportIds.has(source.sourceId)) {
        issues.push({
          path: "observation.support.recordingSourceIds",
          message: "must cite each recording support source",
        });
      }
    }
    if (citedRecordingSupportIds.size > 0 && observation.support.kinds.includes("parent_reported_assistance")) {
      issues.push({
        path: "observation.support.kinds",
        message: "parent-reported assistance must retain parent_review provenance",
      });
    }
  }
  const responseSource = normalizedSources.find(
    (source): source is ObservationSource & { eventId: string; role: "response" } => source.role === "response",
  );
  const sceneSource = normalizedSources.find(
    (source): source is ObservationSource & { eventId: string; role: "scene" } => source.role === "scene",
  );
  const responseEvent = responseSource && sourceById.get(responseSource.eventId);
  const sceneEvent = sceneSource && sourceById.get(sceneSource.eventId);
  const displayedScenes = sourceRecord.events.filter(event => event.evidence?.type === "scene_displayed");
  if (responseEvent && responseEvent.atMs !== input.exchangeAtMs) {
    issues.push({
      path: "exchangeAtMs",
      message: "must use the referenced response event's session-relative timestamp",
    });
  }
  if (responseEvent?.evidence?.type === "utterance") {
    for (const source of normalizedSources) {
      if (source.role === "recording_support" && source.sessionStartMs > (responseEvent.evidence.endMs ?? -1)) {
        issues.push({
          path: "sources",
          message: "recording support must occur before or during the referenced response",
        });
      }
    }
  }
  if (responseEvent?.evidence?.type === "utterance" && observation) {
    const { startMs, endMs } = responseEvent.evidence;
    const hasSpeechInterval =
      typeof startMs === "number" &&
      Number.isFinite(startMs) &&
      startMs >= 0 &&
      typeof endMs === "number" &&
      Number.isFinite(endMs) &&
      endMs >= startMs;
    const scenesBeforeSpeech = hasSpeechInterval ? displayedScenes.filter(event => event.atMs < startMs) : [];
    const latestPriorSceneAt = Math.max(...scenesBeforeSpeech.map(event => event.atMs), -1);
    const latestPriorScenes = scenesBeforeSpeech.filter(event => event.atMs === latestPriorSceneAt);
    const transitionsDuringSpeech = hasSpeechInterval
      ? displayedScenes.some(event => event.atMs >= startMs && event.atMs <= endMs)
      : false;
    const citedSceneIsCurrent = latestPriorScenes.length === 1 && latestPriorScenes[0]._id === sceneEvent?._id;
    if (observation.behavior !== "uncertain_exchange") {
      if (!hasSpeechInterval) {
        issues.push({
          path: "sources",
          message: "a concrete behavior requires trustworthy speech start and end timestamps",
        });
      } else if (transitionsDuringSpeech || !citedSceneIsCurrent) {
        issues.push({
          path: "sources",
          message: "a concrete behavior requires the uniquely displayed scene throughout the response interval",
        });
      }
    } else if (
      (!hasSpeechInterval || transitionsDuringSpeech || !citedSceneIsCurrent) &&
      !observation.uncertaintyReasons.includes("missing_scene_context") &&
      !observation.uncertaintyReasons.includes("conflicting_context")
    ) {
      issues.push({
        path: "observation.uncertaintyReasons",
        message: "missing or ambiguous scene timing must be recorded as uncertainty",
      });
    }
    if (responseEvent.evidence.speaker === "sprout") {
      issues.push({ path: "sources", message: "generated Sprout utterances are not learner response evidence" });
    } else if (observation.speakerAttribution !== responseEvent.evidence.speaker) {
      issues.push({
        path: "observation.speakerAttribution",
        message: "must match the canonical response speaker attribution",
      });
    }
    if (responseEvent.evidence.speaker === "unknown" && observation.behavior !== "uncertain_exchange") {
      issues.push({
        path: "observation.speakerAttribution",
        message: "unknown speaker attribution cannot support a concrete learner behavior",
      });
    }
    if (responseEvent.evidence.speaker === "unknown" && !observation.uncertaintyReasons.includes("ambiguous_speaker")) {
      issues.push({
        path: "observation.uncertaintyReasons",
        message: "unknown attribution must be represented as ambiguous",
      });
    }
    if (responseEvent.evidence.state === "interrupted" && observation.behavior !== "uncertain_exchange") {
      issues.push({
        path: "observation.behavior",
        message: "an interrupted response cannot support a determinate conclusion",
      });
    }
  }
  if (
    observation &&
    sceneEvent?.evidence?.type === "scene_displayed" &&
    observation.targetQuantity !== undefined &&
    observation.targetQuantity !== sceneEvent.evidence.targetQuantity
  ) {
    issues.push({
      path: "observation.targetQuantity",
      message: "must match the quantity in the referenced displayed scene",
    });
  }
  if (
    observation?.outcome === "correct" &&
    sceneEvent?.evidence?.type === "scene_displayed" &&
    observation.statedTotal !== sceneEvent.evidence.targetQuantity
  ) {
    issues.push({ path: "observation.statedTotal", message: "cannot be marked correct against the referenced scene" });
  }
  if (observation?.outcome === "incorrect" && observation.statedTotal === observation.targetQuantity) {
    issues.push({ path: "observation.outcome", message: "a correct total cannot be marked incorrect" });
  }
  if (!responseEvent && observation?.behavior !== "uncertain_exchange") {
    issues.push({ path: "sources", message: "a concrete behavior requires a referenced response utterance" });
  }
  if (!sceneEvent && observation?.behavior !== "uncertain_exchange") {
    issues.push({ path: "sources", message: "a concrete behavior requires the actually displayed scene" });
  }
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    value: {
      kind: "observer_proposal",
      proposalId: input.proposalId as string,
      sessionId: input.sessionId as string,
      exchangeAtMs: input.exchangeAtMs as number,
      observation: input.observation as ObservationClaim,
      sources: normalizedSources,
    },
  };
}

export function validateParentDecision(input: unknown): ValidationResult<ParentDecision> {
  const issues: ValidationIssue[] = [];
  if (!record(input)) return { ok: false, issues: [{ path: "$", message: "must be an object" }] };
  if (input.kind !== "parent_decision") issues.push({ path: "kind", message: "must be parent_decision" });
  if (!nonEmpty(input.proposalId)) issues.push({ path: "proposalId", message: "must link to the original proposal" });
  if (!oneOf(input.decision, ["accepted", "corrected", "rejected"] as const)) {
    issues.push({ path: "decision", message: "must be accepted, corrected, or rejected" });
  }
  if (typeof input.reviewedAt !== "number" || !Number.isFinite(input.reviewedAt) || input.reviewedAt < 0) {
    issues.push({ path: "reviewedAt", message: "must be a nonnegative review timestamp" });
  }
  if (input.decision === "corrected") validateClaim(input.correction, "correction", issues);
  else if (input.correction !== undefined)
    issues.push({ path: "correction", message: "is only valid for a corrected decision" });
  if (input.decision === "rejected" && !nonEmpty(input.rejectionReason)) {
    issues.push({ path: "rejectionReason", message: "a rejected proposal needs a reason" });
  }
  if (input.decision !== "rejected" && input.rejectionReason !== undefined) {
    issues.push({ path: "rejectionReason", message: "is only valid for a rejected decision" });
  }
  if (input.parentContext !== undefined) {
    if (
      !record(input.parentContext) ||
      input.parentContext.provenance !== "parent_review" ||
      !nonEmpty(input.parentContext.note)
    ) {
      issues.push({
        path: "parentContext",
        message: "added context requires an explicit parent_review provenance and note",
      });
    } else if (
      (input.parentContext.assistance !== undefined && !stringArray(input.parentContext.assistance, supportValues)) ||
      (input.parentContext.pointingOrTouchCounting !== undefined &&
        typeof input.parentContext.pointingOrTouchCounting !== "boolean")
    ) {
      issues.push({ path: "parentContext", message: "has invalid parent-reported context" });
    }
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, value: input as ParentDecision };
}
