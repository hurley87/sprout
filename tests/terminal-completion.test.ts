import { afterEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { CATCHING_UNICORNS_LESSON as lesson } from "../lib/lesson-runtime/catching-unicorns-lesson";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import { ANSWER_RECOVERY_WAIT_MS } from "../lib/lesson-runtime/answer-recovery";
import {
  createLessonRuntime,
  reduceLessonRuntime,
  runtimeSource,
  type LessonRuntimeEvent,
} from "../lib/lesson-runtime/lesson-runtime-reducer";
import { providerEvents, useRuntimeFakeTimers as fakeRuntimeTimers } from "./helpers/runtime-harness";
import replay from "./fixtures/catching-unicorns-terminal-completion-replay.json";

const transport = vi.hoisted(() => ({
  receive: undefined as ((event: ProviderEvent) => void) | undefined,
  send: vi.fn<(command: ClientCommand) => void>(),
  close: vi.fn(),
}));
vi.mock("../lib/browser-transport", async () => {
  const { mockBrowserTransport } = await import("./helpers/runtime-harness");
  return { BrowserTransport: mockBrowserTransport(transport) };
});
const emit = (event: ProviderEvent) => transport.receive!(event);
const events = providerEvents(emit);
const terminalLesson = { ...lesson, initialNodeId: "recap" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});

function startTerminal() {
  fakeRuntimeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({}, { status: 503 })),
  );
  const runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, terminalLesson);
  runtime.confirmRendered(runtime.snapshot().display);
  const command = transport.send.mock.calls.at(-1)![0];
  if (command.type !== "session.instructions.append") throw new Error("Expected recap steering");
  // Use the authored close actually sent, independently of recap content changes.
  const text: string = JSON.parse(command.content.split("Close: ")[1]);
  events.acknowledgeSteering(command.event_id, 1000);
  return { runtime, text };
}

function confirmCompletion(runtime: LessonRuntime) {
  expect(runtime.snapshot()).toMatchObject({
    status: "live",
    display: { nodeId: null, sceneId: null },
    runtime: { phase: "rendering", lessonComplete: true },
  });
  expect(transport.close).not.toHaveBeenCalled();
  // The existing UI confirms this committed completion screen.
  runtime.confirmRendered(runtime.snapshot().display);
  expect(runtime.snapshot()).toMatchObject({
    status: "ended",
    error: null,
    runtime: { phase: "complete", lessonComplete: true },
  });
  expect(transport.close).toHaveBeenCalledOnce();
  expect(transport.send.mock.calls.filter(([command]) => command.type === "session.close")).toHaveLength(1);
  expect(runtime.report().events.filter(event => event.type === "lesson.completed")).toHaveLength(1);
  expect(runtime.report().events.find(event => event.type === "lesson.ended")?.detail).toMatchObject({
    reason: "lesson_completed",
  });
}

it("waits for recap audio after the full transcript, then completes and closes automatically", async () => {
  const { runtime, text } = startTerminal();
  emit({ type: "output.activity", state: "active" });
  emit({ type: "transcript", speaker: "sprout", delta: text, startMs: 1100, endMs: 1200 });
  await vi.advanceTimersByTimeAsync(3000);
  expect(runtime.snapshot().runtime).toMatchObject({ phase: "active", terminalTranscriptComplete: true });
  expect(transport.close).not.toHaveBeenCalled();
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(900);
  // A further audio chunk cancels the existing drain boundary.
  emit({ type: "output.activity", state: "active" });
  await vi.advanceTimersByTimeAsync(2000);
  expect(runtime.snapshot().runtime?.phase).toBe("active");
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(1499);
  expect(runtime.snapshot().runtime?.phase).toBe("active");
  await vi.advanceTimersByTimeAsync(101);
  confirmCompletion(runtime);
});

