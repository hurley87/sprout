import { sessionSpeechInterval } from "./evidence-timing";
import { validateParentDecision, type ObserverProposal, type ParentDecision } from "./observation-contracts";
import type { Evidence } from "./session-recorder";
import { isDurableSessionReference } from "./durable-session-reference";

export type RepairLevel = "verified" | "light_correction" | "substantial_repair";
export type ReviewSnapshot = {
  sessionId: string;
  analysisId: string | null;
  status: "not_started" | "pending" | "running" | "failed" | "ready";
  qualification: string | null;
  proposals: { id: string; proposal: ObserverProposal; resolution?: "reject_only" }[];
  decisions: { proposalRowId: string; decision: ParentDecision }[];
  review: { repairLevel: RepairLevel; note?: string; emptyAcknowledged: boolean; completedAt: number } | null;
  sources: { id: string; eventKey: string; atMs: number; evidence: Evidence }[];
};

/** Session time only; the inspector applies the recording offset when seeking. */
export function reviewPlaybackAtMs(proposal: ObserverProposal, sources: ReviewSnapshot["sources"]): number {
  const response = proposal.sources.find(source => source.role === "response" && "eventId" in source);
  const evidence =
    response && "eventId" in response ? sources.find(source => source.id === response.eventId)?.evidence : undefined;
  const interval = sessionSpeechInterval(evidence);
  if (evidence?.type === "utterance" && evidence.speaker !== "sprout") {
    if (interval) return interval.startMs;
    // Arrival is an approximate review anchor, never an acoustic timestamp.
    if (
      typeof evidence.firstObservedAtMs === "number" &&
      Number.isFinite(evidence.firstObservedAtMs) &&
      evidence.firstObservedAtMs >= 0
    )
      return evidence.firstObservedAtMs;
  }
  return proposal.exchangeAtMs;
}
export type ReviewCommand =
  | { operation: "get"; sessionId: string }
  | {
      operation: "decide";
      sessionId: string;
      analysisId: string;
      proposalRowId: string;
      decision: Omit<ParentDecision, "reviewedAt">;
    }
  | {
      operation: "acceptAll" | "complete";
      sessionId: string;
      analysisId: string;
      repairLevel?: RepairLevel;
      note?: string;
      acknowledgeEmpty?: boolean;
    };

export function validReviewCommand(input: unknown): input is ReviewCommand {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const x = input as Record<string, unknown>;
  if (!isDurableSessionReference(x.sessionId)) return false;
  const allowed =
    x.operation === "get"
      ? ["operation", "sessionId"]
      : x.operation === "decide"
        ? ["operation", "sessionId", "analysisId", "proposalRowId", "decision"]
        : [
            "operation",
            "sessionId",
            "analysisId",
            "note",
            "acknowledgeEmpty",
            ...(x.operation === "complete" ? ["repairLevel"] : []),
          ];
  if (Object.keys(x).some(k => !allowed.includes(k))) return false;
  if (x.operation === "get") return true;
  if (!isDurableSessionReference(x.analysisId)) return false;
  if (x.operation === "decide") {
    if (
      !isDurableSessionReference(x.proposalRowId) ||
      !x.decision ||
      typeof x.decision !== "object" ||
      "reviewedAt" in x.decision
    )
      return false;
    return validateParentDecision({ ...x.decision, reviewedAt: 0 }).ok;
  }
  if (x.operation !== "acceptAll" && x.operation !== "complete") return false;
  return (
    (x.operation !== "complete" ||
      ["verified", "light_correction", "substantial_repair"].includes(x.repairLevel as string)) &&
    (x.note === undefined || (typeof x.note === "string" && x.note.trim().length > 0 && x.note.length <= 1000)) &&
    (x.acknowledgeEmpty === undefined || typeof x.acknowledgeEmpty === "boolean")
  );
}
