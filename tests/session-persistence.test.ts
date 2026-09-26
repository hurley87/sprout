import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.ts");
const makeTest = () => convexTest(schema, modules);

describe("durable session record", () => {
  it("creates, activates, orders evidence, finalizes, and fetches a complete record", async () => {
    const t = makeTest();
    const sessionId = await t.mutation(api.sessions.create, {});
    expect((await t.query(api.sessions.getRecord, { sessionId }))?.session.state).toBe("starting");
    await expect(
      t.mutation(api.sessions.appendEvent, {
        sessionId,
        eventKey: "early",
        atMs: 0,
        evidence: { type: "support", source: "sprout", mode: "spoken", description: "Count with me" },
      }),
    ).rejects.toThrow("active session");

    await t.mutation(api.sessions.activate, { sessionId });
    const scene = {
      type: "scene_displayed" as const,
      sceneId: "apples-3",
      targetQuantity: 3,
      items: [
        { emoji: "🍎", label: "apple" },
        { emoji: "🍎", label: "apple" },
        { emoji: "🍎", label: "apple" },
      ],
      arrangement: "row",
    };
    const utterance = {
      type: "utterance" as const,
      speaker: "child_or_nearby_speaker" as const,
      text: "one, two, three",
      startMs: 1800,
      endMs: 3200,
      state: "finalized" as const,
    };
    const sceneId = await t.mutation(api.sessions.appendEvent, {
      sessionId,
      eventKey: "scene-1",
      atMs: 100,
      evidence: scene,
    });
    const utteranceId = await t.mutation(api.sessions.appendEvent, {
      sessionId,
      eventKey: "utterance-1",
      atMs: 1800,
      evidence: utterance,
    });
    await t.mutation(api.sessions.appendEvent, {
      sessionId,
      eventKey: "support-1",
      atMs: 3300,
      evidence: { type: "support", source: "sprout", mode: "spoken", description: "Let's count together" },
    });
    expect(
      await t.mutation(api.sessions.appendEvent, {
        sessionId,
        eventKey: "utterance-1",
        atMs: 1800,
        evidence: utterance,
      }),
    ).toBe(utteranceId);

    await t.mutation(api.sessions.finalize, { sessionId, endingReason: "parent_stop" });
    const first = await t.query(api.sessions.getRecord, { sessionId });
    expect(first?.session).toMatchObject({ state: "ended", endingReason: "parent_stop" });
    expect(first?.session.startedAt).toBeTypeOf("number");
    expect(first?.session.endedAt).toBeTypeOf("number");
    expect(first?.events.map(event => [event.order, event.eventKey])).toEqual([
      [0, "scene-1"],
      [1, "utterance-1"],
      [2, "support-1"],
    ]);
    expect(first?.events[0]._id).toBe(sceneId);
    expect(first?.events[1].evidence).toEqual(utterance);

    await t.mutation(api.sessions.finalize, { sessionId, endingReason: "connection_failure" });
    await t.mutation(api.sessions.activate, { sessionId });
    expect(await t.query(api.sessions.getRecord, { sessionId })).toEqual(first);
    await expect(
      t.mutation(api.sessions.appendEvent, { sessionId, eventKey: "late", atMs: 3500, evidence: utterance }),
    ).rejects.toThrow("active session");
    await expect(
      t.mutation(api.sessions.appendEvent, { sessionId, eventKey: "utterance-1", atMs: 1800, evidence: utterance }),
    ).rejects.toThrow("active session");
  });

  it("rejects a reused event key with different evidence", async () => {
    const t = makeTest();
    const sessionId = await t.mutation(api.sessions.create, {});
    await t.mutation(api.sessions.activate, { sessionId });
    const event = {
      type: "utterance" as const,
      speaker: "sprout" as const,
      text: "Hello",
      state: "interrupted" as const,
    };
    await t.mutation(api.sessions.appendEvent, { sessionId, eventKey: "provider-42", atMs: 20, evidence: event });
    await expect(
      t.mutation(api.sessions.appendEvent, {
        sessionId,
        eventKey: "provider-42",
        atMs: 20,
        evidence: { ...event, text: "Different" },
      }),
    ).rejects.toThrow("reused");
  });

  it("creates a linked retry without changing the ended attempt", async () => {
    const t = makeTest();
    const original = await t.mutation(api.sessions.create, {});
    await expect(t.mutation(api.sessions.create, { retryOf: original })).rejects.toThrow("must be ended");
    await t.mutation(api.sessions.finalize, { sessionId: original, endingReason: "connection_failure" });
    const originalRecord = await t.query(api.sessions.getRecord, { sessionId: original });
    const retry = await t.mutation(api.sessions.create, { retryOf: original });
    expect(retry).not.toBe(original);
    expect((await t.query(api.sessions.getRecord, { sessionId: retry }))?.session).toMatchObject({
      state: "starting",
      retryOf: original,
    });
    expect(await t.query(api.sessions.getRecord, { sessionId: original })).toEqual(originalRecord);
  });

  it("rejects a retry when the referenced session does not exist", async () => {
    const t = makeTest();
    const deleted = await t.mutation(api.sessions.create, {});
    await t.run(ctx => ctx.db.delete(deleted));
    await expect(t.mutation(api.sessions.create, { retryOf: deleted })).rejects.toThrow("does not exist");
  });

  it("attaches one existing full recording after finalization", async () => {
    const t = makeTest();
    const sessionId = await t.mutation(api.sessions.create, {});
    const storageId = await t.run(ctx => ctx.storage.store(new Blob(["audio"], { type: "audio/webm" })));
    const args = { sessionId, storageId, mimeType: "audio/webm", startedAt: 1000, durationMs: 5000 };
    await expect(t.mutation(api.sessions.attachRecording, args)).rejects.toThrow("after finalization");
    await t.mutation(api.sessions.finalize, { sessionId, endingReason: "parent_stop" });
    const missingStorageId = await t.run(async ctx => {
      const id = await ctx.storage.store(new Blob(["missing"]));
      await ctx.storage.delete(id);
      return id;
    });
    await expect(t.mutation(api.sessions.attachRecording, { ...args, storageId: missingStorageId })).rejects.toThrow(
      "does not exist",
    );
    await t.mutation(api.sessions.attachRecording, args);
    await t.mutation(api.sessions.attachRecording, args);
    await expect(t.mutation(api.sessions.attachRecording, { ...args, durationMs: 6000 })).rejects.toThrow(
      "already attached",
    );
    expect((await t.query(api.sessions.getRecord, { sessionId }))?.session.recording).toEqual({
      storageId,
      mimeType: "audio/webm",
      startedAt: 1000,
      durationMs: 5000,
    });
  });
});
