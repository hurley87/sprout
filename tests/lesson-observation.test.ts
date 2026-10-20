import { afterEach, expect, it, vi } from "vitest";
import type { Page } from "@playwright/test";
import type { MicrophoneDiagnostic, PlaybackDiagnostic } from "../lib/browser-transport";
import type { ProviderEvent } from "../lib/events";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import { COUNTING_LESSON } from "../lib/lesson-runtime/counting-lesson";
import { attachLessonObservation, type LessonObservationWindow } from "../lib/lesson-runtime/browser-observation";
import { LessonObserver } from "./helpers/lesson-observer";

const transport = vi.hoisted(() => ({
  playback: undefined as ((event: PlaybackDiagnostic) => void) | undefined,
  diagnostic: undefined as ((event: MicrophoneDiagnostic) => void) | undefined,
  receive: undefined as ((event: ProviderEvent) => void) | undefined,
}));
vi.mock("../lib/browser-transport", () => ({
  BrowserTransport: class {
    activeSourceId = 1;
    setPlaybackDiagnosticSink(sink: (event: PlaybackDiagnostic) => void) {
      transport.playback = sink;
    }
    setMicrophoneDiagnosticSink(sink: (event: MicrophoneDiagnostic) => void) {
      transport.diagnostic = sink;
    }
    async start(receive: (event: ProviderEvent) => void) {
      transport.receive = receive;
      receive({ type: "session.started", sourceId: 1 });
    }
    openInput() {
      return true;
    }
    send() {}
    close() {}
  },
}));
const runtimes: LessonRuntime[] = [];
function runtime(changed = vi.fn()) {
  const lesson = new LessonRuntime({} as HTMLAudioElement, changed, COUNTING_LESSON);
  runtimes.push(lesson);
  return lesson;
}
afterEach(() => {
  runtimes.splice(0).forEach(lesson => lesson.stop());
  vi.restoreAllMocks();
});

it("captures every unpublished measurement beyond the UI limit, in order, with gap-free cursors", () => {
  const changed = vi.fn();
  const lesson = runtime(changed);
  const initial = lesson.observe();
  for (let index = 0; index < 150; index++) {
    transport.diagnostic?.({
      type: "microphone.detector_window",
      detail: {
        frames: index,
        rmsMin: 0,
        rmsMean: 0.01,
        rmsMax: 0.02,
        threshold: 0.01,
        noiseFloor: 0,
        aboveThresholdFrames: 0,
        candidate: false,
        confirmed: false,
        quietMs: 0,
        quietResets: 0,
        longestResetQuietMs: 0,
        maxFrameGapMs: 0,
        frameGapsOver100Ms: 0,
        audioContextState: "running",
      },
    });
  }
  expect(changed).not.toHaveBeenCalled();
  const batch = lesson.observe(initial.cursor);
  expect(batch.events).toHaveLength(150);
  expect(batch.events.map(event => (event.detail as { frames: number }).frames)).toEqual(
    Array.from({ length: 150 }, (_, index) => index),
  );
  expect(batch.snapshot.diagnostics).toHaveLength(100);
  expect(batch.cursor.offset).toBe(151);
  expect(lesson.observe(batch.cursor).events).toEqual([]);
  expect(lesson.observe().events).toEqual(lesson.report().events);
  lesson.stop();
  const ended = lesson.observe().cursor;
  transport.diagnostic?.({
    type: "microphone.detector_unavailable",
    detail: { reason: "web_audio_initialization_failed" },
  });
  expect(lesson.observe(ended).events).toEqual([]);
  for (const offset of [-1, 9999, 1.5, NaN]) {
    expect(() => lesson.observe({ ...initial.cursor, offset })).toThrow(/cursor/);
  }
  expect(() => runtime().observe(initial.cursor)).toThrow(/cursor/);
});

it("detaches snapshot, event, display, state and report payloads from runtime authority", () => {
  const lesson = runtime();
  lesson.confirmRendered(lesson.snapshot().display);
  const host: LessonObservationWindow = { __SPROUT_OBSERVE_LESSON__: true };
  const detach = attachLessonObservation(host, () => lesson);
  const bridge = host.sproutLessonObservation!;
  expect(Object.keys(bridge)).toEqual(["read", "report"]);
  expect(Object.isFrozen(bridge)).toBe(true);
  expect(Object.getOwnPropertyDescriptor(host, "sproutLessonObservation")?.writable).toBe(false);
  const observed = bridge.read()!;
  const before = structuredClone(lesson.report());
  Reflect.set(observed.snapshot.runtime!, "nodeId", "count-3-butterflies");
  Reflect.set(observed.snapshot.display, "token", "injected");
  (observed.events[0].detail as { timing: { clockTickMs: number } }).timing.clockTickMs = 0;
  const report = bridge.report()!;
  Reflect.set(report.runtime!, "visitId", 999);
  report.events[0].type = "forged";
  Reflect.set(report.timing, "clockTickMs", 0);
  expect(lesson.report()).toEqual(before);
  expect(lesson.snapshot().display.token).not.toBe("injected");
  detach();
});

