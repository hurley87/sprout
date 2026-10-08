import { afterEach, expect, it, vi } from "vitest";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import { CATCHING_UNICORNS_LESSON as lesson } from "../lib/lesson-runtime/catching-unicorns-lesson";
import { classificationSource } from "../lib/lesson-runtime/lesson-runtime-reducer";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import replays from "./fixtures/microphone-only-stall-replays.json";

const transport = vi.hoisted(() => ({
  receive: undefined as ((event: ProviderEvent) => void) | undefined,
  send: vi.fn<(command: ClientCommand) => void>(),
}));
vi.mock("../lib/browser-transport", () => ({
  BrowserTransport: class {
    activeSourceId = 1;
    setMicrophoneDiagnosticSink() {}
    async start(receive: (event: ProviderEvent) => void) {
      transport.receive = receive;
      receive({ type: "session.started", sourceId: 1 });
    }
    openInput() {
      return true;
    }
    send = transport.send;
    close() {}
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});

// Provider events/timing are extracted from the exports up to the first recovery.
// Classifier responses are deterministic test doubles, not a new live model evaluation.
function response(body: { nodeId: string; transcriptRevision: number; transcript: string }, closing = true) {
  return Response.json({
    proposal: {
      nodeId: body.nodeId,
      transcriptRevision: body.transcriptRevision,
      childActivity: "unknown",
      answerOutcome: "correct",
      supportState: "none",
      tutorState: closing && /We can move on\.|any further\./u.test(body.transcript) ? "acknowledging" : "unknown",
      conceptObservations: (lesson.nodes[body.nodeId].concepts ?? []).map(c => ({
        criterionId: c.id,
        observation: "demonstrated_independent",
        childMessageIndex: 1,
      })),
    },
  });
}
async function setup(classify = (body: Parameters<typeof response>[0]) => Promise.resolve(response(body))) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    url === "/api/classify" ? classify(JSON.parse(String(init?.body))) : Response.json({ ok: true }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, lesson);
  runtime.confirmRendered(runtime.snapshot().display);
  await vi.advanceTimersByTimeAsync(0);
  const steering = transport.send.mock.calls[0][0];
  if (steering.type !== "session.instructions.append") throw new Error("Expected steering");
  transport.receive!({
    type: "context.appended",
    name: "session.instructions.appended",
    clientEventId: steering.event_id,
    startMs: 0,
  });
  return { runtime, receive: transport.receive!, fetchMock };
}
const recoveryPrompts = () =>
  transport.send.mock.calls.filter(
    ([c]) => c.type === "session.instructions.append" && c.event_id.includes(":answer-recovery:"),
  );

it.each(replays)("replays $recordingId through a fresh closure check and one drained transition", async replay => {
  // Start at the stalled authored node; preserve all subsequent recorded timings.
  const definition = { ...lesson, initialNodeId: replay.nodeId };
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) =>
      url === "/api/classify" ? response(JSON.parse(String(init?.body))) : Response.json({ ok: true }),
    ),
  );
  const runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, definition);
  runtime.confirmRendered(runtime.snapshot().display);
  await vi.advanceTimersByTimeAsync(0);
  const steering = transport.send.mock.calls[0][0];
  if (steering.type !== "session.instructions.append") throw new Error("Expected steering");
  transport.receive!({
    type: "context.appended",
    name: "session.instructions.appended",
    clientEventId: steering.event_id,
    startMs: 0,
  });
  let elapsed = 0;
  for (const item of replay.events) {
    await vi.advanceTimersByTimeAsync(item.atMs - elapsed);
    elapsed = item.atMs;
    transport.receive!(item.event as ProviderEvent);
    expect(runtime.snapshot().runtime?.phase).toBe("active");
  }
  expect(runtime.snapshot().runtime?.hasChildTranscript).toBe(false);
  expect(classificationSource(runtime.snapshot().runtime!)).toBeNull();
  const evidence = structuredClone(runtime.snapshot().runtime?.conceptEvidence);
  await vi.advanceTimersByTimeAsync(5000);
  expect(runtime.snapshot().display.nodeId).toBe(replay.nodeId === "engram" ? "exogram" : "why-exographics");
  expect(
    Object.fromEntries(
      Object.entries(runtime.snapshot().runtime!.conceptEvidence).filter(([key]) =>
        key.startsWith(`${replay.nodeId}:`),
      ),
    ),
  ).toEqual(evidence);
  expect(runtime.observe().events.filter(e => e.type === "conversation.recheck.started")).toHaveLength(1);
  expect(runtime.observe().events.filter(e => e.type === "render.requested")).toHaveLength(1);
  expect(recoveryPrompts()).toHaveLength(0);
  runtime.stop();
});

