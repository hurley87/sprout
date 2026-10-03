import { sessionSpeechInterval } from "./evidence-timing";
import {
  validateObserverProposal,
  type CanonicalObservationRecord,
  type ObserverProposal,
  type ValidationResult,
} from "./observation-contracts";

export const MAX_OBSERVER_ROWS = 1000;
// Counts and coverage use the whole bounded batch; only displayed trace detail is truncated.
export const DIAGNOSTIC_DETAIL_LIMIT = 8;
export type ObserverFailureStage =
  "recording" | "provider_setup" | "transcription" | "proposal" | "provider_validation" | "publication";
const byteLength = (value: string) => new TextEncoder().encode(value).length;
const short = (value: string) => {
  let result = "";
  let bytes = 0;
  for (const character of value) {
    bytes += byteLength(character);
    if (bytes > 200) break;
    result += character;
  }
  return result;
};
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export type ObserverDiagnosticRow =
  | {
      kind: "response";
      eventId: string;
      atMs: number;
      coverage: "returned" | "absent" | "unknown";
      omissionCause: "unknown" | null;
      returnedCount: number;
      rejectedCount: number;
      proposalOrdinals: number[];
      fragmentKeys: string[];
      traceTruncated: boolean;
      speaker: "child_or_nearby_speaker" | "unknown";
      state: "finalized" | "interrupted";
      trustedTiming: boolean;
    }
  | {
      kind: "proposal";
      ordinal: number;
      proposalId: string | null;
      status: "valid" | "rejected";
      responseEventIds: string[];
      responseCount: number;
      issues: { path: string; message: string }[];
      issueCount: number;
      traceTruncated: boolean;
      timestampRepaired: boolean;
    };

export type ObserverDiagnostics = {
  version: 1;
  outputState: "usable" | "unavailable" | "invalid_batch";
  boundary: "provider_validation" | "publication" | "before_output";
  failureStage: ObserverFailureStage | null;
  returnedProposalCount: number | null;
  rejectedProposalCount: number;
  responseCount: number;
  sceneEventCount: number;
  absentResponseCount: number | null;
  batchIssue: { path: string; message: string } | null;
  rows: ObserverDiagnosticRow[];
};

export function observationRecordFromSnapshot(inputSnapshot: string): CanonicalObservationRecord {
  const snapshot = JSON.parse(inputSnapshot);
  return {
    session: { _id: snapshot.sessionId, state: snapshot.state, recordStatus: snapshot.recordStatus },
    ...(snapshot.recording
      ? { recording: { recordingId: `${snapshot.sessionId}:recording`, ...snapshot.recording } }
      : {}),
    events: snapshot.events.map((event: CanonicalObservationRecord["events"][number]) => ({
      ...event,
      evidence: event.evidence ?? undefined,
      timeline: event.timeline ?? undefined,
    })),
  };
}

