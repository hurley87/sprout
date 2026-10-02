import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.ts");
const makeTest = () => convexTest(schema, modules);

it("round-trips transcript-only help candidates and rejects invalid review provenance", async () => {
  const t = makeTest();
  const sessionId = await t.mutation(api.sessions.create, {});
  await t.mutation(api.sessions.activate, { sessionId, startedAt: 100 });
  const candidate = {
    type: "help_delivery_candidate" as const,
    provenance: "provider_transcript_only" as const,
    kind: "instructional_help" as const,
    delivery: "unknown" as const,
    transcriptState: "interrupted" as const,
    text: "Point to each duck as you count it once.",
    providerClock: "provider" as const,
    startMs: 100,
    endMs: 200,
    displayStatus: "unknown" as const,
  };
  await t.mutation(api.sessions.appendEvent, { sessionId, eventKey: "help_candidate", atMs: 300, timeline: candidate });
  const saved = await t.query(api.sessions.getRecord, { sessionId });
  expect(saved?.events[0].timeline).toEqual(candidate);

  const invalid = [
    { ...candidate, startMs: Infinity },
    { ...candidate, startMs: 200, endMs: 100 },
    { ...candidate, sourceId: 1.5 },
    { ...candidate, text: "  " },
    {
      ...candidate,
      displayStatus: "stable" as const,
      display: { sceneId: "ducks", displayedAtMs: NaN },
    },
  ];
  for (const [index, timeline] of invalid.entries()) {
    await expect(
      t.mutation(api.sessions.appendEvent, {
        sessionId,
        eventKey: `invalid_help_${index}`,
        atMs: 400 + index,
        timeline,
      }),
    ).rejects.toThrow();
  }
});

it("rejects corrupted fragment joins and complete evaluation identities with missing source fields", async () => {
  const t = makeTest();
  const sessionId = await t.mutation(api.sessions.create, {});
  await t.mutation(api.sessions.activate, { sessionId });
  const speech = {
    type: "utterance" as const,
    speaker: "child_or_nearby_speaker" as const,
    text: "One Two",
    state: "finalized" as const,
    transcriptFragments: [
      { key: "first", textStart: 0, textEnd: 4 },
      { key: "second", textStart: 4, textEnd: 7 },
    ],
  };
  for (const mutation of ["gap", "duplicate", "truncated", "fractional"] as const) {
    const evidence = structuredClone(speech);
    if (mutation === "gap") evidence.transcriptFragments[1].textStart = 5;
    if (mutation === "duplicate") evidence.transcriptFragments[1].key = "first";
    if (mutation === "truncated") evidence.transcriptFragments.pop();
    if (mutation === "fractional") evidence.transcriptFragments[1].textEnd = 6.5;
    await expect(
      t.mutation(api.sessions.appendEvent, {
        sessionId,
        eventKey: mutation,
        atMs: 100,
        evidence,
      }),
    ).rejects.toThrow(/fragment identity/i);
  }
  const timeline = {
    type: "evaluation_control" as const,
    action: "evaluation_result",
    correlationKey: "0|1|100:One Two|1",
    sceneIndex: 0,
    transcriptRevision: 1,
    answerVersion: "100:One Two",
    sourceId: 1,
    responseIdentity: {
      provenance: "application_evaluation" as const,
      sourceStatus: "known" as const,
      fragmentKeys: ["first", "second"],
      evaluatedScene: { sceneId: "hello-duck", displayedAtMs: 0 },
      recognitionContext: {
        provenance: "application_text_policy" as const,
        recovery: "instructional_support" as const,
        recognition: "no_ambiguity_detected" as const,
      },
    },
  };
  for (const payload of [
    { ...timeline, sourceId: undefined },
    { ...timeline, transcriptRevision: undefined },
    { ...timeline, responseIdentity: { ...timeline.responseIdentity, fragmentKeys: ["first", "first"] } },
  ]) {
    await expect(
      t.mutation(api.sessions.appendEvent, {
        sessionId,
        eventKey: "invalid-evaluation",
        atMs: 100,
        timeline: payload,
      }),
    ).rejects.toThrow("Invalid evaluated response identity");
  }
  for (const identity of [
    { ...timeline.responseIdentity, sourceStatus: "mixed" as const },
    { ...timeline.responseIdentity, evaluatedScene: undefined },
    {
      ...timeline.responseIdentity,
      recognitionContext: { ...timeline.responseIdentity.recognitionContext, recovery: "clarification" as const },
    },
  ]) {
    await expect(
      t.mutation(api.sessions.appendEvent, {
        sessionId,
        eventKey: "invalid-recognition",
        atMs: 100,
        timeline: { ...timeline, responseIdentity: identity },
      }),
    ).rejects.toThrow("Clear recognition requires complete response context");
  }
  await expect(
    t.mutation(api.sessions.appendEvent, {
      sessionId,
      eventKey: "invalid-confirmation",
      atMs: 100,
      timeline: {
        ...timeline,
        responseIdentity: {
          ...timeline.responseIdentity,
          recognitionContext: { ...timeline.responseIdentity.recognitionContext, repeatedTotal: Number.NaN },
        },
      },
    }),
  ).rejects.toThrow("Invalid recognition confirmation total");
  expect((await t.query(api.sessions.getRecord, { sessionId }))?.events).toHaveLength(0);
});

