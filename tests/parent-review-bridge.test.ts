import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { observationFixtures } from "./fixtures/observation-contracts";
import type { ReviewSnapshot } from "../lib/parent-review";

const { backendAction } = vi.hoisted(() => ({ backendAction: vi.fn() }));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    action = backendAction;
  },
}));
import { POST } from "../app/api/parent-review/route";
afterEach(() => {
  vi.unstubAllEnvs();
  backendAction.mockReset();
});
function request(command: unknown, host = "127.0.0.1:3000", origin = `http://${host}`) {
  return new Request(`http://${host}/api/parent-review`, {
    method: "POST",
    headers: { host, origin },
    body: JSON.stringify(command),
  });
}
async function fixture(count = 1) {
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://synthetic.convex.cloud");
  vi.stubEnv("OBSERVER_SERVER_CAPABILITY", "synthetic-capability");
  const t = convexTest(schema, import.meta.glob("../convex/**/*.ts"));
  const source = structuredClone(observationFixtures[0]);
  const sessionId = await t.run(async ctx => {
    const sessionId = await ctx.db.insert("sessions", {
      state: "ended",
      recordStatus: "incomplete",
      createdAt: 1,
      nextEventOrder: 2,
    });
    const ids = new Map<string, string>();
    for (const [order, event] of source.record.events.entries())
      ids.set(
        event._id,
        await ctx.db.insert("sessionEvents", {
          sessionId,
          order,
          eventKey: `key-${order}`,
          atMs: event.atMs,
          evidence: event.evidence,
        }),
      );
    source.proposal!.sessionId = sessionId;
    source.proposal!.sources = source.proposal!.sources.map(s =>
      "eventId" in s ? { ...s, eventId: ids.get(s.eventId)! } : s,
    );
    return sessionId;
  });
  const claim = await t.mutation(internal.observer.claim, { sessionId, now: 10 });
  if (claim.status !== "claimed") throw new Error("claim");
  await t.mutation(internal.observer.publish, {
    analysisId: claim.analysisId,
    token: claim.token,
    proposals: Array.from({ length: count }, (_, i) => ({ ...source.proposal!, proposalId: `p${i}` })),
    now: 11,
  });
  backendAction.mockImplementation((fn, args) => t.action(fn, args));
  const get = async () => (await (await POST(request({ operation: "get", sessionId }))).json()) as ReviewSnapshot;
  const gate = () => t.query(internal.parent_review.forPlanning, { sessionIds: [sessionId] });
  return { t, sessionId, get, gate, scope: { sessionId, analysisId: claim.analysisId } };
}
it("rejects non-loopback, cross-origin, unconfigured, and forged decision bodies before RPC", async () => {
  const f = await fixture();
  const command = { operation: "acceptAll", ...f.scope };
  for (const req of [request(command, "remote.example:3000"), request(command, undefined, "http://evil.example")])
    expect((await POST(req)).status).toBe(403);
  expect((await POST(request({ ...command, reviewedAt: 1 }))).status).toBe(400);
  expect((await POST(request({ ...command, sources: [] }))).status).toBe(400);
  vi.stubEnv("OBSERVER_SERVER_CAPABILITY", "");
  expect((await POST(request(command))).status).toBe(503);
  expect(backendAction).not.toHaveBeenCalled();
  expect(await f.gate()).toMatchObject({ blocked: true, evidence: [] });
});
it("checks missing/wrong capability at the public RPC before any approval or inspection", async () => {
  const f = await fixture();
  const command = JSON.stringify({ operation: "acceptAll", ...f.scope });
  vi.stubEnv("OBSERVER_SERVER_CAPABILITY", "");
  await expect(
    f.t.action(api.parent_review_action.request, { capability: "synthetic-capability", command }),
  ).rejects.toThrow("authorization failed");
  vi.stubEnv("OBSERVER_SERVER_CAPABILITY", "synthetic-capability");
  for (const operation of ["get", "acceptAll"])
    await expect(
      f.t.action(api.parent_review_action.request, {
        capability: "wrong",
        command: JSON.stringify({ operation, ...(operation === "get" ? { sessionId: f.sessionId } : f.scope) }),
      }),
    ).rejects.toThrow("authorization failed");
  await expect(
    f.t.action(api.parent_review_action.request, { command, capability: undefined as never }),
  ).rejects.toThrow();
  expect(await f.gate()).toMatchObject({ blocked: true, evidence: [] });
});
it("supplies canonical ID/key context and reaches atomic immutable review operations", async () => {
  const f = await fixture(3);
  const before = await f.get();
  expect(before).toMatchObject({ status: "ready", qualification: expect.stringContaining("incomplete") });
  expect(before.sources).toHaveLength(2);
  expect(before.proposals[0].proposal.sources[0]).toMatchObject({ eventId: before.sources[0].id });
  expect(before.sources[0].eventKey).toBe("key-0");
  const accept = {
    operation: "decide",
    ...f.scope,
    proposalRowId: before.proposals[0].id,
    decision: { kind: "parent_decision", proposalId: "p0", decision: "accepted" },
  };
  expect((await POST(request(accept))).status).toBe(200);
  expect((await POST(request(accept))).status).toBe(200);
  const correction = {
    operation: "decide",
    ...f.scope,
    proposalRowId: before.proposals[1].id,
    decision: {
      kind: "parent_decision",
      proposalId: "p1",
      decision: "corrected",
      correction: before.proposals[1].proposal.observation,
      parentContext: {
        provenance: "parent_review",
        note: "I helped and observed pointing.",
        assistance: ["parent_reported_assistance"],
        pointingOrTouchCounting: true,
      },
    },
  };
  expect((await POST(request(correction))).status).toBe(200);
  const reject = {
    operation: "decide",
    ...f.scope,
    proposalRowId: before.proposals[2].id,
    decision: { kind: "parent_decision", proposalId: "p2", decision: "rejected", rejectionReason: "Parent speaking" },
  };
  expect((await POST(request(reject))).status).toBe(200);
  expect((await POST(request({ operation: "acceptAll", ...f.scope }))).status).toBe(409);
  expect(await f.gate()).toMatchObject({ blocked: true, evidence: [] });
  expect(
    (await POST(request({ operation: "complete", ...f.scope, repairLevel: "light_correction", note: "Mixed review" })))
      .status,
  ).toBe(200);
  const after = await f.get();
  expect(after.proposals).toEqual(before.proposals);
  expect(after.review).toMatchObject({ repairLevel: "light_correction", note: "Mixed review" });
  expect(after.decisions).toHaveLength(3);
  const gate = await f.gate();
  expect(gate.blocked).toBe(false);
  expect(gate.evidence).toHaveLength(2);
  expect(
    (
      await POST(
        request({
          ...accept,
          decision: { kind: "parent_decision", proposalId: "p0", decision: "rejected", rejectionReason: "Changed" },
        }),
      )
    ).status,
  ).toBe(409);
});
it("accept-all completes unchanged and empty completion needs explicit acknowledgment", async () => {
  const f = await fixture();
  expect((await POST(request({ operation: "acceptAll", ...f.scope }))).status).toBe(200);
  expect((await POST(request({ operation: "acceptAll", ...f.scope }))).status).toBe(200);
  expect((await f.get()).review?.repairLevel).toBe("verified");
  const empty = await fixture(0);
  expect((await POST(request({ operation: "complete", ...empty.scope, repairLevel: "verified" }))).status).toBe(409);
  expect(
    (await POST(request({ operation: "complete", ...empty.scope, repairLevel: "verified", acknowledgeEmpty: true })))
      .status,
  ).toBe(200);
  expect(await empty.gate()).toEqual({ blocked: false, reason: null, evidence: [] });
});
it("rejects wrong session/analysis/proposal references and redacts backend errors", async () => {
  const f = await fixture();
  const other = await f.t.run(async ctx => {
    const sessionId = await ctx.db.insert("sessions", {
      state: "ended",
      recordStatus: "complete",
      createdAt: 2,
      nextEventOrder: 0,
    });
    const analysisId = await ctx.db.insert("observerAnalyses", { sessionId, status: "ready", attempt: 1 });
    const proposalRowId = await ctx.db.insert("observerProposals", { sessionId, analysisId, ordinal: 0, proposal: {} });
    return { sessionId, analysisId, proposalRowId };
  });
  const view = await f.get();
  backendAction.mockImplementation((fn, args) => f.t.action(fn, args));
  for (const scope of [
    { sessionId: other.sessionId, analysisId: f.scope.analysisId },
    { ...f.scope, analysisId: other.analysisId },
  ])
    expect((await POST(request({ operation: "acceptAll", ...scope }))).status).toBe(409);
  expect(
    (
      await POST(
        request({
          operation: "decide",
          ...f.scope,
          proposalRowId: view.proposals[0].id,
          decision: { kind: "parent_decision", proposalId: "forged", decision: "accepted" },
        }),
      )
    ).status,
  ).toBe(409);
  const decision = { kind: "parent_decision", proposalId: "p0", decision: "accepted" };
  expect(
    (await POST(request({ operation: "decide", ...f.scope, proposalRowId: other.proposalRowId, decision }))).status,
  ).toBe(409);
  expect(
    (
      await POST(
        request({
          operation: "decide",
          ...f.scope,
          proposalRowId: view.proposals[0].id,
          decision: { ...decision, reviewedAt: 10 },
        }),
      )
    ).status,
  ).toBe(400);
  const corrected = {
    kind: "parent_decision",
    proposalId: "p0",
    decision: "corrected",
    parentContext: { provenance: "parent_review", note: "Parent interpretation" },
  };
  for (const correction of [
    { ...view.proposals[0].proposal.observation, targetQuantity: 4, statedTotal: 4 },
    {
      ...view.proposals[0].proposal.observation,
      support: { status: "recorded", kinds: ["hint"], sourceEventIds: ["forged-source"] },
    },
  ])
    expect(
      (
        await POST(
          request({
            operation: "decide",
            ...f.scope,
            proposalRowId: view.proposals[0].id,
            decision: { ...corrected, correction },
          }),
        )
      ).status,
    ).toBe(409);
  backendAction.mockRejectedValue(new Error("synthetic-capability private failure"));
  const response = await POST(request({ operation: "get", sessionId: f.sessionId }));
  expect(await response.text()).not.toContain("synthetic-capability");
  expect(await f.gate()).toMatchObject({ blocked: true, evidence: [] });
});
it("reads not-started/pending/running/failed without READY and keeps all gates blocked", async () => {
  const f = await fixture();
  await f.t.run(ctx => ctx.db.delete(f.scope.analysisId));
  expect((await f.get()).status).toBe("not_started");
  for (const status of ["pending", "running", "failed"] as const) {
    await f.t.run(async ctx => {
      const rows = await ctx.db.query("observerAnalyses").take(10);
      for (const row of rows) await ctx.db.delete(row._id);
      await ctx.db.insert("observerAnalyses", {
        sessionId: f.sessionId,
        status,
        attempt: 1,
        failure: "private diagnostic",
      });
    });
    const view = await f.get();
    expect(view).toMatchObject({ status, proposals: [], decisions: [], review: null });
    expect(JSON.stringify(view)).not.toContain("private diagnostic");
    expect(await f.gate()).toMatchObject({ blocked: true, evidence: [] });
  }
});

it("bounds request bytes, metadata and public commands without writing", async () => {
  const f = await fixture();
  expect((await POST(request({ operation: "acceptAll", ...f.scope, note: "n".repeat(1001) }))).status).toBe(400);
  expect((await POST(request({ operation: "get", sessionId: "x".repeat(17000) }))).status).toBe(400);
  await expect(
    f.t.action(api.parent_review_action.request, { capability: "synthetic-capability", command: "x".repeat(16385) }),
  ).rejects.toThrow("Invalid review request");
  const view = await f.get();
  for (const command of [
    {
      operation: "decide",
      ...f.scope,
      proposalRowId: view.proposals[0].id,
      decision: { kind: "parent_decision", proposalId: "p0", decision: "accepted" },
    },
    { operation: "complete", ...f.scope, repairLevel: "verified" },
  ])
    await expect(
      f.t.action(api.parent_review_action.request, { capability: "wrong", command: JSON.stringify(command) }),
    ).rejects.toThrow("authorization failed");
  expect((await f.get()).decisions).toEqual([]);
  expect(await f.gate()).toMatchObject({ blocked: true, evidence: [] });
});
