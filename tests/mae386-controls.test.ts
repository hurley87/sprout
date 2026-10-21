import { afterEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { MAE386_LESSON } from "../lib/lesson-runtime/mae386-lesson";
import { MAE386_RUBRICS } from "../lib/lesson-runtime/mae386/rubrics";
import { COUNTING_LESSON } from "../lib/lesson-runtime/counting-lesson";
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
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
function start(nodeId = "q10-1", lesson = MAE386_LESSON, initialBoundary = 0) {
  installRuntimeFakeTimers();
  runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, { ...lesson, initialNodeId: nodeId });
  runtime.confirmRendered(runtime.snapshot().display);
  const events = providerEvents(event => transport.receive!(event));
  const command = transport.send.mock.calls.at(-1)![0];
  if (command.type !== "session.instructions.append") throw new Error("Expected steering");
  events.acknowledgeSteering(command.event_id, initialBoundary);
  return events;
}

it.each(["help", "repeat"] as const)(
  "%s control requires a live rendered quiet node and never invents learner evidence",
  async request => {
    const events = start();
    const before = transport.send.mock.calls.length;
    runtime.requestSupport(request); // unavailable playback cannot establish quiet
    expect(transport.send).toHaveBeenCalledTimes(before);
    transport.receive!({ type: "output.activity", state: "quiet" });
    runtime.requestSupport(request); // insufficient quiet
    expect(transport.send).toHaveBeenCalledTimes(before);
    await vi.advanceTimersByTimeAsync(600);
    transport.receive!({ type: "microphone.activity_started" });
    runtime.requestSupport(request);
    expect(transport.send).toHaveBeenCalledTimes(before);
    transport.receive!({ type: "microphone.activity_discarded" });
    await vi.advanceTimersByTimeAsync(600);
    runtime.requestSupport(request);
    const command = transport.send.mock.calls.at(-1)![0];
    expect(command.type).toBe("session.instructions.append");
    if (command.type !== "session.instructions.append") throw new Error("Expected support");
    expect(command.content).toContain(
      request === "help" ? "explicitly requested help" : String(MAE386_LESSON.nodes["q10-1"].presentation.sourceText),
    );
    expect(command.content).not.toContain(String(MAE386_LESSON.nodes["q10-2"].presentation.sourceText));
    expect(command.content).toContain("not an answer or evidence");
    const snapshot = runtime.snapshot();
    expect(snapshot.runtime?.nodeId).toBe("q10-1");
    expect(snapshot.transcript).toBe("");
    expect(snapshot.runtime?.conceptEvidence).toEqual({});
    expect(snapshot.awaitingSteering).toBe(true);
    runtime.requestSupport(request); // no duplicate until matching acknowledgment
    expect(transport.send).toHaveBeenCalledTimes(before + 1);
    events.acknowledgeSteering(command.event_id, 0);
    expect(runtime.snapshot().awaitingSteering).toBe(false);
    runtime.requestSupport(request);
    const second = transport.send.mock.calls.at(-1)![0];
    expect(second.event_id).not.toBe(command.event_id);
    runtime.stop();
    const count = transport.send.mock.calls.length;
    runtime.requestSupport(request);
    expect(transport.send).toHaveBeenCalledTimes(count);
  },
);

it("support cannot append during recap or extend counting behavior", async () => {
  for (const [node, lesson] of [
    ["recap", MAE386_LESSON],
    [COUNTING_LESSON.initialNodeId, COUNTING_LESSON],
  ] as const) {
    start(node, lesson);
    transport.receive!({ type: "output.activity", state: "quiet" });
    await vi.advanceTimersByTimeAsync(600);
    const count = transport.send.mock.calls.length;
    runtime.requestSupport("help");
    runtime.requestSupport("repeat");
    expect(transport.send).toHaveBeenCalledTimes(count);
    runtime.stop();
  }
});