describe("durable session record", () => {
  it("creates, activates, orders evidence, finalizes, and fetches a pending record without audio", async () => {
    const t = makeTest();
    const sessionId = await t.mutation(api.sessions.create, {});
    expect((await t.query(api.sessions.getRecord, { sessionId }))?.session).toMatchObject({
      state: "starting",
      recordStatus: "pending",
    });
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
    expect(first?.session).toMatchObject({ state: "ended", endingReason: "parent_stop", recordStatus: "pending" });
    expect(first?.session.recording).toBeUndefined();
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
    const args = { sessionId, storageId, mimeType: "audio/webm", startOffsetMs: 1000, durationMs: 5000 };
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
      startOffsetMs: 1000,
      durationMs: 5000,
    });
  });
});

it("known evidence loss is monotonic, idempotent, and survives finalization", async () => {
  const t = makeTest();
  const sessionId = await t.mutation(api.sessions.create, {});
  expect((await t.query(api.sessions.getRecord, { sessionId }))?.session.recordStatus).toBe("pending");
  await t.mutation(api.sessions.markIncomplete, { sessionId });
  await t.mutation(api.sessions.markIncomplete, { sessionId });
  await t.mutation(api.sessions.activate, { sessionId });
  await t.mutation(api.sessions.appendEvent, {
    sessionId,
    eventKey: "ok",
    atMs: 0,
    evidence: { type: "support", source: "sprout", mode: "spoken", description: "help" },
  });
  await t.mutation(api.sessions.finalize, { sessionId, endingReason: "parent_stop", recordIncomplete: false });
  await t.mutation(api.sessions.finalize, { sessionId, endingReason: "parent_stop", recordIncomplete: false });
  await t.mutation(api.sessions.markIncomplete, { sessionId });
  expect((await t.query(api.sessions.getRecord, { sessionId }))?.session).toMatchObject({
    state: "ended",
    recordStatus: "incomplete",
  });
});

it("finalization atomically marks known evidence loss, including repeated finalization", async () => {
  const t = makeTest();
  const sessionId = await t.mutation(api.sessions.create, {});
  await t.mutation(api.sessions.finalize, { sessionId, endingReason: "parent_stop", recordIncomplete: true });
  expect((await t.query(api.sessions.getRecord, { sessionId }))?.session).toMatchObject({
    state: "ended",
    recordStatus: "incomplete",
  });
  const other = await t.mutation(api.sessions.create, {});
  await t.mutation(api.sessions.finalize, { sessionId: other, endingReason: "parent_stop" });
  await t.mutation(api.sessions.finalize, {
    sessionId: other,
    endingReason: "connection_failure",
    recordIncomplete: true,
  });
  expect((await t.query(api.sessions.getRecord, { sessionId: other }))?.session).toMatchObject({
    endingReason: "parent_stop",
    recordStatus: "incomplete",
  });
});