it("is disabled by default and cleans up idempotently, invalidating retained facades on detach", () => {
  const host: LessonObservationWindow = {};
  let current: LessonRuntime | null = null;
  attachLessonObservation(host, () => current)();
  expect(host.sproutLessonObservation).toBeUndefined();
  host.__SPROUT_OBSERVE_LESSON__ = true;
  const detach = attachLessonObservation(host, () => current);
  const bridge = host.sproutLessonObservation!;
  expect(bridge.read()).toBeNull();
  current = runtime();
  const first = bridge.read()!;
  current.stop("restarted");
  expect(bridge.read(first.cursor)!.events.at(-1)?.type).toBe("lesson.ended");
  current = runtime();
  expect(() => bridge.read(first.cursor)).toThrow(/cursor/);
  expect(bridge.read()!.snapshot.status).toBe("prepared");
  detach();
  detach();
  expect(host.sproutLessonObservation).toBeUndefined();
  expect(bridge.read()).toBeNull();
  expect(bridge.report()).toBeNull();
  const detachAgain = attachLessonObservation(host, () => current);
  detach(); // Old cleanup cannot remove a newly attached facade.
  expect(host.sproutLessonObservation?.read()).not.toBeNull();
  detachAgain();
});

it("scopes helper waits by cursor, runtime, visit, turn, node and revision without consuming later events", async () => {
  const lesson = runtime();
  const observer = new LessonObserver({} as Page);
  vi.spyOn(observer, "read").mockImplementation(async after => lesson.observe(after));
  const after = await observer.cursor();
  lesson.confirmRendered(lesson.snapshot().display);
  const event = lesson.observe().events.find(event => event.type === "runtime.created")!;
  const scope = {
    runtimeId: event.runtimeId,
    visitId: event.visitId,
    childTurnId: event.childTurnId,
    nodeId: event.nodeId,
    transcriptRevision: event.transcriptRevision,
  };
  const match = await observer.waitForEvent("runtime.created", { after, scope });
  expect(match.event).toEqual(event);
  expect(match.cursor.offset).toBe(3);
  const render = await observer.waitForEvent("render.confirmed", {
    after,
    scope,
    detail: { identity: { token: lesson.snapshot().display.token } },
  });
  expect(render.event.detail).toMatchObject({ identity: lesson.snapshot().display });
  await expect(
    observer.waitForEvent("render.confirmed", {
      after,
      scope,
      detail: { identity: { token: "previous-render" } },
      timeoutMs: 0,
    }),
  ).rejects.toThrow(/Timed out/);
  const started = await observer.waitForEvent("session.started", { after: match.cursor, scope });
  expect(started.cursor.offset).toBeGreaterThan(match.cursor.offset);
  for (const mismatch of [{ visitId: 2 }, { childTurnId: 99 }, { nodeId: "other" }, { transcriptRevision: 99 }]) {
    await expect(
      observer.waitForEvent("runtime.created", { after, scope: { ...scope, ...mismatch }, timeoutMs: 0 }),
    ).rejects.toThrow(/Timed out/);
  }
  await expect(observer.waitForEvent("runtime.created", { after: match.cursor, scope, timeoutMs: 0 })).rejects.toThrow(
    /Timed out/,
  );
  await expect(observer.waitForEvent("runtime.created", { after, scope: { runtimeId: "other" } })).rejects.toThrow(
    /differ/,
  );
  vi.spyOn(observer, "read").mockImplementation(async cursor => runtime().observe(cursor));
  await expect(observer.waitForEvent("lesson.ended", { after, scope })).rejects.toThrow(/cursor/);
});

