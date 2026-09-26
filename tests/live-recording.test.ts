import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LessonSession, type EndReason, type Transport } from "../lib/session";
import { RecordingQueue, type Evidence, type SessionRecorder } from "../lib/session-recorder";
import { LAST_SCENE } from "../lib/lesson";
import { UTTERANCE_GAP_MS } from "../lib/transcript";
import { CORRECTION_WINDOW_MS, TRANSCRIPT_FALLBACK_MS } from "../lib/answer";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function setup(delivery = false) {
  const writes: (string | Evidence)[] = [];
  const recorder: SessionRecorder = {
    create: vi.fn(async () => {
      writes.push("create");
    }),
    activate: vi.fn(async () => {
      writes.push("active");
    }),
    append: vi.fn(async (_key, _at, evidence) => {
      writes.push(evidence);
    }),
    markIncomplete: vi.fn(async () => {}),
    finalize: vi.fn(async reason => {
      writes.push(reason);
    }),
  };
  const transport: Transport = {
    start: vi.fn(async () => {}),
    send: vi.fn(),
    setOutputBlocked: vi.fn(),
    stopMedia: vi.fn(),
    close: vi.fn(),
    delivered: () => delivery,
  };
  const session = new LessonSession(
    transport,
    async () => ({ status: "evaluated", probability: 1, model: "test", latencyMs: 1 }),
    vi.fn(),
    undefined,
    recorder,
  );
  void session.start();
  return { session, recorder, writes, transport };
}
function say(session: LessonSession, speaker: "child" | "sprout", delta: string, startMs = 0) {
  session.receive({ type: "transcript", speaker, delta, startMs, endMs: startMs + 100 });
}
const evidence = (writes: (string | Evidence)[]) =>
  writes.filter((write): write is Evidence => typeof write !== "string");

it("creates before activation; persists only confirmed displays, once", async () => {
  const { session, writes } = setup();
  await session.recordingSettled();
  expect(writes).toEqual(["create"]);
  session.displayed(0);
  expect(evidence(writes)).toEqual([]);
  session.receive({ type: "session.started" });
  session.displayed(0);
  session.displayed(0);
  await session.recordingSettled();
  expect(writes.slice(0, 2)).toEqual(["create", "active"]);
  expect(evidence(writes)).toEqual([
    {
      type: "scene_displayed",
      sceneId: "hello-duck",
      targetQuantity: 1,
      items: [{ emoji: "🦆", label: "duck" }],
      arrangement: "Centered flex row, wrapping in display order",
    },
  ]);
  say(session, "child", "one");
  await vi.advanceTimersByTimeAsync(TRANSCRIPT_FALLBACK_MS + CORRECTION_WINDOW_MS);
  expect(session.snapshot.sceneIndex).toBe(1);
  await session.recordingSettled();
  expect(evidence(writes).filter(e => e.type === "scene_displayed")).toHaveLength(1);
  session.displayed(1);
  session.displayed(1);
  await session.recordingSettled();
  expect(evidence(writes).filter(e => e.type === "scene_displayed")).toHaveLength(2);
  session.end("parent_stop");
});

it.each<EndReason>([
  "parent_stop",
  "child_stop",
  "model_goodbye",
  "wrap_up",
  "time_limit",
  "connection_failure",
  "page_hidden",
])("flushes open speech before finalizing %s exactly once", async reason => {
  const { session, writes, recorder } = setup();
  session.receive({ type: "session.started" });
  say(session, "child", "hello ");
  say(session, "child", "there", 100);
  session.end(reason);
  session.end("parent_stop");
  say(session, "child", "late");
  session.displayed(0);
  await session.recordingSettled();
  expect(writes).toEqual([
    "create",
    "active",
    {
      type: "utterance",
      speaker: "child_or_nearby_speaker",
      text: "hello there",
      startMs: 0,
      endMs: 200,
      state: "interrupted",
    },
    reason,
  ]);
  expect(recorder.finalize).toHaveBeenCalledTimes(1);
});

it("combines fragments, finalizes once after transcript quiet, and keeps full text", async () => {
  const { session, writes } = setup();
  session.receive({ type: "session.started" });
  say(session, "child", "hello ");
  say(session, "child", "world".repeat(120), 100);
  await vi.advanceTimersByTimeAsync(UTTERANCE_GAP_MS);
  session.fail("connection lost");
  await session.recordingSettled();
  expect(evidence(writes)).toHaveLength(1);
  expect(evidence(writes)[0]).toMatchObject({ text: "hello " + "world".repeat(120), state: "finalized" });
  expect(writes.at(-1)).toBe("connection_failure");
});