it("generates an upload URL only for an ended session without audio", async () => {
  const t = makeTest();
  const sessionId = await t.mutation(api.sessions.create, {});
  await expect(t.mutation(api.sessions.generateUploadUrl, { sessionId })).rejects.toThrow("ended session");
  await t.mutation(api.sessions.finalize, { sessionId, endingReason: "parent_stop" });
  expect(await t.mutation(api.sessions.generateUploadUrl, { sessionId })).toMatch(/^https?:/);
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(["audio"], { type: "audio/webm" })));
  await t.mutation(api.sessions.attachRecording, {
    sessionId,
    storageId,
    mimeType: "audio/webm",
    startOffsetMs: 0,
    durationMs: 100,
  });
  expect((await t.query(api.sessions.getRecord, { sessionId }))?.session.recordStatus).toBe("complete");
  await expect(t.mutation(api.sessions.generateUploadUrl, { sessionId })).rejects.toThrow("already attached");
});

it.each([false, true])("audio completion and identical retries preserve integrity (prior loss=%s)", async priorLoss => {
  const t = makeTest();
  const sessionId = await t.mutation(api.sessions.create, {});
  await t.mutation(api.sessions.activate, { sessionId });
  if (priorLoss) await t.mutation(api.sessions.markIncomplete, { sessionId });
  await t.mutation(api.sessions.finalize, { sessionId, endingReason: "parent_stop", recordIncomplete: false });
  expect(await t.mutation(api.sessions.generateUploadUrl, { sessionId })).toMatch(/^https?:/);
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(["audio"])));
  const args = { sessionId, storageId, mimeType: "audio/webm", startOffsetMs: 0, durationMs: 100 };
  await t.mutation(api.sessions.attachRecording, args);
  const attached = await t.query(api.sessions.getRecord, { sessionId });
  expect(attached?.session).toMatchObject({
    state: "ended",
    recordStatus: priorLoss ? "incomplete" : "complete",
    recording: { storageId },
  });
  await t.mutation(api.sessions.attachRecording, args);
  expect(await t.query(api.sessions.getRecord, { sessionId })).toEqual(attached);
  await t.mutation(api.sessions.markIncomplete, { sessionId });
  await t.mutation(api.sessions.attachRecording, args);
  await t.mutation(api.sessions.finalize, { sessionId, endingReason: "connection_failure", recordIncomplete: false });
  expect((await t.query(api.sessions.getRecord, { sessionId }))?.session).toMatchObject({
    recordStatus: "incomplete",
    endingReason: "parent_stop",
    recording: { storageId },
  });
});

it("inspection returns a storage playback URL only for attached audio", async () => {
  const t = makeTest();
  const sessionId = await t.mutation(api.sessions.create, {});
  const before = await t.query(api.sessions.getRecord, { sessionId });
  expect(before?.recordingUrl).toBeNull();
  await t.mutation(api.sessions.finalize, { sessionId, endingReason: "parent_stop" });
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(["full audio"])));
  await t.mutation(api.sessions.attachRecording, {
    sessionId,
    storageId,
    mimeType: "audio/webm",
    startOffsetMs: 0,
    durationMs: 2000,
  });
  const record = await t.query(api.sessions.getRecord, { sessionId });
  expect(record?.recordingUrl).toBe(await t.run(ctx => ctx.storage.getUrl(storageId)));
  expect(record?.recordingUrl).toMatch(/^https?:/);
});

