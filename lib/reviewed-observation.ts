import type { ObservationClaim } from "./observation-contracts";

/** The approved Observer interpretation is its validated structured claim.
 * Raw model prose stays on the immutable proposal, never on accepted planner evidence. */
export function reviewedObserverClaim(claim: ObservationClaim): ObservationClaim {
  let description: string;
  if (claim.behavior === "uncertain_exchange") {
    description = `This exchange is uncertain: ${claim.uncertaintyReasons.map(reason => reason.replaceAll("_", " ")).join(", ")}.`;
  } else if (claim.outcome === "correct") {
    description =
      claim.behavior === "quantity_identification"
        ? `The displayed quantity ${claim.targetQuantity} was identified correctly.`
        : `A spoken count sequence and correct total were recorded for ${claim.targetQuantity}.`;
  } else {
    description = `For the displayed quantity ${claim.targetQuantity}, the recorded total was ${claim.statedTotal ?? "unclear"} (${claim.outcome}).`;
  }
  return { ...claim, description };
}