it.each(["q8", "q5-f"])(
  "%s Help delivers the current authored explanation guidance without inventing an answer",
  async nodeId => {
    start(nodeId);
    transport.receive!({ type: "output.activity", state: "quiet" });
    await vi.advanceTimersByTimeAsync(600);
    runtime.requestSupport("help");
    const command = transport.send.mock.calls.at(-1)![0];
    if (command.type !== "session.instructions.append") throw new Error("Expected help");
    const unit = MAE386_RUBRICS.flatMap(question => question.units).find(unit => unit.id === nodeId)!;
    expect(command.content).toContain(unit.tutor.help);
    expect(command.content).toContain("in this reply");
    expect(command.content).not.toContain(unit.referenceAnswer);
    expect(runtime.snapshot().runtime).toMatchObject({ nodeId, conceptEvidence: {}, hasChildTranscript: false });
    expect(runtime.snapshot().transcript).toBe("");
    expect(runtime.snapshot().awaitingSteering).toBe(true);
  },
);

it("a UI support request holds stale closure classification until actual new conversation arrives", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ proposal: null }), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  const events = start("q1");
  events.childTurn("External representations help people think together.", 100);
  events.tutorTurn("That closes this question.", 300);
  // Quiet enough for a UI action, before the tutor stabilization window ends.
  await vi.advanceTimersByTimeAsync(500);
  runtime.requestSupport("help");
  const command = transport.send.mock.calls.at(-1)![0];
  if (command.type !== "session.instructions.append") throw new Error("Expected support");
  expect(command.content).toContain("explicitly requested help");
  events.acknowledgeSteering(command.event_id, 0);
  await vi.advanceTimersByTimeAsync(2000);
  expect(fetch).not.toHaveBeenCalled();
  expect(runtime.snapshot().runtime?.nodeId).toBe("q1");
  // Audio can arrive before its transcript; it still cannot revive old closure.
  transport.receive!({ type: "output.activity", state: "active" });
  transport.receive!({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(2000);
  expect(fetch).not.toHaveBeenCalled();
  events.tutorTurn("Think about how a shared diagram might help. What is your own explanation?", 500);
  await vi.advanceTimersByTimeAsync(1500);
  expect(fetch).toHaveBeenCalled();
  expect(runtime.snapshot().runtime?.nodeId).toBe("q1");
});