it.each(["discarded", "confirmed"])(
  "retains recap evidence through %s microphone activity without learner text",
  async activity => {
    const { runtime, text } = startTerminal();
    events.tutorTurn(text, 1100);
    await vi.advanceTimersByTimeAsync(300);
    const quietSinceMs = runtime.snapshot().runtime!.quietSinceMs;
    emit({ type: "microphone.activity_started" });
    if (activity === "confirmed") emit({ type: "microphone.speech_started" });
    await vi.advanceTimersByTimeAsync(1500);
    expect(runtime.snapshot().runtime).toMatchObject({
      phase: "active",
      childSpeaking: true,
      terminalTranscriptComplete: true,
      quietSinceMs,
    });
    emit(
      activity === "discarded"
        ? { type: "microphone.activity_discarded" }
        : { type: "microphone.speech_stopped", quietMs: 900 },
    );
    if (activity === "confirmed") {
      expect(runtime.snapshot().runtime?.phase).toBe("active");
      await vi.advanceTimersByTimeAsync(ANSWER_RECOVERY_WAIT_MS);
    }
    confirmCompletion(runtime);
  },
);

it("accepts a delayed learner transcript after confirmed speech stops instead of completing", async () => {
  const { runtime, text } = startTerminal();
  events.tutorTurn(text, 1100);
  await vi.advanceTimersByTimeAsync(1000);
  emit({ type: "microphone.activity_started" });
  emit({ type: "microphone.speech_started" });
  await vi.advanceTimersByTimeAsync(1000);
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  expect(runtime.snapshot().runtime?.phase).toBe("active");
  await vi.advanceTimersByTimeAsync(ANSWER_RECOVERY_WAIT_MS - 1);
  emit({ type: "transcript", speaker: "child", delta: "Wait, I have a question.", startMs: 1300, endMs: 1500 });
  await vi.advanceTimersByTimeAsync(2000);
  expect(runtime.snapshot()).toMatchObject({
    status: "live",
    error: null,
    runtime: { phase: "active", hasChildTranscript: true, terminalTranscriptComplete: false },
  });
  expect(runtime.snapshot().transcript).toContain("Child: Wait, I have a question.");
  expect(transport.close).not.toHaveBeenCalled();
  runtime.stop();
});

it("bounds missing terminal transcripts using the existing quiet recovery window", async () => {
  const { runtime, text } = startTerminal();
  events.tutorTurn(text, 1100);
  emit({ type: "microphone.speech_started" });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(ANSWER_RECOVERY_WAIT_MS - 200);
  // Discarded noise must not silently resolve a confirmed utterance or restart
  // its missing-transcript recovery window.
  emit({ type: "microphone.activity_started" });
  await vi.advanceTimersByTimeAsync(100);
  emit({ type: "microphone.activity_discarded" });
  expect(runtime.snapshot().runtime?.phase).toBe("active");
  await vi.advanceTimersByTimeAsync(99);
  expect(runtime.snapshot().runtime?.phase).toBe("active");
  await vi.advanceTimersByTimeAsync(1);
  confirmCompletion(runtime);
  expect(transport.send.mock.calls.filter(([command]) => command.type === "session.instructions.append")).toHaveLength(
    1,
  );
});

