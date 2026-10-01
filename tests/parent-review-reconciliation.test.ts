import { expect, it } from "vitest";
import { reconcileReviewWrite, type ReviewWrite } from "../lib/parent-review-reconciliation";
import type { ReviewSnapshot } from "../lib/parent-review";
import { observationFixtures } from "./fixtures/observation-contracts";

function fixture(count = 2) {
  const saved: ReviewSnapshot = {
    sessionId: "session",
    analysisId: "analysis",
    status: "ready",
    qualification: null,
    proposals: Array.from({ length: count }, (_, i) => ({
      id: `row-${i}`,
      proposal: { ...structuredClone(observationFixtures[0].proposal!), proposalId: `p${i}` },
    })),
    decisions: [],
    review: null,
    sources: [],
  };
  const command: ReviewWrite = {
    operation: "decide",
    sessionId: saved.sessionId,
    analysisId: "analysis",
    proposalRowId: "row-0",
    decision: { kind: "parent_decision", proposalId: "p0", decision: "accepted" },
  };
  return { saved, command, scope: { sessionId: saved.sessionId, analysisId: "analysis" } };
}
it("resolves identical input regardless of key order or backend time; preserves the snapshot", () => {
  const { saved, command } = fixture();
  saved.decisions.push({
    proposalRowId: "row-0",
    decision: { decision: "accepted", proposalId: "p0", kind: "parent_decision", reviewedAt: 1234 },
  });
  const original = structuredClone(saved);
  expect(reconcileReviewWrite(command, saved).outcome).toBe("saved");
  expect(saved).toEqual(original);
});
it("requires canonical scope and proposal identity; absence remains unresolved", () => {
  const { saved, command } = fixture();
  expect(reconcileReviewWrite(command, saved)).toMatchObject({ outcome: "unresolved", retryable: true });
  for (const changed of [
    { sessionId: "other" },
    { analysisId: "other" },
    { status: "failed" as const },
    { proposals: [] },
  ])
    expect(reconcileReviewWrite(command, { ...saved, ...changed })).toMatchObject({
      outcome: "unresolved",
      retryable: false,
    });
});
it("recognizes rejection reasons and all correction/context values as immutable inputs", () => {
  const { saved, scope } = fixture();
  for (const decision of [
    {
      kind: "parent_decision" as const,
      proposalId: "p0",
      decision: "rejected" as const,
      rejectionReason: "Parent speaking",
    },
    {
      kind: "parent_decision" as const,
      proposalId: "p0",
      decision: "corrected" as const,
      correction: saved.proposals[0].proposal.observation,
      parentContext: { provenance: "parent_review" as const, note: "I helped", pointingOrTouchCounting: true },
    },
  ]) {
    saved.decisions = [{ proposalRowId: "row-0", decision: { ...decision, reviewedAt: 20 } }];
    const command: Extract<ReviewWrite, { operation: "decide" }> = {
      operation: "decide",
      ...scope,
      proposalRowId: "row-0",
      decision: structuredClone(decision),
    };
    expect(reconcileReviewWrite(command, saved).outcome).toBe("saved");
    command.decision =
      decision.decision === "rejected"
        ? { ...decision, rejectionReason: "Different" }
        : { ...decision, parentContext: { ...decision.parentContext, pointingOrTouchCounting: false } };
    expect(reconcileReviewWrite(command, saved).outcome).toBe("conflict");
  }
});
it("partial accept-all stays unresolved; corrections/rejections prove incompatible bulk writes", () => {
  const { saved, scope } = fixture();
  const command: ReviewWrite = { operation: "acceptAll", ...scope };
  saved.decisions = [
    {
      proposalRowId: "row-0",
      decision: { kind: "parent_decision", proposalId: "p0", decision: "accepted", reviewedAt: 1 },
    },
  ];
  expect(reconcileReviewWrite(command, saved)).toMatchObject({ outcome: "unresolved", retryable: true });
  saved.decisions[0].decision = {
    kind: "parent_decision",
    proposalId: "p0",
    decision: "rejected",
    rejectionReason: "Parent",
    reviewedAt: 2,
  };
  expect(reconcileReviewWrite(command, saved).outcome).toBe("conflict");
  expect(reconcileReviewWrite({ operation: "complete", ...scope, repairLevel: "verified" }, saved).outcome).toBe(
    "conflict",
  );
  expect(
    reconcileReviewWrite({ operation: "complete", ...scope, repairLevel: "substantial_repair" }, saved).outcome,
  ).toBe("unresolved");
});
it("completion requires every decision and exact note/repair/empty metadata, ignoring completedAt", () => {
  const { saved, scope } = fixture(1);
  saved.decisions = [
    {
      proposalRowId: "row-0",
      decision: { kind: "parent_decision", proposalId: "p0", decision: "accepted", reviewedAt: 1 },
    },
  ];
  saved.review = { repairLevel: "verified", note: "Original", emptyAcknowledged: false, completedAt: 999 };
  for (const operation of ["complete", "acceptAll"] as const) {
    const command: ReviewWrite = {
      operation,
      ...scope,
      ...(operation === "complete" ? { repairLevel: "verified" as const } : {}),
      note: "Original",
    };
    expect(reconcileReviewWrite(command, saved).outcome).toBe("saved");
    expect(reconcileReviewWrite({ ...command, note: "Changed" }, saved).outcome).toBe("conflict");
    expect(reconcileReviewWrite({ ...command, note: undefined }, saved).outcome).toBe("conflict");
  }
  expect(
    reconcileReviewWrite({ operation: "complete", ...scope, repairLevel: "light_correction", note: "Original" }, saved)
      .outcome,
  ).toBe("conflict");
  saved.decisions = [];
  expect(reconcileReviewWrite({ operation: "acceptAll", ...scope, note: "Original" }, saved).outcome).toBe("conflict");
});
it("empty completion is confirmed only with explicit acknowledgment and matching stored metadata", () => {
  const { saved, scope } = fixture(0);
  saved.review = { repairLevel: "verified", emptyAcknowledged: true, completedAt: 9 };
  const command: ReviewWrite = { operation: "complete", ...scope, repairLevel: "verified", acknowledgeEmpty: true };
  expect(reconcileReviewWrite(command, saved).outcome).toBe("saved");
  expect(reconcileReviewWrite({ ...command, acknowledgeEmpty: false }, saved).outcome).toBe("conflict");
  saved.review.emptyAcknowledged = false;
  expect(reconcileReviewWrite(command, saved).outcome).toBe("conflict");
});