it("cannot reuse an earlier quiet output event for a new tutor-output wait", async () => {
  const lesson = runtime();
  lesson.confirmRendered(lesson.snapshot().display);
  const observer = new LessonObserver({} as Page);
  vi.spyOn(observer, "read").mockImplementation(async after => lesson.observe(after));
  const scope = { runtimeId: lesson.observe().cursor.runtimeId, visitId: 1, nodeId: "count-1-duck" };
  transport.receive?.({ type: "output.activity", state: "quiet" });
  const after = await observer.cursor();
  transport.receive?.({ type: "output.activity", state: "active" });
  const active = await observer.waitForEvent("output.activity", { after, scope, detail: { state: "active" } });
  await expect(
    observer.waitForEvent("output.activity", {
      after: active.cursor,
      scope,
      detail: { state: "quiet" },
      timeoutMs: 0,
    }),
  ).rejects.toThrow(/Timed out/);
  transport.receive?.({ type: "output.activity", state: "quiet" });
  transport.receive?.({ type: "output.activity", state: "unavailable" });
  const quiet = await observer.waitForEvent("output.activity", {
    after: active.cursor,
    scope,
    detail: { state: "quiet" },
  });
  const unavailable = await observer.waitForEvent("output.activity", {
    after: quiet.cursor,
    scope,
    detail: { state: "unavailable" },
  });
  expect(unavailable.cursor.offset).toBeGreaterThan(quiet.cursor.offset);
  expect(lesson.observe().snapshot.runtime?.outputActivity).toBe("unavailable");
});

it("samples the attempt performance clock without changing the production report", () => {
  let browserNow = 100_000;
  vi.spyOn(performance, "now").mockImplementation(() => browserNow);
  const lesson = runtime();
  expect(lesson.report().events[0].atMs).toBe(0);
  browserNow += 25;
  lesson.confirmRendered(lesson.snapshot().display);
  const report = structuredClone(lesson.report());
  browserNow += 10;
  expect(lesson.observe().nowMs).toBe(35);
  expect(lesson.report()).toEqual(report);
  expect(report.events.find(event => event.type === "render.confirmed")?.atMs).toBe(25);
});

it("journals playback independently, preserves its attachment origin, and clones delivery exports", async () => {
  const lesson = runtime();
  lesson.confirmRendered(lesson.snapshot().display);
  await Promise.resolve();
  const before = lesson.observe();
  const requests = vi.fn();
  vi.stubGlobal("fetch", requests);
  const playback = (playbackFact: PlaybackDiagnostic["playbackFact"], sourceId = 1, attachmentGeneration = 9) =>
    transport.playback?.({ sourceId, attachmentGeneration, playbackFact });
  playback("play_requested");
  const original = lesson.observe().snapshot.runtime!;
  transport.receive?.({ type: "output.activity", sourceId: 1, state: "active" });
  transport.receive?.({ type: "output.activity", sourceId: 1, state: "quiet" });
  transport.receive?.({ type: "output.activity", sourceId: 1, state: "unavailable" });
  transport.receive?.({ type: "microphone.speech_started" });
  expect(lesson.snapshot().runtime!.childTurnId).not.toBe(original.childTurnId);
  const afterPcm = lesson.observe().cursor;
  transport.receive?.({ type: "output.activity", sourceId: 999, state: "quiet" });
  playback("play_resolved");
  playback("playing");
  playback("waiting");
  playback("paused");
  playback("ended");
  playback("playing", 999);
  playback("playing", 1, 8);
  const observations = lesson.observe(afterPcm).events;
  expect(observations).toHaveLength(5);
  expect(observations.every(event => event.type === "tracking.delivery")).toBe(true);
  expect(observations[0].detail).toMatchObject({
    origin: { source: { childTurnId: original.childTurnId, transcriptRevision: original.transcriptRevision } },
    responseId: null,
    responseComplete: "unknown",
    speechHeard: "unknown",
    feedback: null,
    correlation: null,
    pcm: null,
  });
  expect(requests).not.toHaveBeenCalled();
  const pcm = lesson
    .observe(before.cursor)
    .events.filter(event => event.type === "tracking.delivery" && (event.detail as { pcm: unknown }).pcm !== null);
  expect(pcm.map(event => (event.detail as { pcm: unknown }).pcm)).toEqual(["active", "quiet", "unavailable"]);
  expect(pcm[1].detail).toMatchObject({
    playbackFact: null,
    attachmentGeneration: null,
    outputGate: { outputActivity: "active" },
    responseComplete: "unknown",
  });
  const exported = lesson.report();
  const delivery = exported.events.find(event => event.type === "tracking.delivery")!;
  Reflect.set(delivery.detail as object, "speechHeard", "forged");
  Reflect.set(observations[0].detail as object, "responseId", "forged");
  expect(lesson.report().events.find(event => event.type === "tracking.delivery")!.detail).toMatchObject({
    speechHeard: "unknown",
    responseId: null,
  });
  lesson.stop();
  const ended = lesson.observe().cursor;
  playback("teardown");
  expect(lesson.observe(ended).events).toHaveLength(1);
  expect(lesson.observe(ended).events[0]).toMatchObject({
    type: "tracking.delivery",
    detail: { playbackFact: "teardown", origin: { source: { childTurnId: original.childTurnId } } },
  });
  const tornDown = lesson.observe().cursor;
  playback("playing");
  expect(lesson.observe(tornDown).events).toEqual([]);
  vi.unstubAllGlobals();
});