it("waits for late audio during completion rendering without error or premature teardown", async () => {
  const { runtime, text } = startTerminal();
  events.tutorTurn(text, 1100);
  await vi.advanceTimersByTimeAsync(1600);
  const oldDisplay = runtime.snapshot().display;
  emit({ type: "output.activity", state: "active" });
  emit({ type: "output.activity", state: "active" });
  runtime.confirmRendered(oldDisplay);
  await vi.advanceTimersByTimeAsync(2000);
  expect(runtime.snapshot()).toMatchObject({
    status: "live",
    error: null,
    runtime: { phase: "rendering", outputActivity: "active" },
  });
  expect(transport.close).not.toHaveBeenCalled();
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(1000);
  emit({ type: "output.activity", state: "quiet" });
  runtime.confirmRendered(oldDisplay);
  expect(transport.close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(600);
  expect(runtime.snapshot().display.token).not.toBe(oldDisplay.token);
  runtime.confirmRendered(oldDisplay); // Stale UI callback cannot acknowledge the new drain.
  expect(transport.close).not.toHaveBeenCalled();
  confirmCompletion(runtime);
});

it("requires fresh observed audio after unavailable output during completion rendering", async () => {
  const { runtime, text } = startTerminal();
  events.tutorTurn(text, 1100);
  await vi.advanceTimersByTimeAsync(1600);
  const oldDisplay = runtime.snapshot().display;
  emit({ type: "output.activity", state: "unavailable" });
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(2000);
  runtime.confirmRendered(oldDisplay);
  expect(runtime.snapshot()).toMatchObject({ status: "live", error: null });
  expect(transport.close).not.toHaveBeenCalled();
  emit({ type: "output.activity", state: "active" });
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(1600);
  confirmCompletion(runtime);
});

it("can resolve missing text more than once in a recap without spending a prompt budget", async () => {
  const { runtime, text } = startTerminal();
  const split = Math.floor(text.length / 2);
  events.tutorTurn(text.slice(0, split), 1100);
  emit({ type: "microphone.speech_started" });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(ANSWER_RECOVERY_WAIT_MS);
  expect(runtime.snapshot().runtime).toMatchObject({ phase: "active", terminalLearnerPending: false });
  events.tutorTurn(text.slice(split), 1300);
  emit({ type: "microphone.speech_started" });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(ANSWER_RECOVERY_WAIT_MS);
  confirmCompletion(runtime);
});

it("restarts missing-text recovery on fresh confirmed speech and cancels it on Stop", async () => {
  const { runtime, text } = startTerminal();
  events.tutorTurn(text, 1100);
  emit({ type: "microphone.speech_started" });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(ANSWER_RECOVERY_WAIT_MS - 1);
  emit({ type: "microphone.speech_started" });
  await vi.advanceTimersByTimeAsync(1);
  expect(runtime.snapshot().runtime).toMatchObject({
    phase: "active",
    childSpeaking: true,
    terminalLearnerPending: true,
  });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(ANSWER_RECOVERY_WAIT_MS - 1);
  expect(runtime.snapshot().runtime?.phase).toBe("active");
  runtime.stop();
  await vi.advanceTimersByTimeAsync(ANSWER_RECOVERY_WAIT_MS + 1000);
  expect(runtime.snapshot()).toMatchObject({
    status: "ended",
    error: null,
    runtime: { phase: "stopped", lessonComplete: false },
  });
  expect(transport.close).toHaveBeenCalledOnce();
});

it.each(["partial", "full"])("honors a learner interruption during %s recap output", async portion => {
  const { runtime, text } = startTerminal();
  const split = Math.floor(text.length / 2);
  emit({ type: "output.activity", state: "active" });
  emit({
    type: "transcript",
    speaker: "sprout",
    delta: portion === "full" ? text : text.slice(0, split),
    startMs: 1100,
    endMs: 1200,
  });
  emit({ type: "microphone.activity_started" });
  emit({ type: "microphone.speech_started" });
  emit({ type: "transcript", speaker: "child", delta: "Wait, I have a question.", startMs: 1250, endMs: 1300 });
  emit({ type: "output.activity", state: "quiet" });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(2000);
  expect(runtime.snapshot().runtime).toMatchObject({
    phase: "active",
    lessonComplete: false,
    terminalTranscriptComplete: false,
  });
  expect(transport.close).not.toHaveBeenCalled();
  if (portion === "partial") {
    // Resuming the remaining recap still requires actual new audio to drain.
    emit({ type: "transcript", speaker: "sprout", delta: text.slice(split), startMs: 1400, endMs: 1500 });
    emit({ type: "output.activity", state: "active" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(runtime.snapshot().runtime?.phase).toBe("active");
    emit({ type: "output.activity", state: "quiet" });
    await vi.advanceTimersByTimeAsync(1600);
    confirmCompletion(runtime);
  } else runtime.stop();
});

it("does not lose recap audio first observed during a discarded microphone candidate", async () => {
  const { runtime, text } = startTerminal();
  emit({ type: "microphone.activity_started" });
  events.tutorTurn(text, 1100);
  await vi.advanceTimersByTimeAsync(1600);
  expect(runtime.snapshot().runtime?.phase).toBe("active");
  emit({ type: "microphone.activity_discarded" });
  confirmCompletion(runtime);
});

it("keeps the delivered terminal render committed despite late microphone and transcript events", async () => {
  const { runtime, text } = startTerminal();
  events.tutorTurn(text, 1100);
  await vi.advanceTimersByTimeAsync(1600);
  const display = runtime.snapshot().display;
  emit({ type: "microphone.activity_started" });
  emit({ type: "microphone.speech_started" });
  emit({ type: "transcript", speaker: "child", delta: "Thanks", startMs: 1400, endMs: 1500 });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  expect(runtime.snapshot().display).toEqual(display);
  confirmCompletion(runtime);
  await vi.advanceTimersByTimeAsync(0); // Settle assessment before comparing journals.
  const report = runtime.report();
  for (let i = 0; i < 2; i++) {
    events.tutorTurn(text, 1600);
    events.childTurn("Again", 1800);
    emit({ type: "output.activity", state: "unavailable" });
    runtime.confirmRendered(display);
    runtime.stop();
  }
  await vi.advanceTimersByTimeAsync(65_000);
  expect(runtime.report()).toEqual(report);
  expect(transport.close).toHaveBeenCalledOnce();
});

it("preserves manual Stop before completion and permits a fresh attempt", async () => {
  const { runtime, text } = startTerminal();
  events.tutorTurn(text, 1100);
  await vi.advanceTimersByTimeAsync(500);
  runtime.stop();
  events.tutorTurn(text, 1300);
  await vi.advanceTimersByTimeAsync(65_000);
  expect(runtime.snapshot()).toMatchObject({
    status: "ended",
    error: null,
    runtime: { phase: "stopped", lessonComplete: false },
  });
  expect(runtime.report().events.find(event => event.type === "lesson.ended")?.detail).toMatchObject({
    reason: "parent_stop",
  });
  expect(transport.close).toHaveBeenCalledOnce();
  const next = startTerminal();
  expect(next.runtime.report().runtimeId).not.toBe(runtime.report().runtimeId);
  expect(next.runtime.snapshot().runtime?.terminalTranscriptComplete).not.toBe(true);
  events.tutorTurn(next.text, 1100);
  await vi.advanceTimersByTimeAsync(1600);
  next.runtime.confirmRendered(next.runtime.snapshot().display);
  expect(next.runtime.snapshot()).toMatchObject({
    status: "ended",
    runtime: { phase: "complete", lessonComplete: true },
  });
  expect(transport.close).toHaveBeenCalledTimes(2);
});

it("replays the October 16 transcript/audio/microphone race and completes before parent Stop", () => {
  let state = createLessonRuntime("terminal-replay", { lesson: terminalLesson, atMs: 149000 });
  function send(event: Record<string, unknown>) {
    const result = reduceLessonRuntime(
      state,
      { ...event, source: runtimeSource(state) } as LessonRuntimeEvent,
      terminalLesson,
    );
    state = result.state;
    return result;
  }
  send({ type: "output.activity", state: "active", atMs: 149000 });
  let nextTick = 149050;
  let completedAt: number | undefined;
  for (const event of replay.events) {
    while (nextTick <= event.atMs) {
      send({ type: "clock.tick", atMs: nextTick });
      if (state.pendingRender) {
        completedAt = nextTick;
        const result = reduceLessonRuntime(
          state,
          {
            type: "render.confirmed",
            runtimeId: state.runtimeId,
            identity: state.pendingRender.identity,
            atMs: nextTick,
          },
          terminalLesson,
        );
        state = result.state;
        expect(result.effects.map(effect => effect.type)).toEqual(["lesson.completed"]);
      }
      nextTick += 50;
    }
    send(event);
  }
  expect(completedAt).toBe(152150);
  expect(state).toMatchObject({ phase: "complete", lessonComplete: true });
  const complete = state;
  expect(send({ type: "stop", runtimeId: state.runtimeId, atMs: 153713.1 }).effects).toEqual([]);
  expect(state).toBe(complete);
});

it("accepts an isolated opening restart but keeps audio drain and the frozen recap authoritative", async () => {
  const { runtime, text } = startTerminal();
  expect(runtime.snapshot().recapText).toBe(text);
  const opening = text.split(" ")[0];
  emit({ type: "transcript", speaker: "sprout", delta: opening, startMs: 1100, endMs: 1200 });
  emit({ type: "output.activity", state: "active" });
  emit({ type: "transcript", speaker: "sprout", delta: text, startMs: 1400, endMs: 1500 });
  await vi.advanceTimersByTimeAsync(2000);
  expect(runtime.snapshot().runtime?.terminalTranscriptComplete).toBe(true);
  expect(transport.close).not.toHaveBeenCalled();
  expect(runtime.snapshot().recapText).toBe(text);
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(1600);
  confirmCompletion(runtime);
  expect(runtime.snapshot().recapText).toBe(text);
});

it("cannot complete from a complete transcript without observed audio", async () => {
  const { runtime, text } = startTerminal();
  emit({ type: "transcript", speaker: "sprout", delta: text, startMs: 1100, endMs: 1200 });
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(2000);
  expect(runtime.snapshot().runtime).toMatchObject({
    phase: "active",
    terminalTranscriptComplete: true,
    tutorOutputObserved: false,
  });
  expect(transport.close).not.toHaveBeenCalled();
  runtime.stop("page_hidden");
  expect(runtime.snapshot().runtime?.lessonComplete).toBe(false);
});

it.each(["opening", "closing", "different"])(
  "holds an incomplete or different %s recap despite drained audio",
  async change => {
    const { runtime, text } = startTerminal();
    const altered =
      change === "opening"
        ? text.slice(text.indexOf(" ") + 1)
        : change === "closing"
          ? text.slice(0, text.lastIndexOf(" "))
          : text.replace("explained", "mastered").replace("Unresolved", "Mastered");
    events.tutorTurn(altered, 1100);
    await vi.advanceTimersByTimeAsync(2000);
    expect(runtime.snapshot().runtime).toMatchObject({
      phase: "active",
      terminalTranscriptComplete: false,
      lessonComplete: false,
    });
    runtime.stop();
    expect(runtime.report().events.filter(event => event.type === "lesson.completed")).toHaveLength(0);
  },
);

it("accepts a delayed complete transcript and duplicate interval only after audio has drained", async () => {
  const { runtime, text } = startTerminal();
  emit({ type: "output.activity", state: "active" });
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(2000);
  expect(runtime.snapshot().runtime?.phase).toBe("active");
  const split = text.indexOf(" ");
  const opening: ProviderEvent = {
    type: "transcript",
    speaker: "sprout",
    delta: text.slice(0, split),
    startMs: 1100,
    endMs: 1200,
  };
  emit(opening);
  emit(opening); // Same interval, even without a provider event ID.
  emit({ type: "transcript", speaker: "sprout", delta: text.slice(split), startMs: 1200, endMs: 1300 });
  expect(runtime.snapshot().runtime?.terminalTranscriptComplete).toBe(true);
  await vi.advanceTimersByTimeAsync(1600);
  confirmCompletion(runtime);
});
