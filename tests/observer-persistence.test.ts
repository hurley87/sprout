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