it("persists analysis separately, preserving mixed order and event-key idempotency", async () => {
  const t = makeTest();
  const sessionId = await t.mutation(api.sessions.create, {});
  const generated = {
    type: "sprout_generated_utterance" as const,
    speaker: "sprout" as const,
    text: "Three!",
    startMs: 100,
    endMs: 200,
    firstObservedAtMs: 120,
    lastObservedAtMs: 280,
    state: "interrupted" as const,
  };
  const args = { sessionId, eventKey: "generated", atMs: 120, timeline: generated };
  await expect(t.mutation(api.sessions.appendEvent, args)).rejects.toThrow("active session");
  await t.mutation(api.sessions.activate, { sessionId });
  const id = await t.mutation(api.sessions.appendEvent, args);
  expect(await t.mutation(api.sessions.appendEvent, args)).toBe(id);
  const learner = {
    type: "utterance" as const,
    speaker: "child_or_nearby_speaker" as const,
    text: "Three",
    state: "finalized" as const,
    firstObservedAtMs: 400,
    lastObservedAtMs: 450,
  };
  await t.mutation(api.sessions.appendEvent, { sessionId, eventKey: "child", atMs: 500, evidence: learner });
  const control = {
    type: "evaluation_control" as const,
    action: "delegation_associated",
    correlationKey: "0|1|100:Three|1",
    sceneIndex: 0,
    transcriptRevision: 1,
    answerVersion: "100:Three",
    sourceId: 1,
    delegationId: "delegation_1",
    offsetMs: 550,
    origin: "both" as const,
  };
  await t.mutation(api.sessions.appendEvent, { sessionId, eventKey: "control", atMs: 510, timeline: control });
  const record = await t.query(api.sessions.getRecord, { sessionId });
  expect(record?.events.map(({ order, evidence, timeline }) => ({ order, evidence, timeline }))).toEqual([
    { order: 0, evidence: undefined, timeline: generated },
    { order: 1, evidence: learner, timeline: undefined },
    { order: 2, evidence: undefined, timeline: control },
  ]);
  await expect(
    t.mutation(api.sessions.appendEvent, { ...args, timeline: { ...generated, text: "Other" } }),
  ).rejects.toThrow("reused");
  await expect(t.mutation(api.sessions.appendEvent, { ...args, evidence: learner })).rejects.toThrow("Exactly one");
  await expect(t.mutation(api.sessions.appendEvent, { sessionId, eventKey: "empty", atMs: 0 })).rejects.toThrow(
    "Exactly one",
  );
  await expect(
    t.mutation(api.sessions.appendEvent, { ...args, timeline: { ...generated, lastObservedAtMs: 0 } }),
  ).rejects.toThrow("lastObservedAtMs");
  await expect(
    t.mutation(api.sessions.appendEvent, { ...args, timeline: { ...generated, endMs: 10 } }),
  ).rejects.toThrow("endMs");
  await t.mutation(api.sessions.finalize, { sessionId, endingReason: "parent_stop" });
  await expect(t.mutation(api.sessions.appendEvent, { ...args, eventKey: "late" })).rejects.toThrow("active session");
});

it("keeps the live browser start timestamp despite delayed persistence", async () => {
  const t = makeTest();
  const sessionId = await t.mutation(api.sessions.create, {});
  await t.mutation(api.sessions.activate, { sessionId, startedAt: 123456 });
  await t.mutation(api.sessions.activate, { sessionId, startedAt: 999999 });
  expect((await t.query(api.sessions.getRecord, { sessionId }))?.session.startedAt).toBe(123456);
});

it("persists separate provider provenance and response context without inventing mapped timing", async () => {
  const t = makeTest();
  const sessionId = await t.mutation(api.sessions.create, {});
  await t.mutation(api.sessions.activate, { sessionId });
  const evidence = {
    type: "utterance",
    speaker: "child_or_nearby_speaker",
    text: "Eight",
    state: "finalized",
    startMs: 35800,
    endMs: 36000,
    firstObservedAtMs: 33014,
    lastObservedAtMs: 33014,
    providerTiming: { clock: "provider", startMs: 35800, endMs: 36000, sourceId: 1 },
    responseScene: {
      provenance: "application_transcript_context",
      sceneId: "butterfly-garden",
      displayedAtMs: 16590,
      status: "stable",
    },
    recognition: "needs_confirmation",
  } as const;
  await t.mutation(api.sessions.appendEvent, { sessionId, eventKey: "butterfly", atMs: 35515, evidence });
  const record = await t.query(api.sessions.getRecord, { sessionId });
  expect(record?.events[0].evidence).toEqual(evidence);
  await expect(
    t.mutation(api.sessions.appendEvent, {
      sessionId,
      eventKey: "invalid",
      atMs: 35515,
      evidence: { ...evidence, providerTiming: { ...evidence.providerTiming, endMs: 35000 } },
    }),
  ).rejects.toThrow("timing.endMs must follow timing.startMs");
  await expect(
    t.mutation(api.sessions.appendEvent, {
      sessionId,
      eventKey: "invalid-mapping",
      atMs: 35515,
      evidence: {
        ...evidence,
        sessionTiming: { clock: "session", provenance: "mapped_provider", startMs: 33000, endMs: 32000 },
      },
    }),
  ).rejects.toThrow("timing.endMs must follow timing.startMs");
  expect((await t.query(api.sessions.getRecord, { sessionId }))?.events).toHaveLength(1);
});