it("records Sprout only when attributed delivery is established; omits gated output", async () => {
  const { session, writes } = setup(true);
  session.receive({ type: "session.started" });
  session.displayed(0);
  say(session, "sprout", "Hello ");
  say(session, "sprout", "friend", 100);
  await vi.advanceTimersByTimeAsync(UTTERANCE_GAP_MS);
  say(session, "child", "one", 3000);
  say(session, "sprout", "generated but blocked", 4000);
  session.end("parent_stop");
  await session.recordingSettled();
  expect(evidence(writes).filter(e => e.type === "utterance" && e.speaker === "sprout")).toEqual([
    { type: "utterance", speaker: "sprout", text: "Hello friend", startMs: 0, endMs: 200, state: "finalized" },
  ]);
});

it("omits Sprout when delivery is unknown, including open interrupted output", async () => {
  const { session, writes } = setup();
  session.receive({ type: "session.started" });
  say(session, "sprout", "unknown playback");
  session.end("parent_stop");
  await session.recordingSettled();
  expect(evidence(writes)).toEqual([]);
});

it("queue cannot finalize ahead of a slow append and continues after reported failures", async () => {
  const writes: string[] = [];
  const report = vi.fn();
  const queue = new RecordingQueue(report);
  let release!: () => void;
  queue.enqueue(
    "append",
    () =>
      new Promise<void>(resolve => {
        release = () => {
          writes.push("append");
          resolve();
        };
      }),
  );
  queue.enqueue("failure", async () => {
    throw new Error("offline");
  });
  queue.enqueue("finalize", async () => {
    writes.push("finalize");
  });
  await Promise.resolve();
  expect(writes).toEqual([]);
  release();
  await queue.drain();
  expect(writes).toEqual(["append", "finalize"]);
  expect(report).toHaveBeenCalledWith("failure", expect.any(Error));
});

it("reports persistence failure explicitly without changing deterministic scene/lifecycle", async () => {
  const { session, recorder, writes } = setup();
  vi.mocked(recorder.create).mockRejectedValue(new Error("offline"));
  session.receive({ type: "session.started" });
  session.displayed(0);
  await session.recordingSettled();
  expect(session.snapshot).toMatchObject({ status: "active", sceneIndex: 0, recordingError: expect.any(String) });
  expect(session.events).toContainEqual(expect.objectContaining({ type: "recording.failed" }));
  expect(recorder.markIncomplete).not.toHaveBeenCalled();
  session.fail("lost connection");
  await session.recordingSettled();
  expect(recorder.markIncomplete).not.toHaveBeenCalled();
  expect(writes.at(-1)).toBe("connection_failure");
});

it("separates utterances on provider timestamp gaps and preserves interrupted delivered Sprout", async () => {
  const { session, writes } = setup(true);
  session.receive({ type: "session.started" });
  say(session, "child", "first", 0);
  say(session, "child", "second", 4000);
  say(session, "sprout", "partly delivered", 5000);
  session.end("connection_failure");
  await session.recordingSettled();
  expect(evidence(writes)).toEqual([
    expect.objectContaining({ text: "first", state: "finalized" }),
    expect.objectContaining({ text: "second", state: "finalized" }),
    expect.objectContaining({ speaker: "sprout", text: "partly delivered", state: "interrupted" }),
  ]);
});

it("keeps a startup failure as an ended attempt without activation", async () => {
  const { session, writes } = setup();
  session.fail("permission denied");
  await session.recordingSettled();
  expect(writes).toEqual(["create", "connection_failure"]);
});

it.each([true, false])("speaker switches separate child turns with Sprout delivery trusted=%s", async delivery => {
  const { session, writes, transport } = setup(delivery);
  if (!delivery) delete transport.delivered;
  session.receive({ type: "session.started" });
  // The last scene allows a count reply without the answer-response gate.
  session.snapshot.sceneIndex = LAST_SCENE;
  say(session, "child", "Two.", 0);
  await vi.advanceTimersByTimeAsync(100);
  say(session, "sprout", "That's right!", 100);
  await vi.advanceTimersByTimeAsync(100);
  say(session, "child", "Can we do another?", 200);
  await session.recordingSettled();
  const priorTurns = [
    expect.objectContaining({ speaker: "child_or_nearby_speaker", text: "Two.", state: "finalized" }),
    ...(delivery ? [expect.objectContaining({ speaker: "sprout", text: "That's right!", state: "finalized" })] : []),
  ];
  expect(evidence(writes)).toEqual(priorTurns);
  // The first child's cancelled timer must not finalize the newer child turn.
  await vi.advanceTimersByTimeAsync(UTTERANCE_GAP_MS - 200);
  await session.recordingSettled();
  expect(evidence(writes)).toEqual(priorTurns);
  await vi.advanceTimersByTimeAsync(200);
  await session.recordingSettled();
  expect(evidence(writes)).toEqual([
    ...priorTurns,
    expect.objectContaining({ speaker: "child_or_nearby_speaker", text: "Can we do another?", state: "finalized" }),
  ]);
  session.end("parent_stop");
  await session.recordingSettled();
  expect(evidence(writes)).toHaveLength(delivery ? 3 : 2);
});

