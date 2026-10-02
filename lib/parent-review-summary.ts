import type { ObservationClaim, ParentDecision } from "./observation-contracts";
import type { ReviewSnapshot } from "./parent-review";
import { reviewedObserverClaim } from "./reviewed-observation";

const words = (value: string) => value.replaceAll("_", " ");
export const repairLabels = { verified: "Nothing", light_correction: "A little", substantial_repair: "A lot" };

function context(
  claim: ObservationClaim,
  decision?: ParentDecision,
  helpCandidates: NonNullable<ReviewSnapshot["helpCandidates"]> = [],
): string {
  const support =
    claim.support.status === "recorded"
      ? `Recorded help: ${claim.support.kinds.map(words).join(", ")}.`
      : "No verified help is linked in the cited sources.";
  const candidateHelp = helpCandidates.some(candidate => candidate.kind === "instructional_help")
    ? " An instructional-help phrase was generated for this displayed group, but delivery and timing against the response are unverified; review the recording."
    : "";
  const candidateClarification = helpCandidates.some(candidate => candidate.kind === "clarification")
    ? " A neutral clarification phrase was generated; it is not a counting hint, and delivery is unverified."
    : "";
  const uncertainty =
    claim.uncertaintyReasons.length && claim.behavior !== "uncertain_exchange"
      ? ` Uncertainty: ${claim.uncertaintyReasons.map(words).join(", ")}.`
      : "";
  const speaker =
    claim.speakerAttribution === "unknown" ? " Speaker unknown." : " Speaker may be the child or someone nearby.";
  const parent = decision?.parentContext;
  return `${support}${candidateHelp}${candidateClarification}${speaker}${uncertainty}${parent?.assistance?.length ? " You reported helping." : ""}${parent?.pointingOrTouchCounting ? " You reported pointing or touch-counting." : ""}${parent ? ` Parent context: ${parent.note}` : ""}`;
}

/** Presentation only. Never adds evidence or summarizes unvalidated free-text model conclusions. */
export function observationSummary(snapshot: ReviewSnapshot): { text: string; detail: string }[] {
  if (snapshot.status !== "ready") return [];
  const decisions = new Map(snapshot.decisions.map(row => [row.proposalRowId, row.decision]));
  const groups: {
    claim: ObservationClaim;
    decision?: ParentDecision;
    quantities: number[];
    proposalIds: string[];
    key: string;
  }[] = [];
  for (const row of snapshot.proposals) {
    const decision = decisions.get(row.id);
    const claim = decision?.correction ?? row.proposal.observation;
    if (row.resolution === "reject_only" && decision?.decision !== "rejected") {
      groups.push({ claim, decision, quantities: [], proposalIds: [row.id], key: `timing:${row.id}` });
      continue;
    }
    // Corrections/rejections remain separate; recorded support source identities must also match.
    const mergeable =
      (!decision || decision.decision === "accepted") &&
      claim.behavior === "quantity_identification" &&
      claim.outcome === "correct" &&
      !claim.uncertaintyReasons.length;
    const key = mergeable
      ? JSON.stringify({ ...claim, description: undefined, targetQuantity: undefined, statedTotal: undefined })
      : row.id;
    const prior = mergeable ? groups.find(group => group.key === key) : undefined;
    if (prior) {
      prior.quantities.push(claim.targetQuantity!);
      prior.proposalIds.push(row.id);
    } else
      groups.push({
        claim,
        decision,
        quantities: claim.targetQuantity === undefined ? [] : [claim.targetQuantity],
        proposalIds: [row.id],
        key,
      });
  }
  return groups.map(({ claim, decision, quantities, proposalIds, key }) => {
    if (key.startsWith("timing:"))
      return {
        text: "Saved observation has unverified speech timing.",
        detail: "Its conclusion cannot be used as learning evidence. Reject it if undecided, then finish review.",
      };
    const unique = [...new Set(quantities)];
    const text =
      decision?.decision === "rejected"
        ? `Excluded from reviewed evidence: ${decision.rejectionReason}`
        : unique.length > 1
          ? `The displayed quantities ${unique.join(", ")} were identified correctly.`
          : quantities.length > 1
            ? `The displayed quantity ${unique[0]} was identified correctly in ${quantities.length} recorded responses.`
            : reviewedObserverClaim(claim).description;
    const sceneIds = new Set(
      proposalIds.flatMap(id => {
        const proposal = snapshot.proposals.find(row => row.id === id)?.proposal;
        const sceneRef = proposal?.sources.find(source => source.role === "scene" && "eventId" in source);
        if (!sceneRef || !("eventId" in sceneRef)) return [];
        const evidence = snapshot.sources.find(source => source.id === sceneRef.eventId)?.evidence;
        return evidence?.type === "scene_displayed" ? [evidence.sceneId] : [];
      }),
    );
    const candidates = (snapshot.helpCandidates ?? []).filter(
      candidate => !candidate.sceneId || sceneIds.has(candidate.sceneId),
    );
    return {
      text: decision?.decision === "corrected" ? `Corrected: ${claim.description} ${text}` : text,
      detail: context(claim, decision, candidates),
    };
  });
}