function interrupted(receive: (event: ProviderEvent) => void) {
  receive({ type: "output.activity", state: "quiet" });
  receive({ type: "microphone.activity_started" });
  receive({
    type: "transcript",
    speaker: "child",
    delta: "A biological memory in the brain.",
    startMs: 100,
    endMs: 200,
  });
  receive({ type: "microphone.speech_stopped", quietMs: 900 });
  receive({ type: "microphone.activity_started" });
  receive({ type: "microphone.speech_started" });
  receive({ type: "microphone.speech_stopped", quietMs: 900 });
  receive({ type: "output.activity", state: "active" });
  receive({
    type: "transcript",
    speaker: "sprout",
    delta: "That captures it. We can move on.",
    startMs: 300,
    endMs: 400,
  });
  receive({ type: "output.activity", state: "quiet" });
}
it.each(["active", "unavailable"] as const)("cannot recheck while tutor output is %s", async activity => {
  const { runtime, receive, fetchMock } = await setup();
  interrupted(receive);
  receive({ type: "output.activity", state: activity });
  await vi.advanceTimersByTimeAsync(6000);
  expect(fetchMock.mock.calls.filter(([url]) => url === "/api/classify")).toHaveLength(0);
  expect(runtime.snapshot().display.nodeId).toBe("engram");
  runtime.stop();
});
it("a delayed correction revokes the recheck before it fires", async () => {
  const { runtime, receive } = await setup(body => Promise.resolve(response(body, false)));
  interrupted(receive);
  await vi.advanceTimersByTimeAsync(3999);
  receive({ type: "transcript", speaker: "child", delta: "Actually I don't know.", startMs: 450, endMs: 500 });
  await vi.advanceTimersByTimeAsync(5000);
  expect(runtime.snapshot().runtime?.interruptedExchange).toBeNull();
  expect(runtime.snapshot().display.nodeId).toBe("engram");
  expect(runtime.observe().events.some(e => e.type === "conversation.recheck.started")).toBe(false);
  runtime.stop();
});
it.each(["correction", "new turn", "skip", "stop"])("rejects a late successful recheck after %s", async change => {
  let resolve!: (r: Response) => void;
  let pending!: Parameters<typeof response>[0];
  const { runtime, receive } = await setup(body => {
    pending = body;
    return new Promise(r => {
      resolve = r;
    });
  });
  interrupted(receive);
  await vi.advanceTimersByTimeAsync(4700);
  expect(pending).toBeDefined();
  if (change === "correction")
    receive({ type: "transcript", speaker: "child", delta: "Actually no.", startMs: 450, endMs: 500 });
  if (change === "new turn") receive({ type: "microphone.activity_started" });
  if (change === "skip") runtime.skipScene();
  if (change === "stop") runtime.stop();
  resolve(response(pending));
  await vi.advanceTimersByTimeAsync(0);
  expect(runtime.observe().events.filter(e => e.type === "render.requested")).toHaveLength(change === "skip" ? 1 : 0);
  expect(recoveryPrompts()).toHaveLength(0);
  runtime.stop();
});
it.each(["hold", "failure"])("falls back to one recovery prompt on classifier %s", async outcome => {
  const { runtime, receive } = await setup(body =>
    Promise.resolve(outcome === "failure" ? Response.json({}, { status: 503 }) : response(body, false)),
  );
  interrupted(receive);
  await vi.advanceTimersByTimeAsync(12000);
  expect(runtime.snapshot().display.nodeId).toBe("engram");
  expect(runtime.snapshot().runtime?.conceptEvidence).toEqual({});
  expect(recoveryPrompts()).toHaveLength(1);
  runtime.stop();
});
it("an initial empty microphone turn still requests missing-answer recovery", async () => {
  const { runtime, receive, fetchMock } = await setup();
  receive({ type: "output.activity", state: "quiet" });
  receive({ type: "microphone.activity_started" });
  receive({ type: "microphone.speech_stopped", quietMs: 900 });
  receive({ type: "transcript", speaker: "sprout", delta: "We can move on.", startMs: 100, endMs: 200 });
  await vi.advanceTimersByTimeAsync(5000);
  expect(fetchMock.mock.calls.filter(([url]) => url === "/api/classify")).toHaveLength(0);
  expect(runtime.snapshot().display.nodeId).toBe("engram");
  expect(recoveryPrompts()).toHaveLength(1);
  runtime.stop();
});

