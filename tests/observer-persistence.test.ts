import { expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

async function endedRecord(
  state: "ended" | "active" = "ended",
  recordStatus: "complete" | "pending" | "incomplete" = "complete",
) {
  const t = convexTest(schema, import.meta.glob("../convex/**/*.ts"));
  const sessionId = await t.run(async ctx =>
    ctx.db.insert("sessions", {
      state,
      recordStatus,
      createdAt: 1,
      endedAt: 2,
      endingReason: "parent_stop",
      nextEventOrder: 0,
    }),
  );
  return { t, sessionId };
}

const uncertainProposal = (sessionId: string, eventId: string, proposalId: string) => ({
  kind: "observer_proposal",
  proposalId,
  sessionId,
  exchangeAtMs: 2,
  observation: {
    behavior: "uncertain_exchange",
    outcome: "uncertain",
    speakerAttribution: "unknown",
    countSequenceObserved: false,
    description: "The recorded response is unclear.",
    support: { status: "not_established", kinds: [], sourceEventIds: [] },
    uncertaintyReasons: ["unclear_speech", "missing_scene_context", "ambiguous_speaker"],
  },
  sources: [{ eventId, role: "response" }],
});

it("refuses active and pending records, then atomically claims one attempt", async () => {
  const active = await endedRecord("active");
  await expect(active.t.mutation(internal.observer.claim, { sessionId: active.sessionId, now: 10 })).rejects.toThrow(
    "not assembled",
  );
  const pending = await endedRecord("ended", "pending");
  await expect(pending.t.mutation(internal.observer.claim, { sessionId: pending.sessionId, now: 10 })).rejects.toThrow(
    "not assembled",
  );
  const ready = await endedRecord();
  const first = await ready.t.mutation(internal.observer.claim, { sessionId: ready.sessionId, now: 10 });
  const concurrent = await ready.t.mutation(internal.observer.claim, { sessionId: ready.sessionId, now: 11 });
  expect(first.status).toBe("claimed");
  expect(concurrent.status).toBe("running");
  expect(concurrent.attempt).toBe(first.attempt);
});

it("recovers an expired lease; stale owners cannot fail or publish", async () => {
  const { t, sessionId } = await endedRecord();
  const first = await t.mutation(internal.observer.claim, { sessionId, now: 10 });
  if (first.status !== "claimed") throw new Error("expected claim");
  const second = await t.mutation(internal.observer.claim, { sessionId, now: 10 + 5 * 60 * 1000 + 1 });
  if (second.status !== "claimed") throw new Error("expected recovery claim");
  expect(second.attempt).toBe(2);
  expect(
    await t.mutation(internal.observer.fail, {
      analysisId: second.analysisId,
      token: first.token,
      message: "late",
      now: second.attempt * 0 + 400000,
    }),
  ).toBe(false);
  await expect(
    t.mutation(internal.observer.publish, {
      analysisId: second.analysisId,
      token: first.token,
      proposals: [],
      now: 400000,
    }),
  ).rejects.toThrow("stale or expired");
  expect(
    await t.mutation(internal.observer.publish, {
      analysisId: second.analysisId,
      token: second.token,
      proposals: [],
      now: 400000,
    }),
  ).toEqual([]);
  expect(await t.query(api.observer.get, { sessionId })).toMatchObject({ status: "ready", proposals: [] });
  expect(
    await t.mutation(internal.observer.publish, {
      analysisId: second.analysisId,
      token: "old",
      proposals: [],
      now: 400001,
    }),
  ).toEqual([]);
});

it("qualifies incomplete records and allows a failed attempt to be retried", async () => {
  const { t, sessionId } = await endedRecord("ended", "incomplete");
  const first = await t.mutation(internal.observer.claim, { sessionId, now: 10 });
  if (first.status !== "claimed") throw new Error("expected claim");
  expect(
    await t.mutation(internal.observer.fail, {
      analysisId: first.analysisId,
      token: first.token,
      message: "provider unavailable",
      now: 11,
    }),
  ).toBe(true);
  expect(await t.query(api.observer.get, { sessionId })).toMatchObject({
    status: "failed",
    qualification: expect.stringContaining("incomplete"),
  });
  const retry = await t.mutation(internal.observer.claim, { sessionId, now: 12 });
  expect(retry).toMatchObject({ status: "claimed", attempt: 2 });
});

it("qualifies an initially incomplete request when claimed and retains it after successful publication", async () => {
  const { t, sessionId } = await endedRecord("ended", "incomplete");
  await t.mutation(internal.observer.request, { sessionId });
  const claim = await t.mutation(internal.observer.claim, { sessionId, now: 10 });
  if (claim.status !== "claimed") throw new Error("expected claim");
  expect(await t.query(api.observer.get, { sessionId })).toMatchObject({
    status: "running",
    qualification: expect.stringContaining("incomplete"),
  });

  expect(
    await t.mutation(internal.observer.publish, {
      analysisId: claim.analysisId,
      token: claim.token,
      proposals: [],
      now: 11,
    }),
  ).toEqual([]);
  expect(await t.query(api.observer.get, { sessionId })).toMatchObject({
    status: "ready",
    qualification: expect.stringContaining("incomplete"),
    proposals: [],
  });
});

it("refreshes qualification from the canonical record on a retry after input-change failure", async () => {
  const { t, sessionId } = await endedRecord();
  const first = await t.mutation(internal.observer.claim, { sessionId, now: 10 });
  if (first.status !== "claimed") throw new Error("expected claim");
  await t.run(ctx => ctx.db.patch(sessionId, { recordStatus: "incomplete" }));

  expect(
    await t.mutation(internal.observer.publish, {
      analysisId: first.analysisId,
      token: first.token,
      proposals: [],
      now: 11,
    }),
  ).toBeNull();
  expect(await t.query(api.observer.get, { sessionId })).toMatchObject({
    status: "failed",
    qualification: null,
    failure: expect.stringContaining("inputs changed"),
  });

  const retry = await t.mutation(internal.observer.claim, { sessionId, now: 12 });
  expect(retry).toMatchObject({ status: "claimed", attempt: 2 });
  expect(await t.query(api.observer.get, { sessionId })).toMatchObject({
    status: "running",
    qualification: expect.stringContaining("incomplete"),
  });
  if (retry.status !== "claimed") throw new Error("expected retry claim");
  expect(
    await t.mutation(internal.observer.fail, {
      analysisId: retry.analysisId,
      token: retry.token,
      message: "provider unavailable",
      now: 13,
    }),
  ).toBe(true);
  expect(await t.query(api.observer.get, { sessionId })).toMatchObject({
    status: "failed",
    qualification: expect.stringContaining("incomplete"),
  });
});

it("clears stale qualification when a new attempt snapshots a complete record", async () => {
  const { t, sessionId } = await endedRecord();
  await t.run(ctx =>
    ctx.db.insert("observerAnalyses", {
      sessionId,
      status: "failed",
      attempt: 1,
      qualification: "stale incomplete qualification",
    }),
  );

  const retry = await t.mutation(internal.observer.claim, { sessionId, now: 10 });
  expect(retry).toMatchObject({ status: "claimed", attempt: 2 });
  expect(await t.query(api.observer.get, { sessionId })).toMatchObject({ status: "running", qualification: null });
});

it("claims a session with exactly 1,000 events and rejects 1,001 without creating an analysis", async () => {
  const withinLimit = await endedRecord();
  await withinLimit.t.run(async ctx => {
    for (let order = 0; order < 1000; order++)
      await ctx.db.insert("sessionEvents", {
        sessionId: withinLimit.sessionId,
        eventKey: `event-${order}`,
        order,
        atMs: order,
      });
  });
  expect(
    await withinLimit.t.mutation(internal.observer.claim, { sessionId: withinLimit.sessionId, now: 10 }),
  ).toMatchObject({
    status: "claimed",
  });

  const overLimit = await endedRecord();
  await overLimit.t.run(async ctx => {
    for (let order = 0; order < 1001; order++)
      await ctx.db.insert("sessionEvents", {
        sessionId: overLimit.sessionId,
        eventKey: `event-${order}`,
        order,
        atMs: order,
      });
  });
  await expect(
    overLimit.t.mutation(internal.observer.claim, { sessionId: overLimit.sessionId, now: 10 }),
  ).rejects.toThrow("more than 1000 events");
  expect(await overLimit.t.query(api.observer.get, { sessionId: overLimit.sessionId })).toBeNull();
});

it("publishes, retries, and reads exactly 1,000 proposals unchanged; rejects 1,001 before writes", async () => {
  const { t, sessionId } = await endedRecord();
  const eventId = await t.run(ctx =>
    ctx.db.insert("sessionEvents", {
      sessionId,
      eventKey: "response",
      order: 0,
      atMs: 2,
      evidence: {
        type: "utterance",
        speaker: "unknown",
        text: "[unclear]",
        startMs: 1,
        endMs: 2,
        state: "interrupted",
      },
    }),
  );
  const claim = await t.mutation(internal.observer.claim, { sessionId, now: 10 });
  if (claim.status !== "claimed") throw new Error("expected claim");

  const tooMany = Array.from({ length: 1001 }, (_, index) =>
    uncertainProposal(sessionId, eventId, `proposal-${index}`),
  );
  await expect(
    t.mutation(internal.observer.publish, {
      analysisId: claim.analysisId,
      token: claim.token,
      proposals: tooMany,
      now: 11,
    }),
  ).rejects.toThrow("exceeds the 1000-proposal limit");
  expect(await t.query(api.observer.get, { sessionId })).toMatchObject({ status: "running", proposals: [] });
  expect(
    await t.run(ctx =>
      ctx.db
        .query("observerProposals")
        .withIndex("by_analysis_ordinal", q => q.eq("analysisId", claim.analysisId))
        .take(1),
    ),
  ).toEqual([]);

  const batch = tooMany.slice(0, 1000);
  const first = await t.mutation(internal.observer.publish, {
    analysisId: claim.analysisId,
    token: claim.token,
    proposals: batch,
    now: 12,
  });
  const repeated = await t.mutation(internal.observer.publish, {
    analysisId: claim.analysisId,
    token: "stale-token-is-ignored-for-ready-analysis",
    proposals: tooMany,
    now: 13,
  });
  const read = await t.query(api.observer.get, { sessionId });
  expect(first).toEqual(batch);
  expect(repeated).toEqual(batch);
  expect(read).toMatchObject({ status: "ready", proposals: batch });
  expect(read?.proposals).toHaveLength(1000);
});

it("reports pre-existing proposal overflow instead of returning a partial batch", async () => {
  const { t, sessionId } = await endedRecord();
  const { analysisId, eventId } = await t.run(async ctx => {
    const analysisId = await ctx.db.insert("observerAnalyses", { sessionId, status: "ready", attempt: 1 });
    const eventId = await ctx.db.insert("sessionEvents", {
      sessionId,
      eventKey: "response",
      order: 0,
      atMs: 2,
      evidence: {
        type: "utterance",
        speaker: "unknown",
        text: "[unclear]",
        startMs: 1,
        endMs: 2,
        state: "interrupted",
      },
    });
    return { analysisId, eventId };
  });
  await t.run(async ctx => {
    const proposal = uncertainProposal(sessionId, eventId, "stored-proposal");
    for (let ordinal = 0; ordinal < 1001; ordinal++)
      await ctx.db.insert("observerProposals", { analysisId, sessionId, ordinal, proposal });
  });
  await expect(t.query(api.observer.get, { sessionId })).rejects.toThrow(
    "Stored Observer batch exceeds the 1000-proposal limit",
  );
});
