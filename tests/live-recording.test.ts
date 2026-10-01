import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LessonSession, type EndReason, type Transport } from "../lib/session";
import { RecordingQueue, type Evidence, type SessionRecorder } from "../lib/session-recorder";
import { LAST_SCENE } from "../lib/lesson";
import { UTTERANCE_GAP_MS } from "../lib/transcript";
import { CORRECTION_WINDOW_MS, TRANSCRIPT_FALLBACK_MS, type EvaluateAnswer } from "../lib/answer";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function setup(delivery = false, retryOf?: string, evaluator?: EvaluateAnswer) {
  const writes: (string | Evidence)[] = [];
  const recorder: SessionRecorder = {
    appendTimeline: vi.fn(async () => {}),
    attachRecording: vi.fn(async () => {}),
    create: vi.fn(async () => {
      writes.push("create");
      return "session-test";
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
    recording: vi.fn(async () => ({
      blob: new Blob(["audio"]),
      mimeType: "audio/webm",
      startOffsetMs: 0,
      durationMs: 100,
    })),
    delivered: () => delivery,
  };
  const session = new LessonSession(
    transport,
    evaluator ?? (async () => ({ status: "evaluated", probability: 1, model: "test", latencyMs: 1 })),
    vi.fn(),
    undefined,
    recorder,
    retryOf,
  );
  void session.start();
  return { session, recorder, writes, transport };
}
function say(session: LessonSession, speaker: "child" | "sprout", delta: string, startMs = 0) {
  session.receive({ type: "transcript", speaker, delta, startMs, endMs: startMs + 100 });
}
const evidence = (writes: (string | Evidence)[]) =>
  writes.filter((write): write is Evidence => typeof write !== "string");

it("excludes startup delay from canonical timestamps while retaining the diagnostic clock", async () => {
  const { session, recorder, writes } = setup();
  await vi.advanceTimersByTimeAsync(2000);
  session.receive({ type: "session.started" });
  await vi.advanceTimersByTimeAsync(200);
  session.displayed(0);
  await session.recordingSettled();
  expect(recorder.append).toHaveBeenNthCalledWith(
    1,
    "evidence_1",
    200,
    expect.objectContaining({ type: "scene_displayed" }),
  );

  await vi.advanceTimersByTimeAsync(100);
  say(session, "child", "hello", 250);
  await vi.advanceTimersByTimeAsync(UTTERANCE_GAP_MS);
  await session.recordingSettled();
  expect(recorder.append).toHaveBeenNthCalledWith(2, "evidence_2", 300 + UTTERANCE_GAP_MS, {
    firstObservedAtMs: 300,
    lastObservedAtMs: 300,
    type: "utterance",
    speaker: "child_or_nearby_speaker",
    text: "hello",
    providerTiming: { clock: "provider", startMs: 250, endMs: 350 },
    responseScene: {
      provenance: "application_transcript_context",
      sceneId: "hello-duck",
      displayedAtMs: 200,
      status: "stable",
    },
    recognition: "needs_confirmation",
    startMs: 250,
    endMs: 350,
    state: "finalized",
  });
  expect(evidence(writes).map(event => event.type)).toEqual(["scene_displayed", "utterance"]);
  const report = session.report("test");
  expect(report.liveStartedAtMs).toBe(2000);
  expect(report.events.find(event => event.type === "lesson.started")?.at).toBe(2000);
  expect(report.events.find(event => event.type === "scene.displayed")?.at).toBe(2200);
  expect(report.events.find(event => event.type === "transcript.child_or_nearby_speaker")?.at).toBe(2300);
  session.end("parent_stop");
  await session.recordingSettled();
});

it("rejects canonical evidence when the live start origin is unavailable", async () => {
  const { session, recorder } = setup();
  session.receive({ type: "session.started" });
  const startedAt = session.startedAt;
  session.startedAt = undefined;
  expect(() => session.displayed(0)).toThrow("Canonical evidence requires a live session start");
  await session.recordingSettled();
  expect(recorder.append).not.toHaveBeenCalled();
  session.startedAt = startedAt;
  session.end("parent_stop");
  await session.recordingSettled();
});

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
      providerTiming: { clock: "provider", startMs: 0, endMs: 200 },
      recognition: "needs_confirmation",
      firstObservedAtMs: 0,
      lastObservedAtMs: 0,
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
    {
      type: "utterance",
      speaker: "sprout",
      text: "Hello friend",
      providerTiming: { clock: "provider", startMs: 0, endMs: 200 },
      responseScene: {
        provenance: "application_transcript_context",
        sceneId: "hello-duck",
        displayedAtMs: 0,
        status: "stable",
      },
      startMs: 0,
      endMs: 200,
      state: "finalized",
      firstObservedAtMs: 0,
      lastObservedAtMs: 0,
    },
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
      appendTimeline: vi.fn(async () => {}),
      attachRecording: async () => {},
      async create() {
        operations.push("create");
        sessionId = await t.mutation(api.sessions.create, {});
        return sessionId;
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
      recording: async () => ({ blob: new Blob(["audio"]), mimeType: "audio/webm", startOffsetMs: 0, durationMs: 100 }),
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

it("uploads only after evidence and finalization; releases media immediately", async () => {
  const { session, recorder, transport, writes } = setup();
  let finish!: () => void;
  vi.mocked(transport.recording!).mockImplementation(
    () =>
      new Promise(resolve => {
        finish = () => resolve({ blob: new Blob(["audio"]), mimeType: "audio/mp4", startOffsetMs: 0, durationMs: 123 });
      }),
  );
  session.receive({ type: "session.started" });
  say(session, "child", "hello");
  session.end("connection_failure");
  expect(transport.stopMedia).toHaveBeenCalledOnce();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(writes.at(-1)).toBe("connection_failure");
  expect(recorder.attachRecording).not.toHaveBeenCalled();
  finish();
  await session.recordingSettled();
  expect(recorder.attachRecording).toHaveBeenCalledWith(
    expect.objectContaining({ durationMs: 123, mimeType: "audio/mp4" }),
  );
});

it.each(["missing", "capture", "upload/attach"])("marks required audio %s failure incomplete", async failure => {
  const { session, recorder, transport } = setup();
  if (failure === "missing") vi.mocked(transport.recording!).mockResolvedValue(null);
  if (failure === "capture") vi.mocked(transport.recording!).mockRejectedValue(new Error("capture failed"));
  if (failure === "upload/attach") vi.mocked(recorder.attachRecording).mockRejectedValue(new Error("network failed"));
  session.receive({ type: "session.started" });
  session.end("parent_stop");
  await session.recordingSettled();
  expect(recorder.markIncomplete).toHaveBeenCalledOnce();
  expect(session.snapshot.recordingError).toBeTruthy();
});

function durableAudioSetup() {
  const t = convexTest(schema, import.meta.glob("../convex/**/*.ts"));
  const { session, recorder, transport } = setup();
  let sessionId!: Id<"sessions">;
  let finalized!: () => void;
  const finalization = new Promise<void>(resolve => {
    finalized = resolve;
  });
  vi.mocked(recorder.create).mockImplementation(async () => {
    sessionId = await t.mutation(api.sessions.create, {});
    return sessionId;
  });
  vi.mocked(recorder.activate).mockImplementation(async () => {
    await t.mutation(api.sessions.activate, { sessionId });
  });
  vi.mocked(recorder.markIncomplete).mockImplementation(async () => {
    await t.mutation(api.sessions.markIncomplete, { sessionId });
  });
  vi.mocked(recorder.finalize).mockImplementation(async (endingReason, recordIncomplete) => {
    await t.mutation(api.sessions.finalize, { sessionId, endingReason, recordIncomplete });
    finalized();
  });
  return { session, recorder, transport, finalization, record: () => t.query(api.sessions.getRecord, { sessionId }) };
}

it.each(["capture", "upload"])("stays ended and pending while post-finalize %s never completes", async phase => {
  const { session, recorder, transport, finalization, record } = durableAudioSetup();
  const stalled = new Promise<never>(() => {});
  if (phase === "capture") vi.mocked(transport.recording!).mockReturnValue(stalled);
  else vi.mocked(recorder.attachRecording).mockReturnValue(stalled);
  session.receive({ type: "session.started" });
  session.end("page_hidden");
  await finalization;
  expect((await record())?.session).toMatchObject({ state: "ended", recordStatus: "pending" });
  expect((await record())?.session.recording).toBeUndefined();
});

it.each([false, true])("audio attachment failure attempts the durable marker (marker fails=%s)", async markerFails => {
  const { session, recorder, finalization, record } = durableAudioSetup();
  vi.mocked(recorder.attachRecording).mockRejectedValue(new Error("attachment offline"));
  if (markerFails) vi.mocked(recorder.markIncomplete).mockRejectedValue(new Error("marker offline"));
  session.receive({ type: "session.started" });
  session.end("parent_stop");
  await finalization;
  await session.recordingSettled();
  expect(recorder.markIncomplete).toHaveBeenCalledOnce();
  expect((await record())?.session).toMatchObject({
    state: "ended",
    recordStatus: markerFails ? "pending" : "incomplete",
  });
  expect((await record())?.session.recording).toBeUndefined();
});

it("keeps a successfully created durable reference in the ended snapshot", async () => {
  const { session } = setup();
  await session.recordingSettled();
  expect(session.snapshot.durableSessionRef).toBe("session-test");
  session.end("parent_stop");
  await session.recordingSettled();
  expect(session.snapshot).toMatchObject({ status: "ended", durableSessionRef: "session-test" });
});

it("publishes late durable creation into an already ended snapshot", async () => {
  const { session, recorder } = setup();
  let resolve!: (ref: string) => void;
  vi.mocked(recorder.create).mockReturnValue(
    new Promise<string>(done => {
      resolve = done;
    }),
  );
  await Promise.resolve();
  session.end("parent_stop");
  expect(session.snapshot.durableSessionRef).toBeUndefined();
  resolve("late-attempt");
  await session.recordingSettled();
  expect(session.snapshot).toMatchObject({ status: "ended", durableSessionRef: "late-attempt" });
});

it("failed creation leaves no inspectable durable reference", async () => {
  const { session, recorder } = setup();
  vi.mocked(recorder.create).mockRejectedValue(new Error("offline"));
  session.end("parent_stop");
  await session.recordingSettled();
  expect(session.snapshot.durableSessionRef).toBeUndefined();
});

it("passes retry linkage only to a fresh controller's recorder", async () => {
  const { session: original, recorder: priorRecorder, transport: priorTransport } = setup();
  await original.recordingSettled();
  original.end("parent_stop");
  await original.recordingSettled();
  const previous = original.snapshot;
  const { session: retry, recorder, transport } = setup(false, previous.durableSessionRef);
  vi.mocked(recorder.create).mockResolvedValue("new-attempt");
  await retry.recordingSettled();
  expect(transport).not.toBe(priorTransport);
  expect(priorRecorder.create).toHaveBeenCalledWith(undefined);
  expect(recorder.create).toHaveBeenCalledWith("session-test");
  expect(retry.snapshot.durableSessionRef).toBe("new-attempt");
  expect(original.snapshot).toBe(previous);
  expect(retry.events).not.toBe(original.events);
  retry.dispose();
  await retry.recordingSettled();
});

it("retains generated output while gated, with independent observation and provider clocks", async () => {
  const { session, recorder, writes } = setup(true);
  await vi.advanceTimersByTimeAsync(2000);
  session.receive({ type: "session.started" });
  session.displayed(0);
  await vi.advanceTimersByTimeAsync(100);
  say(session, "child", "one", 20);
  say(session, "sprout", "That is ", 40);
  await vi.advanceTimersByTimeAsync(250);
  say(session, "sprout", "right", 120);
  session.end("parent_stop");
  await session.recordingSettled();
  const timeline = vi.mocked(recorder.appendTimeline).mock.calls;
  expect(timeline.filter(call => call[2].type === "sprout_generated_utterance").map(call => call.slice(1))).toEqual([
    [
      100,
      {
        type: "sprout_generated_utterance",
        speaker: "sprout",
        text: "That is right",
        startMs: 40,
        endMs: 220,
        firstObservedAtMs: 100,
        lastObservedAtMs: 350,
        state: "interrupted",
      },
    ],
  ]);
  expect(evidence(writes).filter(e => e.type === "utterance" && e.speaker === "sprout")).toEqual([]);
  expect(timeline.filter(call => call[2].type === "playback_gate_changed").map(call => call.slice(1))).toEqual([
    [0, { type: "playback_gate_changed", state: "permitted", reason: "session_started" }],
    [100, { type: "playback_gate_changed", state: "blocked", reason: "answer_evaluation" }],
    [350, { type: "playback_gate_changed", state: "permitted", reason: "parent_stop" }],
  ]);
  expect(recorder.appendTimeline).toHaveBeenCalledBefore(vi.mocked(recorder.finalize));
});

it("preserves VAD, evaluation, committed advancement and actual display on one clock", async () => {
  const { session, recorder } = setup();
  await vi.advanceTimersByTimeAsync(900);
  session.receive({ type: "session.started" });
  session.displayed(0);
  await vi.advanceTimersByTimeAsync(100);
  session.receive({ type: "microphone.speech_started" });
  say(session, "child", "one", 100);
  await vi.advanceTimersByTimeAsync(1000);
  session.receive({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(250);
  await session.recordingSettled();
  const calls = () => vi.mocked(recorder.appendTimeline).mock.calls;
  expect(calls().find(call => call[2].type === "microphone_speech_started")?.[1]).toBe(100);
  expect(
    calls()
      .find(call => call[2].type === "microphone_speech_stopped")
      ?.slice(1),
  ).toEqual([1100, { type: "microphone_speech_stopped", quietMs: 900, estimatedAcousticEndAtMs: 200 }]);
  const request = calls().find(call => call[2].type === "answer_evaluation_requested")!;
  expect(request.slice(1)).toEqual([
    1350,
    {
      type: "answer_evaluation_requested",
      correlationKey: "0:100:one",
      sceneIndex: 0,
      turnSignal: "microphone_vad",
      turnEndToRequestMs: 250,
    },
  ]);
  expect(calls().find(call => call[2].type === "answer_evaluation_resolved")?.[2]).toMatchObject({
    correlationKey: "0:100:one",
    status: "evaluated",
    probability: 1,
    latencyMs: 1,
    decision: "ADVANCE",
  });
  const evaluatedAt = session.events.findLast(event => event.type === "answer.evaluated")!.at;
  const turnEndAt = session.events.findLast(event => event.type === "answer.turn_end")!.at;
  const candidate = session.events.findLast(event => event.type === "answer.candidate")!;
  const transcriptAt = (candidate.detail as { transcript_at: number }).transcript_at;
  const releaseAt = Math.max(Math.max(turnEndAt, transcriptAt) + CORRECTION_WINDOW_MS, evaluatedAt);
  // At an already-due deadline, flush the queued callback on the next timer tick.
  const releaseDelay = Math.max(1, session.createdAt + releaseAt - Date.now());
  const committedAt = Date.now() + releaseDelay - session.createdAt - 900;
  await vi.advanceTimersByTimeAsync(releaseDelay);
  await session.recordingSettled();
  expect(
    calls()
      .find(call => call[2].type === "scene_advance_committed")
      ?.slice(1),
  ).toEqual([committedAt, { type: "scene_advance_committed", fromScene: 0, toScene: 1, correlationKey: "0:100:one" }]);
  expect(vi.mocked(recorder.append).mock.calls.filter(call => call[2].type === "scene_displayed")).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(80);
  session.displayed(1);
  await session.recordingSettled();
  expect(
    vi
      .mocked(recorder.append)
      .mock.calls.filter(call => call[2].type === "scene_displayed")
      .at(-1)?.[1],
  ).toBe(committedAt + 80);
  session.end("parent_stop");
  await session.recordingSettled();
});

it("finalizes unknown generated speech once and separates it from verified evidence", async () => {
  const { session, recorder, writes } = setup();
  session.receive({ type: "session.started" });
  say(session, "sprout", "Hello");
  await vi.advanceTimersByTimeAsync(UTTERANCE_GAP_MS);
  session.end("parent_stop");
  await session.recordingSettled();
  expect(
    vi
      .mocked(recorder.appendTimeline)
      .mock.calls.filter(call => call[2].type === "sprout_generated_utterance")
      .map(call => call[2]),
  ).toEqual([
    {
      type: "sprout_generated_utterance",
      speaker: "sprout",
      text: "Hello",
      startMs: 0,
      endMs: 100,
      firstObservedAtMs: 0,
      lastObservedAtMs: 0,
      state: "finalized",
    },
  ]);
  expect(evidence(writes)).toEqual([]);
});

it.each(["timeout", "request_failed", "cancelled"])(
  "retains %s evaluation status without manufactured learner evidence",
  async reason => {
    const evaluator: EvaluateAnswer =
      reason === "cancelled"
        ? () => new Promise(() => {})
        : reason === "request_failed"
          ? async () => {
              throw new Error("offline");
            }
          : async () => ({ status: "unavailable", reason, latencyMs: 40 });
    const { session, recorder, writes } = setup(false, undefined, evaluator);
    session.receive({ type: "session.started" });
    session.displayed(0);
    say(session, "child", "one");
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_FALLBACK_MS);
    session.end("parent_stop");
    await session.recordingSettled();
    const timeline = vi.mocked(recorder.appendTimeline).mock.calls.map(call => call[2]);
    expect(timeline.filter(event => event.type === "answer_evaluation_resolved")).toEqual([
      expect.objectContaining({
        type: "answer_evaluation_resolved",
        correlationKey: "0:0:one",
        status: "unavailable",
        reason,
        decision: reason === "cancelled" ? "STALE" : "UNAVAILABLE",
      }),
    ]);
    expect(evidence(writes).map(event => event.type)).toEqual(["scene_displayed", "utterance"]);
    expect(recorder.appendTimeline).toHaveBeenCalledBefore(vi.mocked(recorder.finalize));
  },
);

it("marks timeline write loss incomplete and still flushes generated output and finalizes", async () => {
  const { session, recorder } = setup();
  vi.mocked(recorder.appendTimeline).mockRejectedValueOnce(new Error("offline"));
  session.receive({ type: "session.started" });
  say(session, "sprout", "Hello");
  session.end("parent_stop");
  await session.recordingSettled();
  expect(recorder.markIncomplete).toHaveBeenCalledTimes(1);
  expect(recorder.finalize).toHaveBeenCalledWith("parent_stop", true);
  expect(recorder.appendTimeline).toHaveBeenLastCalledWith(
    expect.any(String),
    0,
    expect.objectContaining({ type: "sprout_generated_utterance", text: "Hello" }),
  );
  expect(session.snapshot.recordingError).toBeDefined();
});