/** Uses the existing claim validator; this does not introduce another evidence policy. */
export function diagnoseObserverOutput(
  record: CanonicalObservationRecord,
  output: unknown,
  boundary: ObserverDiagnostics["boundary"],
  validate: (input: unknown) => ValidationResult<ObserverProposal> = input => validateObserverProposal(input, record),
): { diagnostics: ObserverDiagnostics; results: ValidationResult<ObserverProposal>[] } {
  const usable = Array.isArray(output) && output.length <= MAX_OBSERVER_ROWS;
  const results = usable ? output.map(validate) : [];
  const responses = record.events.filter(
    event => event.evidence?.type === "utterance" && event.evidence.speaker !== "sprout",
  );
  const responseIds = new Set(responses.map(event => event._id));
  const references = new Map<string, { ordinals: number[]; total: number; rejected: number }>();
  const rows: ObserverDiagnosticRow[] = [];
  if (usable) {
    for (const [ordinal, raw] of output.entries()) {
      const result = results[ordinal];
      // Retain declared references to actual snapshot responses even when role/claim
      // validation rejects them. This records output presence, not a valid association.
      const ids = new Set<string>();
      if (object(raw) && Array.isArray(raw.sources)) {
        for (const source of raw.sources) {
          if (object(source) && typeof source.eventId === "string" && responseIds.has(source.eventId))
            ids.add(source.eventId);
        }
      }
      if (object(raw) && object(raw.observation) && object(raw.observation.support)) {
        const supportIds = raw.observation.support.sourceEventIds;
        if (Array.isArray(supportIds)) {
          for (const id of supportIds) if (typeof id === "string" && responseIds.has(id)) ids.add(id);
        }
      }
      for (const id of ids) {
        const refs = references.get(id) ?? { ordinals: [], total: 0, rejected: 0 };
        refs.total++;
        if (!result.ok) refs.rejected++;
        if (refs.ordinals.length < DIAGNOSTIC_DETAIL_LIMIT) refs.ordinals.push(ordinal);
        references.set(id, refs);
      }
      const issues = result.ok ? [] : result.issues;
      rows.push({
        kind: "proposal",
        ordinal,
        proposalId: object(raw) && typeof raw.proposalId === "string" ? short(raw.proposalId) : null,
        status: result.ok ? "valid" : "rejected",
        responseEventIds: [...ids].slice(0, DIAGNOSTIC_DETAIL_LIMIT),
        responseCount: ids.size,
        issues: issues
          .slice(0, DIAGNOSTIC_DETAIL_LIMIT)
          .map(issue => ({ path: short(issue.path), message: short(issue.message) })),
        issueCount: issues.length,
        traceTruncated:
          ids.size > DIAGNOSTIC_DETAIL_LIMIT ||
          issues.length > DIAGNOSTIC_DETAIL_LIMIT ||
          issues.some(issue => byteLength(issue.path) > 200 || byteLength(issue.message) > 200) ||
          (object(raw) && typeof raw.proposalId === "string" && byteLength(raw.proposalId) > 200),
        timestampRepaired: result.ok && object(raw) && raw.exchangeAtMs !== result.value.exchangeAtMs,
      });
    }
  }
  for (const event of responses) {
    const evidence = event.evidence!;
    if (evidence.type !== "utterance" || evidence.speaker === "sprout") continue;
    const refs = references.get(event._id) ?? { ordinals: [], total: 0, rejected: 0 };
    const fragments = evidence.transcriptFragments?.map(fragment => fragment.key) ?? [];
    rows.push({
      kind: "response",
      eventId: event._id,
      atMs: event.atMs,
      coverage: usable ? (refs.total ? "returned" : "absent") : "unknown",
      omissionCause: usable && !refs.total ? "unknown" : null,
      returnedCount: refs.total,
      rejectedCount: refs.rejected,
      proposalOrdinals: refs.ordinals,
      fragmentKeys: fragments.slice(0, DIAGNOSTIC_DETAIL_LIMIT).map(short),
      traceTruncated:
        refs.total > DIAGNOSTIC_DETAIL_LIMIT ||
        fragments.length > DIAGNOSTIC_DETAIL_LIMIT ||
        fragments.some(key => byteLength(key) > 200),
      speaker: evidence.speaker,
      state: evidence.state,
      trustedTiming: !!sessionSpeechInterval(evidence),
    });
  }
  return {
    results,
    diagnostics: {
      version: 1,
      outputState: usable ? "usable" : output === undefined ? "unavailable" : "invalid_batch",
      boundary,
      failureStage: null,
      returnedProposalCount: Array.isArray(output) ? output.length : null,
      rejectedProposalCount: results.filter(result => !result.ok).length,
      responseCount: responses.length,
      sceneEventCount: record.events.filter(event => event.evidence?.type === "scene_displayed").length,
      absentResponseCount: usable ? responses.filter(event => !references.has(event._id)).length : null,
      batchIssue:
        !usable && output !== undefined
          ? { path: "$", message: "Proposal batch must be an array of at most 1,000 rows." }
          : null,
      rows,
    },
  };
}