it("same-speaker canonical fragments remain one utterance", async () => {
  const { session, writes } = setup();
  session.receive({ type: "session.started" });
  say(session, "child", "one, ", 0);
  say(session, "child", "two", 100);
  await session.recordingSettled();
  expect(evidence(writes)).toEqual([]);
  await vi.advanceTimersByTimeAsync(UTTERANCE_GAP_MS);
  await session.recordingSettled();
  expect(evidence(writes)).toEqual([
    expect.objectContaining({ text: "one, two", startMs: 0, endMs: 200, state: "finalized" }),
  ]);
  session.end("parent_stop");
});

it("gated Sprout output still separates child turns without being persisted", async () => {
  const { session, writes } = setup(true);
  session.receive({ type: "session.started" });
  say(session, "child", "Two.", 0);
  say(session, "sprout", "That's right!", 100);
  say(session, "child", "Can we do another?", 200);
  session.end("parent_stop");
  await session.recordingSettled();
  expect(evidence(writes)).toEqual([
    expect.objectContaining({ speaker: "child_or_nearby_speaker", text: "Two.", state: "finalized" }),
    expect.objectContaining({ speaker: "child_or_nearby_speaker", text: "Can we do another?", state: "interrupted" }),
  ]);
});

it.each([false, true])(
  "persists an ended incomplete record after evidence loss (marker fails=%s)",
  async markerFails => {
    const t = convexTest(schema, import.meta.glob("../convex/**/*.ts"));
    let sessionId!: Id<"sessions">;
    const operations: string[] = [];
    let appends = 0;
    const recorder: SessionRecorder = {
      async create() {
        operations.push("create");
        sessionId = await t.mutation(api.sessions.create, {});
      },
      async activate() {
        operations.push("activate");
        await t.mutation(api.sessions.activate, { sessionId });
      },
      async append(eventKey, atMs, evidence) {
        operations.push(`append${++appends}`);
        if (appends === 2) throw new Error("lost evidence");
        await t.mutation(api.sessions.appendEvent, { sessionId, eventKey, atMs, evidence });
      },
      async markIncomplete() {
        operations.push("markIncomplete");
        if (markerFails) throw new Error("marker offline");
        await t.mutation(api.sessions.markIncomplete, { sessionId });
      },
      async finalize(endingReason, recordIncomplete) {
        operations.push("finalize");
        await t.mutation(api.sessions.finalize, { sessionId, endingReason, recordIncomplete });
      },
    };
    const transport: Transport = {
      start: async () => {},
      send: () => {},
      setOutputBlocked: () => {},
      stopMedia: () => {},
      close: () => {},
    };
    const session = new LessonSession(
      transport,
      async () => ({ status: "unavailable", reason: "timeout", latencyMs: 0 }),
      vi.fn(),
      undefined,
      recorder,
    );
    void session.start();
    session.receive({ type: "session.started" });
    session.displayed(0); // event 1
    say(session, "child", "first");
    say(session, "sprout", "untrusted", 100); // finalize event 2
    say(session, "child", "third", 200);
    session.end("parent_stop"); // event 3 then finalize
    await session.recordingSettled();
    expect(operations).toEqual(["create", "activate", "append1", "append2", "markIncomplete", "append3", "finalize"]);
    const record = await t.query(api.sessions.getRecord, { sessionId });
    expect(record?.session).toMatchObject({ state: "ended", recordStatus: "incomplete", endingReason: "parent_stop" });
    expect(record?.events).toHaveLength(2);
    expect(session.snapshot).toMatchObject({
      sceneIndex: 0,
      reason: "parent_stop",
      recordingError: expect.any(String),
    });
    if (markerFails)
      expect(session.events).toContainEqual(
        expect.objectContaining({
          type: "recording.failed",
          detail: expect.objectContaining({ operation: "markIncomplete" }),
        }),
      );
  },
);

it("activation failure marks an existing attempt incomplete without changing the live scene", async () => {
  const { session, recorder } = setup();
  vi.mocked(recorder.activate).mockRejectedValue(new Error("offline"));
  session.receive({ type: "session.started" });
  await session.recordingSettled();
  expect(recorder.markIncomplete).toHaveBeenCalledTimes(1);
  expect(session.snapshot).toMatchObject({ status: "active", sceneIndex: 0 });
  session.end("parent_stop");
  await session.recordingSettled();
  expect(recorder.finalize).toHaveBeenCalledWith("parent_stop", true);
});

it("finalization failures are reported and attempt an incomplete marker", async () => {
  const { session, recorder } = setup();
  vi.mocked(recorder.finalize).mockRejectedValue(new Error("offline"));
  session.receive({ type: "session.started" });
  session.end("parent_stop");
  await session.recordingSettled();
  expect(recorder.markIncomplete).toHaveBeenCalledTimes(1);
  expect(session.events).toContainEqual(
    expect.objectContaining({ type: "recording.failed", detail: expect.objectContaining({ operation: "finalize" }) }),
  );
});
