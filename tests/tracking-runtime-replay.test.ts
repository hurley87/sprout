import { afterEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import type { PlaybackDiagnostic } from "../lib/browser-transport";
import { DiagnosticJournal } from "../lib/lesson-runtime/diagnostic-journal";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
// Preservation replay of the original confirmation-gated policy.
import { LEGACY_COUNTING_LESSON as COUNTING_LESSON } from "./helpers/counting-runtime";
import { useRuntimeFakeTimers as installRuntimeFakeTimers } from "./helpers/runtime-harness";
import {
  mapConversationObservation,
  type ConversationStateOutputs,
} from "../lib/lesson-runtime/conversation-observer-contract";
import trace from "./fixtures/butterfly-filler-confirmation.json";

const transport = vi.hoisted(() => ({
  enabled: true,
  receive: undefined as ((event: ProviderEvent) => void) | undefined,
  playback: undefined as ((event: PlaybackDiagnostic) => void) | undefined,
  send: vi.fn<(command: ClientCommand) => void>(),
  close: vi.fn(),
}));
vi.mock("../lib/browser-transport", async () => {
  const { mockBrowserTransport } = await import("./helpers/runtime-harness");
  return {
    BrowserTransport: class extends mockBrowserTransport(transport) {
      get playbackAttachmentGeneration() {
        return 1;
      }
      setPlaybackDiagnosticSink(sink: (event: PlaybackDiagnostic) => void) {
        if (transport.enabled) transport.playback = sink;
      }
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// Synthetic scheduling/media/classifier responses, except trace.incoming, whose
// sanitized saved ordering/intervals are replayed with deterministic local timers.
async function replay(enabled: boolean, scenario: string) {
  installRuntimeFakeTimers();
  vi.setSystemTime(new Date("2026-10-19T00:00:00Z"));
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000077");
  transport.enabled = enabled;
  transport.playback = undefined;
  transport.send.mockClear();
  transport.close.mockClear();
  if (!enabled) {
    vi.spyOn(DiagnosticJournal.prototype, "trackReduction").mockImplementation(() => {});
    vi.spyOn(DiagnosticJournal.prototype, "trackClassification").mockImplementation(() => {});
    vi.spyOn(DiagnosticJournal.prototype, "trackDelivery").mockImplementation(() => {});
  }
  const requests: unknown[] = [];
  const cancelled: number[] = [];
  const pending: (() => void)[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("/api/classify");
      const input = JSON.parse(init.body as string);
      const index = requests.length;
      requests.push({ atMs: performance.now(), input });
      init.signal!.addEventListener("abort", () => cancelled.push(index));
      if (scenario === "cancel") await new Promise<void>(resolve => pending.push(resolve));
      if (scenario === "recorded" && input.nodeId === "count-3-butterflies") {
        const mapping = trace.steps.find(step => "mapping" in step)!.mapping!;
        const decision = mapConversationObservation(
          { ...input, lesson: COUNTING_LESSON },
          mapping.outputs as ConversationStateOutputs,
        );
        return Response.json({
          proposal: decision.proposal,
          diagnostic: { ...mapping, transcriptRevision: input.transcriptRevision },
        });
      }
      const outcome = scenario === "incorrect" ? "incorrect" : scenario === "unsettled" ? "unclear" : "correct";
      // Unsettled is a null proposal; no unsupported proposal enum is manufactured.
      return Response.json({
        proposal:
          scenario === "unsettled"
            ? null
            : {
                nodeId: input.nodeId,
                transcriptRevision: input.transcriptRevision,
                childActivity: "unknown",
                answerOutcome: outcome,
                supportState: scenario === "help" ? "needs_help" : "none",
                tutorState: input.transcript.includes("Tutor:") ? "acknowledging" : "unknown",
              },
      });
    }),
  );
  const runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, COUNTING_LESSON);
  const emit = (event: ProviderEvent) => transport.receive!({ ...event, sourceId: 1 });
  const playback = (playbackFact: PlaybackDiagnostic["playbackFact"]) =>
    transport.playback?.({
      sourceId: 1,
      attachmentGeneration: 1,
      playbackFact,
    });
  function confirm() {
    runtime.confirmRendered(runtime.snapshot().display);
    const command = transport.send.mock.calls.at(-1)![0];
    emit({
      type: "context.appended",
      name: "session.instructions.appended",
      clientEventId: command.event_id,
      startMs: 0,
    });
  }
  function child(delta: string, startMs: number) {
    emit({ type: "microphone.activity_started" });
    emit({ type: "transcript", speaker: "child", delta, startMs, endMs: startMs + 100 });
    emit({ type: "microphone.speech_stopped", quietMs: 900 });
  }
  function tutor(delta: string, startMs: number) {
    emit({ type: "transcript", speaker: "sprout", delta, startMs, endMs: startMs + 100 });
    emit({ type: "output.activity", state: "active" });
    emit({ type: "output.activity", state: "quiet" });
  }
  confirm();
  playback("play_requested");
  playback(scenario === "blocked" ? "play_rejected" : "play_resolved");
  emit({ type: "output.activity", state: "quiet" });
  if (scenario === "recorded") {
    for (const [index, answer] of ["One.", "Two."].entries()) {
      child(answer, 100 + index * 1000);
      tutor(`Yes, ${answer}`, 300 + index * 1000);
      await vi.advanceTimersByTimeAsync(600);
      expect(runtime.snapshot().runtime?.phase).toBe("rendering");
      confirm();
    }
    emit({
      type: "transcript",
      speaker: "sprout",
      delta: "How many butterflies do you see?",
      startMs: 26000,
      endMs: 27000,
    });
    emit({ type: "output.activity", state: "quiet" });
    for (const item of trace.incoming) {
      await vi.advanceTimersByTimeAsync(item.atMs - performance.now());
      emit(item.event as ProviderEvent);
    }
    await vi.advanceTimersByTimeAsync(900);
  } else {
    child("One.", 100);
    await vi.advanceTimersByTimeAsync(300);
    if (scenario === "cancel") {
      child("No, three.", 400);
      pending.splice(0).forEach(resolve => resolve());
      await vi.advanceTimersByTimeAsync(300);
      runtime.stop();
      pending.splice(0).forEach(resolve => resolve());
      await vi.advanceTimersByTimeAsync(0);
    } else {
      tutor("Yes, one duck!", 300);
      if (scenario === "unavailable" || scenario === "blocked") emit({ type: "output.activity", state: "unavailable" });
      await vi.advanceTimersByTimeAsync(600);
      const display = runtime.snapshot().display;
      runtime.confirmRendered({ ...display, token: "stale-token" });
      if (runtime.snapshot().runtime?.phase === "rendering") {
        expect(transport.send).toHaveBeenCalledTimes(1);
        confirm();
        runtime.confirmRendered(display); // Duplicate old callback cannot steer again.
      }
    }
  }
  const snapshot = runtime.snapshot();
  runtime.stop();
  playback("teardown");
  playback("playing"); // Ended runtime must ignore a late element callback.
  const report = runtime.report();
  const events = report.events;
  const tracking = events.filter(event => event.type.startsWith("tracking."));
  const result = {
    snapshot: { ...snapshot, evidenceEligibility: undefined, diagnostics: undefined },
    requests,
    cancelled,
    commands: structuredClone(transport.send.mock.calls),
    steering: structuredClone(
      transport.send.mock.calls.filter(([command]) => command.type === "session.instructions.append"),
    ),
    // Full baseline diagnostics include exact sources, payloads, states/effects,
    // render tokens, steering and scheduling timestamps; tracking offsets omitted.
    events: events.filter(event => !event.type.startsWith("tracking.")),
    closed: transport.close.mock.calls.length,
  };
  vi.restoreAllMocks();
  vi.useRealTimers();
  return { result, tracking };
}

it.each(["correct", "incorrect", "help", "unsettled", "unavailable", "blocked", "cancel", "recorded"])(
  "preserves ordered requests, cancellation, transitions and steering with tracking on/off: %s",
  async scenario => {
    const on = await replay(true, scenario);
    const off = await replay(false, scenario);
    expect(on.result).toEqual(off.result);
    expect(on.tracking.length).toBeGreaterThan(0);
    expect(off.tracking).toEqual([]);
    const started = on.result.events.filter(event => event.type === "classifier.started");
    expect(started).toHaveLength(on.result.requests.length);
    if (scenario === "correct") {
      expect(started).toHaveLength(2); // Child acceptance, then tutor-only revalidation.
      expect(started.map(event => event.atMs)).toEqual([300, 900]);
      expect(started.map(event => event.transcriptRevision)).toEqual([1, 2]);
      expect(on.result.steering).toHaveLength(2);
      expect(on.result.events.filter(event => event.type === "render.requested")).toHaveLength(1);
    }
    if (scenario === "recorded") {
      expect(started).toHaveLength(3);
      expect(started.at(-1)?.detail).toMatchObject({ transcript: trace.classifierInput.transcript });
      expect(on.result.steering).toHaveLength(3);
      expect(on.result.events.filter(event => event.type === "render.requested")).toHaveLength(2);
    }
    if (scenario === "cancel") expect(on.result.cancelled).toEqual([0, 1]);
    if (["incorrect", "help", "unsettled", "unavailable", "blocked"].includes(scenario))
      expect(on.result.steering).toHaveLength(1);
    const pcm = on.tracking.filter(
      event => event.type === "tracking.delivery" && (event.detail as { pcm: unknown }).pcm !== null,
    );
    expect(pcm.length).toBeGreaterThan(0);
    for (const event of pcm) expect(event.detail).toMatchObject({ attachmentGeneration: 1 });
    for (const event of on.tracking.filter(event => event.type === "tracking.delivery"))
      expect(event.detail).toMatchObject({ responseId: null, responseComplete: "unknown", speechHeard: "unknown" });
  },
);
