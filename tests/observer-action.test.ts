import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("claims a saved partial record, analyzes mocked recording bytes, validates and atomically publishes once", async () => {
  vi.stubEnv("OPENAI_API_KEY", "synthetic-test-key");
  vi.stubEnv("OBSERVER_SERVER_CAPABILITY", "synthetic-server-capability");
  const t = convexTest(schema, import.meta.glob("../convex/**/*.ts"));
  const { sessionId, storageId, responseId, sceneId } = await t.run(async ctx => {
    const storageId = await ctx.storage.store(new Blob(["synthetic recording"]));
    const sessionId = await ctx.db.insert("sessions", {
      state: "ended",
      recordStatus: "pending",
      createdAt: 1,
      endedAt: 9,
      endingReason: "child_stop",
      nextEventOrder: 2,
    });
    const sceneId = await ctx.db.insert("sessionEvents", {
      sessionId,
      eventKey: "displayed",
      order: 0,
      atMs: 100,
      evidence: {
        type: "scene_displayed",
        sceneId: "ducks",
        targetQuantity: 3,
        items: [{ emoji: "🦆", label: "duck" }],
        arrangement: "row",
      },
    });
    const responseId = await ctx.db.insert("sessionEvents", {
      sessionId,
      eventKey: "response",
      order: 1,
      atMs: 700,
      evidence: {
        type: "utterance",
        speaker: "child_or_nearby_speaker",
        text: "Three",
        startMs: 500,
        endMs: 700,
        state: "finalized",
      },
    });
    return { sessionId, storageId, responseId, sceneId };
  });
  const fakeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("audio/transcriptions")) return Response.json({ text: "Three" });
    if (url.endsWith("/responses")) {
      const request = JSON.parse(String(init?.body)) as { input: string };
      const savedInputs = JSON.parse(request.input) as { canonicalSnapshot: string };
      const canonical = JSON.parse(savedInputs.canonicalSnapshot) as { sessionId: string };
      const proposal = {
        kind: "observer_proposal",
        proposalId: "synthetic-proposal",
        sessionId: canonical.sessionId,
        exchangeAtMs: 700,
        observation: {
          behavior: "quantity_identification",
          outcome: "correct",
          speakerAttribution: "child_or_nearby_speaker",
          statedTotal: 3,
          countSequenceObserved: false,
          targetQuantity: 3,
          description: "The child said the displayed total.",
          support: { status: "not_established", kinds: [], sourceEventIds: [], recordingSourceIds: [] },
          uncertaintyReasons: [],
        },
        sources: [
          { eventId: sceneId, role: "scene" },
          { eventId: responseId, role: "response" },
        ],
      };
      return Response.json({ status: "completed", output_text: JSON.stringify({ proposals: [proposal] }) });
    }
    // Convex-test's storage URL serves the fixed synthetic recording here.
    return new Response(new Blob(["synthetic recorded bytes"], { type: "audio/webm" }), { status: 200 });
  });
  vi.stubGlobal("fetch", fakeFetch);

  await t.mutation(api.sessions.markIncomplete, { sessionId });
  await t.mutation(api.sessions.attachRecording, {
    sessionId,
    storageId,
    mimeType: "audio/webm",
    startOffsetMs: 0,
    durationMs: 1000,
  });
  expect((await t.query(api.sessions.getRecord, { sessionId }))?.session.recordStatus).toBe("incomplete");
  // Public attachment persists audio but cannot schedule analysis. Direct calls without the
  // server capability fail before scheduling or reaching any provider mock.
  vi.useFakeTimers();
  await t.finishAllScheduledFunctions(() => vi.advanceTimersToNextTimer());
  expect(fakeFetch).not.toHaveBeenCalled();
  await expect(
    t.action(api.observer_action.requestAnalysis, { sessionId, capability: "wrong-capability" }),
  ).rejects.toThrow("authorization failed");
  expect(fakeFetch).not.toHaveBeenCalled();
  await t.action(api.observer_action.requestAnalysis, {
    sessionId,
    capability: "synthetic-server-capability",
  });
  await t.finishAllScheduledFunctions(() => vi.advanceTimersToNextTimer());
  vi.useRealTimers();
  expect(fakeFetch).toHaveBeenCalledTimes(3);
  const analysis = await t.query(api.observer.get, { sessionId });
  expect(analysis).toMatchObject({ status: "ready", attempt: 1, qualification: expect.stringContaining("incomplete") });
  expect(analysis?.proposals).toHaveLength(1);
  expect(analysis?.proposals[0]).toMatchObject({
    sessionId,
    observation: { behavior: "quantity_identification", statedTotal: 3 },
  });

  // A duplicate trigger sees ready state and cannot make another provider call or batch.
  expect(await t.action(internal.observer_action.analyze, { sessionId })).toBe("ready");
  expect(fakeFetch).toHaveBeenCalledTimes(3);
  expect((await t.query(api.observer.get, { sessionId }))?.proposals).toHaveLength(1);
  expect(storageId).toBeTruthy();
});
