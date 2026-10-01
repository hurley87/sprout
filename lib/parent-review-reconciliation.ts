import type { ReviewCommand, ReviewSnapshot } from "./parent-review";

export type ReviewWrite = Exclude<ReviewCommand, { operation: "get" }>;
type Reconciliation =
  { outcome: "saved" | "conflict"; message: string } | { outcome: "unresolved"; retryable: boolean; message: string };

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

/** Only a same-session, same-analysis READY read can establish a write's outcome.
 * Immutable incompatible state proves the payload cannot land. Absence (including
 * partial accept-all) does not: retain the original command and prevent competing writes.
 * Compare stored input values exactly, ignoring only backend-owned timestamps.
 */
export function reconcileReviewWrite(command: ReviewWrite, saved: ReviewSnapshot): Reconciliation {
  if (saved.sessionId !== command.sessionId || saved.analysisId !== command.analysisId || saved.status !== "ready")
    return {
      outcome: "unresolved",
      retryable: false,
      message: "Save outcome is unresolved for the original analysis. Refresh before retrying.",
    };
  const conflict = (detail: string): Reconciliation => ({
    outcome: "conflict",
    message: `Save conflict: ${detail} The saved result is shown below; the attempted save will not be retried.`,
  });
  const success: Reconciliation = {
    outcome: "saved",
    message: "The intended save is already confirmed in saved review state.",
  };
  if (command.operation === "decide") {
    const proposal = saved.proposals.find(row => row.id === command.proposalRowId);
    if (!proposal || proposal.proposal.proposalId !== command.decision.proposalId)
      return {
        outcome: "unresolved",
        retryable: false,
        message: "Save outcome is unresolved for the original proposal. Refresh before retrying.",
      };
    const prior = saved.decisions.find(row => row.proposalRowId === proposal.id);
    if (prior) {
      const { reviewedAt, ...input } = prior.decision;
      void reviewedAt;
      return stable(input) === stable(command.decision)
        ? success
        : conflict(
            `Proposal ${proposal.proposal.proposalId} already has a different immutable ${prior.decision.decision} decision.`,
          );
    }
    if (saved.review) return conflict("Review is already complete.");
  } else {
    const empty = saved.proposals.length === 0;
    if ((empty && command.acknowledgeEmpty !== true) || (!empty && command.acknowledgeEmpty === true))
      return conflict("Empty-summary acknowledgment does not match the saved proposals.");
    const incompatible = saved.decisions.find(row => row.decision.decision !== "accepted");
    if (incompatible && (command.operation === "acceptAll" || command.repairLevel === "verified"))
      return conflict(
        `Proposal ${incompatible.decision.proposalId} is already ${incompatible.decision.decision}; unchanged acceptance/completion is unavailable.`,
      );
    if (saved.review) {
      const allDecided = saved.proposals.every(row =>
        saved.decisions.some(decision => decision.proposalRowId === row.id),
      );
      const matches =
        saved.review.repairLevel === (command.operation === "acceptAll" ? "verified" : command.repairLevel) &&
        saved.review.note === command.note &&
        saved.review.emptyAcknowledged === empty;
      return matches && allDecided
        ? success
        : conflict("Review already has different immutable completion metadata or decisions.");
    }
  }
  return {
    outcome: "unresolved",
    retryable: true,
    message: "Save is still unconfirmed. Retry uses the exact original payload; other review actions remain paused.",
  };
}
