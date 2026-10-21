import { afterEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { MAE386_LESSON } from "../lib/lesson-runtime/mae386-lesson";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import { providerEvents, useRuntimeFakeTimers as installRuntimeFakeTimers } from "./helpers/runtime-harness";

const transport = vi.hoisted(() => ({
  receive: undefined as ((event: ProviderEvent) => void) | undefined,
  send: vi.fn<(command: ClientCommand) => void>(),
  close: vi.fn(),
}));
vi.mock("../lib/browser-transport", async () => {
  const { mockBrowserTransport } = await import("./helpers/runtime-harness");
  return { BrowserTransport: mockBrowserTransport(transport) };
});
let runtime: LessonRuntime;
afterEach(() => {
  runtime?.stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});
function start(nodeId = "q10-1") {
  installRuntimeFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
  runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, { ...MAE386_LESSON, initialNodeId: nodeId });
  const events = providerEvents(event => transport.receive!(event));
  runtime.confirmRendered(runtime.snapshot().display);
  const steering = transport.send.mock.calls.at(-1)![0];
  if (steering.type !== "session.instructions.append") throw new Error("Expected steering");
  events.acknowledgeSteering(steering.event_id, 0);
  return events;
}
it.each([
  ["q10-1", "Next.", "q10-2", []],
  ["q10-2", "Skip this one.", "q10-3", []],
  ["q10-3", "Next question.", "q5-a", []],
  ["q10-1", "Next question.", "q5-a", ["q10-2", "q10-3"]],
  ["q5-a", "Skip this question.", "q12", ["q5-c", "q5-f"]],
] as const)("scheduler maps %s / %s through authored render/steering", async (node, command, target, siblings) => {
  const events = start(node);
  transport.receive!({ type: "output.activity", state: "active" });
  events.childTurn(command, 100);
  await vi.advanceTimersByTimeAsync(1500);
  expect(runtime.snapshot().runtime?.nodeId).toBe(node);
  transport.receive!({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(runtime.snapshot().runtime).toMatchObject({ nodeId: target, phase: "rendering", navigationHistory: [] });
  const display = runtime.snapshot().display;
  runtime.confirmRendered({ ...display, token: "wrong" });
  expect(runtime.snapshot().runtime?.phase).toBe("rendering");
  runtime.confirmRendered(display);
  runtime.confirmRendered(display);
  expect(runtime.snapshot().runtime?.navigationHistory).toMatchObject([
    { source: { nodeId: node, transcriptRevision: 1 }, skippedNodeIds: [...siblings] },
  ]);
  expect(transport.send.mock.calls.filter(([c]) => c.type === "session.instructions.append")).toHaveLength(2);
});
it.each(["I don't know.", '"Next question."', 'He said "next question".', "Can you explain the next question?"])(
  "scheduler does not navigate on %s",
  async text => {
    const events = start();
    transport.receive!({ type: "output.activity", state: "quiet" });
    events.childTurn(text, 100);
    await vi.advanceTimersByTimeAsync(2000);
    expect(runtime.snapshot().runtime?.nodeId).toBe("q10-1");
    expect(runtime.snapshot().runtime?.navigationHistory).toEqual([]);
  },
);
it("I don't know may be followed by an explicit skip without classifier approval", async () => {
  const events = start();
  transport.receive!({ type: "output.activity", state: "quiet" });
  events.childTurn("I don't know.", 100);
  await vi.advanceTimersByTimeAsync(1000);
  events.childTurn("Skip this one.", 400);
  await vi.advanceTimersByTimeAsync(1000);
  expect(runtime.snapshot().runtime?.nodeId).toBe("q10-2");
});
it("spoken Stop tears down immediately after authenticated speech-end even with active playback and pending assessment", () => {
  start();
  transport.receive!({ type: "output.activity", state: "active" });
  transport.receive!({ type: "microphone.activity_started" });
  transport.receive!({ type: "transcript", speaker: "child", delta: "Stop.", startMs: 100, endMs: 200 });
  expect(transport.close).not.toHaveBeenCalled();
  transport.receive!({ type: "microphone.speech_stopped", quietMs: 900 });
  expect(transport.close).toHaveBeenCalledOnce();
  expect(runtime.snapshot().runtime?.phase).toBe("stopped");
  expect(runtime.snapshot().status).toBe("ended");
});
it.each(['"Stop."', 'The tutor said "stop".', "Don't stop."])(
  "reported/quoted/negated Stop never tears down: %s",
  text => {
    const events = start();
    events.childTurn(text, 100);
    expect(transport.close).not.toHaveBeenCalled();
  },
);
it("unbound learner text and tutor Stop have no stop authority", () => {
  const events = start();
  transport.receive!({ type: "transcript", speaker: "child", delta: "Stop.", startMs: 100, endMs: 200 });
  transport.receive!({ type: "microphone.speech_stopped", quietMs: 900 });
  events.tutorTurn("Stop.", 300);
  expect(transport.close).not.toHaveBeenCalled();
});
it("UI Stop releases immediately without quiet or speech-end", () => {
  start();
  transport.receive!({ type: "output.activity", state: "active" });
  transport.receive!({ type: "microphone.activity_started" });
  runtime.stop();
  expect(transport.close).toHaveBeenCalledOnce();
  expect(runtime.snapshot().runtime?.phase).toBe("stopped");
});
it("UI question skip records no learner text and skips remaining sibling cases", async () => {
  start("q5-a");
  transport.receive!({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(1000);
  runtime.skipScene("question");
  expect(runtime.snapshot().runtime?.nodeId).toBe("q12");
  runtime.confirmRendered(runtime.snapshot().display);
  expect(runtime.snapshot().runtime?.navigationHistory).toMatchObject([
    { hasChildTranscript: false, intent: { action: "skip", scope: "question" }, skippedNodeIds: ["q5-c", "q5-f"] },
  ]);
});

it.each(["I don't know.", "He was late because he overslept."])(
  "Stop in a separate authenticated turn releases media after %s",
  answer => {
    const events = start();
    transport.receive!({ type: "output.activity", state: "active" });
    events.childTurn(answer, 100);
    events.childTurn("Stop.", 400);
    expect(transport.close).toHaveBeenCalledOnce();
    expect(runtime.snapshot().runtime?.phase).toBe("stopped");
  },
);
it.each([
  ["Next.", "q10-2"],
  ["Next question.", "q5-a"],
  ["Skip this one.", "q10-2"],
  ["Skip this question.", "q5-a"],
])("a separate %s after an answer retains its authored scope", async (command, target) => {
  const events = start();
  transport.receive!({ type: "output.activity", state: "quiet" });
  events.childTurn("He was late because he overslept.", 100);
  events.childTurn(command, 400);
  await vi.advanceTimersByTimeAsync(2000);
  expect(runtime.snapshot().runtime?.nodeId).toBe(target);
});
it.each([100, 400])("an empty confirmed segment at %sms revalidates the authenticated parent request", async delay => {
  const events = start();
  transport.receive!({ type: "output.activity", state: "active" });
  events.childTurn("Next question.", 100);
  const originalTurn = runtime.snapshot().runtime!.childTurnId;
  await vi.advanceTimersByTimeAsync(delay);
  transport.receive!({ type: "microphone.activity_started" });
  transport.receive!({ type: "microphone.speech_started" });
  transport.receive!({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(1000);
  expect(runtime.snapshot().runtime?.nodeId).toBe("q10-1");
  transport.receive!({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(runtime.snapshot().runtime).toMatchObject({ nodeId: "q5-a", phase: "rendering", conceptEvidence: {} });
  runtime.confirmRendered(runtime.snapshot().display);
  expect(runtime.snapshot().runtime?.navigationHistory).toMatchObject([
    { source: { childTurnId: originalTurn, transcriptRevision: 1 }, skippedNodeIds: ["q10-2", "q10-3"] },
  ]);
});
it.each(['"Stop."', 'He said "stop".', '"Next question."', 'He said "next question".', "Help me with this sentence."])(
  "a later learner turn supersedes an older next request: %s",
  async text => {
    const events = start();
    transport.receive!({ type: "output.activity", state: "quiet" });
    events.childTurn("Next question.", 100);
    events.childTurn(text, 400);
    await vi.advanceTimersByTimeAsync(2000);
    expect(transport.close).not.toHaveBeenCalled();
    expect(runtime.snapshot().runtime?.nodeId).toBe("q10-1");
  },
);
it.each([
  ["He said ", '"Stop."'],
  ["Next question.", " Actually, help me."],
  ["Stop", " and explain this."],
])("same-turn fragments stay together: %s / %s", async (first, second) => {
  const events = start();
  events.childTurn("He was late because he overslept.", 100);
  transport.receive!({ type: "output.activity", state: "quiet" });
  transport.receive!({ type: "microphone.activity_started" });
  transport.receive!({ type: "transcript", speaker: "child", delta: first, startMs: 400, endMs: 450 });
  transport.receive!({ type: "transcript", speaker: "child", delta: second, startMs: 451, endMs: 500 });
  transport.receive!({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(2000);
  expect(transport.close).not.toHaveBeenCalled();
  expect(runtime.snapshot().runtime?.nodeId).toBe("q10-1");
});
it("a fragmented direct Stop after an answer waits for speech-end then closes", () => {
  const events = start();
  events.childTurn("He was late because he overslept.", 100);
  transport.receive!({ type: "microphone.activity_started" });
  transport.receive!({ type: "transcript", speaker: "child", delta: "St", startMs: 400, endMs: 450 });
  transport.receive!({ type: "transcript", speaker: "child", delta: "op.", startMs: 451, endMs: 500 });
  expect(transport.close).not.toHaveBeenCalled();
  transport.receive!({ type: "microphone.speech_stopped", quietMs: 900 });
  expect(transport.close).toHaveBeenCalledOnce();
});

it("an empty segment without an authenticated command still receives bounded recovery", async () => {
  start();
  transport.receive!({ type: "output.activity", state: "quiet" });
  transport.receive!({ type: "microphone.speech_started" });
  transport.receive!({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(5000);
  expect(runtime.snapshot().runtime?.nodeId).toBe("q10-1");
  expect(transport.send.mock.calls.filter(([command]) => command.event_id.includes(":answer-recovery:"))).toHaveLength(
    1,
  );
});
