import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../convex/_generated/api";
import { diagnoseObserverOutput, observationRecordFromSnapshot } from "../lib/observer-diagnostics";
import schema from "../convex/schema";
import { reviewDiagnosticFixture } from "./fixtures/review-diagnostics";

const { backendAction } = vi.hoisted(() => ({ backendAction: vi.fn() }));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    action = backendAction;
  },
}));
import { POST } from "../app/api/parent-review/diagnostics/route";
import { POST as review } from "../app/api/parent-review/route";
afterEach(() => {
  vi.unstubAllEnvs();
  backendAction.mockReset();
});
const request = (value: unknown, host = "127.0.0.1:3000", origin = `http://${host}`) =>
  new Request(`http://${host}/api/parent-review/diagnostics`, {
    method: "POST",
    headers: { host, origin },
    body: JSON.stringify(value),
  });
async function fixture(mode: "usable" | "unavailable" | "invalid_batch" = "usable") {
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://synthetic.convex.cloud");
  vi.stubEnv("OBSERVER_SERVER_CAPABILITY", "synthetic-capability");
  const t = convexTest(schema, import.meta.glob("../convex/**/*.ts"));
  const f = reviewDiagnosticFixture();
  const sessionId = await t.run(async ctx => {
    const id = await ctx.db.insert("sessions", {
      state: "ended",
      recordStatus: "incomplete",
      createdAt: 1,
      nextEventOrder: 4,
    });
    for (const event of f.record.events)
      await ctx.db.insert("sessionEvents", {
        sessionId: id,
        eventKey: event.eventKey,
        order: event.order,
        atMs: event.atMs,
        evidence: event.evidence,
        timeline: event.timeline,
      });
    return id;
  });
  const claim = await t.mutation(internal.observer.claim, { sessionId, now: 10 });
  if (claim.status !== "claimed") throw new Error();
  const source = observationRecordFromSnapshot(claim.inputSnapshot);
  await t.mutation(internal.observer.fail, {
    analysisId: claim.analysisId,
    token: claim.token,
    now: 11,
    message: "private provider credentials failure",
    failureStage: "transcription",
    ...(mode === "usable"
      ? { proposals: [null] }
      : mode === "invalid_batch"
        ? { diagnostics: diagnoseObserverOutput(source, {}, "provider_validation").diagnostics }
        : {}),
  });
  backendAction.mockImplementation((fn, args) => t.action(fn, args));
  const view = await (await review(request({ operation: "get", sessionId }))).json();
  const snapshotId = view.diagnostics.attempts[0].snapshotId;
  return { t, sessionId, snapshotId, claim, view, input: { sessionId, snapshotId, cursor: null, numItems: 1 } };
}
it("guards loopback/origin, strict bounded request and server configuration before any RPC", async () => {
  const f = await fixture();
  backendAction.mockClear();
  for (const req of [request(f.input, "remote.example:3000"), request(f.input, undefined, "http://evil.example")])
    expect((await POST(req)).status).toBe(403);
  for (const input of [
    { ...f.input, capability: "forged" },
    { ...f.input, numItems: 100 },
    { ...f.input, cursor: "x".repeat(8193) },
    { ...f.input, snapshotId: "invalid id" },
  ])
    expect((await POST(request(input))).status).toBe(400);
  expect(
    (
      await POST(
        new Request("http://localhost/api/parent-review/diagnostics", {
          method: "POST",
          headers: { host: "localhost", origin: "http://localhost" },
          body: "x".repeat(16385),
        }),
      )
    ).status,
  ).toBe(400);
  vi.stubEnv("OBSERVER_SERVER_CAPABILITY", "");
  expect((await POST(request(f.input))).status).toBe(503);
  expect(backendAction).not.toHaveBeenCalled();
});
it.each(["usable", "unavailable", "invalid_batch"] as const)(
  "reads %s captured attempts through the real authorized action without learning promotion",
  async mode => {
    const f = await fixture(mode);
    expect(f.view.diagnostics.attempts[0].summary.outputState).toBe(mode);
    const response = await POST(request(f.input));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const page = await response.json();
    expect(page).toMatchObject({ sessionId: f.sessionId, snapshotId: f.snapshotId });
    expect(page.page).toHaveLength(1);
    expect(page.isDone).toBe(false);
    const next = await (await POST(request({ ...f.input, cursor: page.continueCursor, numItems: 25 }))).json();
    expect(next.isDone).toBe(true);
    expect(
      next.page.every((row: { coverage: string }) => row.coverage === (mode === "usable" ? "absent" : "unknown")),
    ).toBe(true);
    expect(await f.t.query(internal.parent_review.forPlanning, { sessionIds: [f.sessionId] })).toMatchObject({
      blocked: true,
      evidence: [],
    });
    const publicText = JSON.stringify([f.view, page, next]);
    for (const secret of ["private provider", "synthetic-capability", "inputSnapshot", "attemptToken", "leaseUntil"])
      expect(publicText).not.toContain(secret);
  },
);
it("keeps retries and historical snapshot scope distinct and checks capability and session membership", async () => {
  const f = await fixture();
  await expect(
    f.t.action(api.parent_review_action.readDiagnostics, {
      capability: "wrong",
      sessionId: f.sessionId,
      snapshotId: f.snapshotId,
      paginationOpts: { cursor: null, numItems: 1 },
    }),
  ).rejects.toThrow("authorization failed");
  const other = await f.t.run(ctx =>
    ctx.db.insert("sessions", { state: "ended", recordStatus: "complete", createdAt: 1, nextEventOrder: 0 }),
  );
  expect((await POST(request({ ...f.input, sessionId: other }))).status).toBe(409);
  const old = await (await POST(request({ ...f.input, numItems: 25 }))).json();
  await f.t.run(async ctx => {
    const event = await ctx.db
      .query("sessionEvents")
      .withIndex("by_session_order", q => q.eq("sessionId", f.sessionId))
      .first();
    await ctx.db.delete(event!._id);
  });
  const retry = await f.t.mutation(internal.observer.claim, { sessionId: f.sessionId, now: 12 });
  if (retry.status !== "claimed") throw new Error();
  await f.t.run(ctx => ctx.db.patch(f.sessionId, { recordStatus: "complete" }));
  await f.t.mutation(internal.observer.publish, {
    analysisId: retry.analysisId,
    token: retry.token,
    proposals: [],
    now: 13,
  });
  const view = await (await review(request({ operation: "get", sessionId: f.sessionId }))).json();
  expect(view.diagnostics.attempts.map((row: { attempt: number }) => row.attempt)).toEqual([1, 2]);
  expect(view.diagnostics.attempts[1].snapshotChanged).toBe(true);
  expect(await (await POST(request({ ...f.input, numItems: 25 }))).json()).toEqual(old);
});
it("validates public response schemas and strips backend pagination metadata; errors remain sanitized", async () => {
  const f = await fixture();
  backendAction.mockResolvedValue(
    JSON.stringify({ page: [], isDone: true, continueCursor: "", rawProviderPayload: "private" }),
  );
  expect(await (await POST(request(f.input))).json()).not.toHaveProperty("rawProviderPayload");
  for (const result of [
    "not JSON",
    JSON.stringify({ page: [null], isDone: true, continueCursor: "" }),
    JSON.stringify({
      page: [{ ...reviewDiagnosticFixture().rows[0], inputSnapshot: "private" }],
      isDone: true,
      continueCursor: "",
    }),
    JSON.stringify({ page: [], isDone: false, continueCursor: "" }),
    "x".repeat(2_000_001),
  ]) {
    backendAction.mockResolvedValue(result);
    const response = await POST(request(f.input));
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("private");
  }
  backendAction.mockRejectedValue(new Error("private provider credentials"));
  expect(await (await POST(request(f.input))).text()).not.toContain("credentials");
  backendAction.mockResolvedValue(
    JSON.stringify({ sessionId: f.sessionId, diagnostics: { ...f.view.diagnostics, inputSnapshot: "private" } }),
  );
  expect((await review(request({ operation: "get", sessionId: f.sessionId }))).status).toBe(409);
});