it("a recheck grants no new mastery even when the classifier proposes it", async () => {
  const { runtime, receive } = await setup();
  interrupted(receive);
  await vi.advanceTimersByTimeAsync(3999);
  expect(runtime.snapshot().runtime?.hasChildTranscript).toBe(false);
  expect(runtime.snapshot().runtime?.conceptEvidence).toEqual({});
  await vi.advanceTimersByTimeAsync(1001);
  expect(runtime.snapshot().display.nodeId).toBe("exogram");
  expect(runtime.snapshot().runtime?.conceptEvidence).toEqual({});
  runtime.stop();
});
it("another empty interruption during a recheck can retry without spending the prompt budget", async () => {
  let resolve!: (r: Response) => void;
  let pending!: Parameters<typeof response>[0];
  let calls = 0;
  const { runtime, receive } = await setup(body => {
    if (++calls > 1) return Promise.resolve(response(body));
    pending = body;
    return new Promise(r => {
      resolve = r;
    });
  });
  interrupted(receive);
  await vi.advanceTimersByTimeAsync(4100);
  receive({ type: "microphone.activity_started" });
  receive({ type: "microphone.speech_started" });
  receive({ type: "microphone.speech_stopped", quietMs: 900 });
  resolve(response(pending));
  await vi.advanceTimersByTimeAsync(5000);
  expect(calls).toBe(2);
  expect(runtime.snapshot().display.nodeId).toBe("exogram");
  expect(recoveryPrompts()).toHaveLength(0);
  runtime.stop();
});
it("tutor follow-up supersedes an in-flight closure response", async () => {
  let resolve!: (r: Response) => void;
  let pending!: Parameters<typeof response>[0];
  let calls = 0;
  const { runtime, receive } = await setup(body => {
    if (++calls > 1) return Promise.resolve(response(body, false));
    pending = body;
    return new Promise(r => {
      resolve = r;
    });
  });
  interrupted(receive);
  await vi.advanceTimersByTimeAsync(4100);
  receive({
    type: "transcript",
    speaker: "sprout",
    delta: "Actually, can you clarify what you mean?",
    startMs: 500,
    endMs: 600,
  });
  resolve(response(pending));
  await vi.advanceTimersByTimeAsync(5000);
  expect(runtime.snapshot().display.nodeId).toBe("engram");
  expect(recoveryPrompts()).toHaveLength(1);
  runtime.stop();
});

it("can recheck a later completed exchange after this visit already spent its support prompt", async () => {
  const { runtime, receive } = await setup();
  receive({ type: "output.activity", state: "quiet" });
  receive({ type: "microphone.activity_started" });
  receive({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(4100);
  expect(recoveryPrompts()).toHaveLength(1);
  interrupted(receive);
  await vi.advanceTimersByTimeAsync(5000);
  expect(runtime.snapshot().display.nodeId).toBe("exogram");
  expect(runtime.snapshot().runtime?.interruptedExchange).toBeNull();
  expect(recoveryPrompts()).toHaveLength(1);
  runtime.stop();
});
it("a held recheck waits for resumed tutor audio to drain before prompting", async () => {
  let resolve!: (r: Response) => void;
  let pending!: Parameters<typeof response>[0];
  const { runtime, receive } = await setup(body => {
    pending = body;
    return new Promise(r => {
      resolve = r;
    });
  });
  interrupted(receive);
  await vi.advanceTimersByTimeAsync(4100);
  receive({ type: "output.activity", state: "active" });
  resolve(response(pending, false));
  await vi.advanceTimersByTimeAsync(6000);
  expect(recoveryPrompts()).toHaveLength(0);
  receive({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(4100);
  expect(recoveryPrompts()).toHaveLength(1);
  expect(runtime.snapshot().display.nodeId).toBe("engram");
  runtime.stop();
});
it("requires a fresh audio drain when output resumes during a successful recheck", async () => {
  let resolve!: (r: Response) => void;
  let pending!: Parameters<typeof response>[0];
  const { runtime, receive } = await setup(body => {
    pending = body;
    return new Promise(r => {
      resolve = r;
    });
  });
  interrupted(receive);
  await vi.advanceTimersByTimeAsync(4100);
  receive({ type: "output.activity", state: "unavailable" });
  receive({ type: "output.activity", state: "active" });
  resolve(response(pending));
  await vi.advanceTimersByTimeAsync(1000);
  expect(runtime.snapshot().display.nodeId).toBe("engram");
  receive({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(499);
  expect(runtime.snapshot().display.nodeId).toBe("engram");
  await vi.advanceTimersByTimeAsync(51);
  expect(runtime.snapshot().display.nodeId).toBe("exogram");
  runtime.stop();
});
