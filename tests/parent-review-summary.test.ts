import { expect, it } from "vitest";
import { observationSummary } from "../lib/parent-review-summary";
import type { ReviewSnapshot } from "../lib/parent-review";
import { observationFixtures } from "./fixtures/observation-contracts";
function fixture(): ReviewSnapshot {
  const proposal = observationFixtures[0].proposal!;
  return {
    sessionId: proposal.sessionId,
    analysisId: "synthetic",
    status: "ready",
    qualification: null,
    review: null,
    sources: [],
    decisions: [],
    proposals: [1, 2, 3].map(quantity => ({
      id: `row-${quantity}`,
      proposal: {
        ...structuredClone(proposal),
        proposalId: `p${quantity}`,
        observation: { ...structuredClone(proposal.observation), targetQuantity: quantity, statedTotal: quantity },
      },
    })),
  };
}
it("aggregates only compatible correct totals without promoting free-text model conclusions", () => {
  const state = fixture();
  state.proposals[0].proposal.observation.description = "Mastered counting independently while pointing.";
  const before = structuredClone(state);
  expect(observationSummary(state)).toEqual([
    {
      text: "The displayed quantities 1, 2, 3 were identified correctly.",
      detail: "Help was not established in the record. Speaker may be the child or someone nearby.",
    },
  ]);
  expect(state).toEqual(before);
});
it.each(["support", "uncertainty", "outcome", "speaker", "counting"])("keeps differing %s separate", difference => {
  const state = fixture();
  const claim = state.proposals[1].proposal.observation;
  if (difference === "support") claim.support = { status: "recorded", kinds: ["hint"], sourceEventIds: ["help"] };
  if (difference === "uncertainty") {
    claim.behavior = "uncertain_exchange";
    claim.outcome = "uncertain";
    claim.uncertaintyReasons = ["unclear_speech"];
  }
  if (difference === "outcome") {
    claim.outcome = "incorrect";
    claim.statedTotal = 4;
  }
  if (difference === "speaker") claim.speakerAttribution = "unknown";
  if (difference === "counting") {
    claim.behavior = "counting_aloud_with_total";
    claim.countSequenceObserved = true;
  }
  expect(observationSummary(state)).toHaveLength(2);
});
it("retains correction, assistance, pointing and rejection independently of remaining proposals", () => {
  const state = fixture();
  state.decisions = [
    {
      proposalRowId: "row-1",
      decision: {
        kind: "parent_decision",
        proposalId: "p1",
        decision: "corrected",
        reviewedAt: 1,
        correction: { ...state.proposals[0].proposal.observation, description: "I gave the answer." },
        parentContext: {
          provenance: "parent_review",
          note: "We counted together.",
          assistance: ["parent_reported_assistance"],
          pointingOrTouchCounting: true,
        },
      },
    },
    {
      proposalRowId: "row-2",
      decision: {
        kind: "parent_decision",
        proposalId: "p2",
        decision: "rejected",
        reviewedAt: 1,
        rejectionReason: "Someone else spoke.",
      },
    },
  ];
  const summary = observationSummary(state);
  expect(summary).toHaveLength(3);
  expect(summary[0].text).toContain("I gave the answer.");
  expect(summary[0].detail).toContain("You reported helping. You reported pointing or touch-counting.");
  expect(summary[1].text).toBe("Excluded from reviewed evidence: Someone else spoke.");
});
it("does not produce observations from empty or unsuccessful analysis", () => {
  const state = fixture();
  state.proposals = [];
  expect(observationSummary(state)).toEqual([]);
});

it.each(["not_started", "pending", "running", "failed"] as const)(
  "never presents %s proposals as a successful summary",
  status => {
    expect(observationSummary({ ...fixture(), status })).toEqual([]);
  },
);