async function pendingSupport(request: "help" | "repeat", initialBoundary = 0) {
  const events = start("q10-1", MAE386_LESSON, initialBoundary);
  transport.receive!({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(600);
  runtime.requestSupport(request);
  const command = transport.send.mock.calls.at(-1)![0];
  if (command.type !== "session.instructions.append") throw new Error("Expected support");
  expect(runtime.snapshot().awaitingSteering).toBe(true);
  transport.receive!({ type: "output.activity", state: "active" });
  return { events, command };
}

it.each(["help", "repeat"] as const)(
  "%s pending acknowledgment cannot delay completed authenticated Stop, including fragmented speech and queued tutor text",
  async request => {
    for (const parts of [["Stop."], ["St", "op."], ["Please ", "stop the ", "session."]]) {
      const { events, command } = await pendingSupport(request);
      // Same-node tutor output still waits for support acknowledgment. It is
      // never allowed to impersonate learner navigation.
      transport.receive!({ type: "transcript", speaker: "sprout", delta: "Please say stop.", startMs: 10, endMs: 90 });
      transport.receive!({ type: "microphone.activity_started" });
      for (const [index, delta] of parts.entries()) {
        transport.receive!({
          type: "transcript",
          speaker: "child",
          delta,
          startMs: 100 + index * 30,
          endMs: 120 + index * 30,
        });
        expect(transport.close).not.toHaveBeenCalled();
      }
      transport.receive!({ type: "microphone.speech_stopped", quietMs: 900 });
      expect(transport.close).toHaveBeenCalledOnce();
      expect(runtime.snapshot()).toMatchObject({ status: "ended", questionRecap: { label: "Session ended early" } });
      const frozen = runtime.snapshot().questionOutcomes;
      events.acknowledgeSteering(command.event_id, 5000);
      events.childTurn("Next question.", 6000);
      await vi.advanceTimersByTimeAsync(11_000);
      expect(transport.close).toHaveBeenCalledOnce();
      expect(runtime.snapshot().questionOutcomes).toBe(frozen);
      expect(runtime.snapshot().runtime?.nodeId).toBe("q10-1");
      vi.clearAllMocks();
    }
  },
);

it.each(["help", "repeat"] as const)(
  "%s keeps separate authenticated turns intact while support is pending",
  async request => {
    const { events } = await pendingSupport(request);
    events.childTurn("He was late because he overslept.", 100);
    expect(transport.close).not.toHaveBeenCalled();
    events.childTurn("Stop.", 400);
    expect(transport.close).toHaveBeenCalledOnce();
  },
);

it.each(["help", "repeat"] as const)(
  "%s never promotes quoted, negated, reported or extended speech into Stop",
  async request => {
    for (const parts of [['"Stop."'], ["Don't stop."], ["He said ", '"Stop."'], ["Stop", " and explain this."]]) {
      const { events, command } = await pendingSupport(request);
      transport.receive!({ type: "microphone.activity_started" });
      for (const [index, delta] of parts.entries())
        transport.receive!({
          type: "transcript",
          speaker: "child",
          delta,
          startMs: 100 + index * 40,
          endMs: 130 + index * 40,
        });
      transport.receive!({ type: "microphone.speech_stopped", quietMs: 900 });
      expect(transport.close).not.toHaveBeenCalled();
      events.acknowledgeSteering(command.event_id, 0);
      expect(transport.close).not.toHaveBeenCalled();
      runtime.stop();
      vi.clearAllMocks();
    }
  },
);

it.each(["help", "repeat"] as const)(
  "%s rejects unbound, wrong-connection and pre-visit Stop fragments",
  async request => {
    const { command } = await pendingSupport(request);
    transport.receive!({ type: "transcript", speaker: "child", delta: "Stop.", startMs: 100, endMs: 200 });
    transport.receive!({ type: "microphone.speech_stopped", quietMs: 900 });
    expect(transport.close).not.toHaveBeenCalled();
    transport.receive!({ type: "microphone.activity_started" });
    transport.receive!({ type: "transcript", speaker: "child", delta: "Stop.", startMs: 100, endMs: 200, sourceId: 2 });
    transport.receive!({ type: "transcript", speaker: "child", delta: "Stop.", startMs: -100, endMs: -50 });
    transport.receive!({ type: "microphone.speech_stopped", quietMs: 900 });
    expect(transport.close).not.toHaveBeenCalled();
    providerEvents(event => transport.receive!(event)).acknowledgeSteering(command.event_id, 5000);
    expect(transport.close).not.toHaveBeenCalled();
  },
);

it.each(["help", "repeat"] as const)(
  "%s acknowledgment cannot discard a late same-visit Stop fragment",
  async request => {
    const { events, command } = await pendingSupport(request);
    transport.receive!({ type: "microphone.activity_started" });
    transport.receive!({ type: "transcript", speaker: "child", delta: "St", startMs: 100, endMs: 150 });
    transport.receive!({ type: "microphone.speech_stopped", quietMs: 900 });
    expect(transport.close).not.toHaveBeenCalled();
    events.acknowledgeSteering(command.event_id, 5000);
    transport.receive!({ type: "transcript", speaker: "child", delta: "op.", startMs: 150, endMs: 200 });
    expect(transport.close).toHaveBeenCalledOnce();
  },
);

it.each(["help", "repeat"] as const)("%s retains the already-confirmed visit's transcript floor", async request => {
  const { events } = await pendingSupport(request, 500);
  events.childTurn("Stop.", 100);
  expect(transport.close).not.toHaveBeenCalled();
  events.childTurn("Stop.", 600);
  expect(transport.close).toHaveBeenCalledOnce();
});
