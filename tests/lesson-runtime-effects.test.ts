import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { GARDEN_RESCUE_LESSON } from "../lib/lesson-runtime/garden-rescue-lesson";
import { EFFECT_TAIL_MS, LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import { MICROPHONE_QUIET_MS } from "../lib/microphone-turn";
import { gardenRun } from "./helpers/garden-session";
import { useRuntimeFakeTimers } from "./helpers/runtime-harness";

const transport = vi.hoisted(() => ({
  receive: undefined as ((event: ProviderEvent) => void) | undefined,
  send: vi.fn<(command: ClientCommand) => void>(),
  close: vi.fn(),
  suspendInput: vi.fn(),
  resumeInput: vi.fn(),
}));
vi.mock("../lib/browser-transport", async () => {
  const { mockBrowserTransport } = await import("./helpers/runtime-harness");
  return { BrowserTransport: mockBrowserTransport(transport) };
});
let runtime: LessonRuntime;
const emit = (event: ProviderEvent) => transport.receive!(event);
beforeEach(() => useRuntimeFakeTimers());
afterEach(() => {
  runtime?.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("refuses unsafe windows and invalid durations", async () => {
  runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, GARDEN_RESCUE_LESSON);
  expect(runtime.beginEffect("test", 100)).toBe(false);
  const run = await gardenRun(transport);
  runtime = run.runtime;
  emit({ type: "output.activity", state: "active" });
  expect(runtime.beginEffect("test", 100)).toBe(false);
  emit({ type: "output.activity", state: "quiet" });
  emit({ type: "microphone.activity_started" });
  expect(runtime.beginEffect("test", 100)).toBe(false);
  emit({ type: "microphone.speech_started" });
  expect(runtime.beginEffect("test", 100)).toBe(false);
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  expect(runtime.beginEffect("test", 2001)).toBe(false);
  expect(runtime.beginEffect("test", 100)).toBe(true);
  expect(runtime.beginEffect("other", 100)).toBe(false);
  expect(runtime.report().events.filter(e => e.type === "effect.refused")).toHaveLength(5);
});

it("ignores microphone events until the tail ends and records overlap", async () => {
  const run = await gardenRun(transport);
  runtime = run.runtime;
  emit({ type: "output.activity", state: "quiet" });
  const abort = new AbortController();
  (runtime as unknown as { classification: unknown }).classification = {
    abort,
    source: {},
    speaker: "child",
  };
  expect(runtime.beginEffect("crunch", 500)).toBe(true);
  const before = runtime.report().events.length;
  emit({ type: "microphone.activity_started" });
  emit({ type: "microphone.speech_started" });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  emit({ type: "microphone.activity_discarded" });
  expect(runtime.snapshot().runtime?.childSpeaking).toBe(false);
  expect(abort.signal.aborted).toBe(false);
  const events = runtime.report().events.slice(before);
  expect(events.filter(e => e.type === "microphone.ignored_effect")).toHaveLength(4);
  expect(events.some(e => e.type.startsWith("child.") || e.type === "classifier.cancelled")).toBe(false);
  expect(transport.suspendInput).toHaveBeenCalledOnce();
  emit({ type: "output.activity", state: "active" });
  expect(runtime.report().events.some(e => e.type === "effect.overlapped_tutor")).toBe(true);
  expect(EFFECT_TAIL_MS).toBeGreaterThan(MICROPHONE_QUIET_MS);
  await vi.advanceTimersByTimeAsync(500 + EFFECT_TAIL_MS - 1);
  expect(transport.resumeInput).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(transport.resumeInput).toHaveBeenCalledOnce();
  emit({ type: "microphone.activity_started" });
  expect(runtime.snapshot().runtime?.childSpeaking).toBe(true);
  expect(runtime.report().events.map(e => e.type)).toEqual(expect.arrayContaining(["effect.started", "effect.ended"]));
});

it("allows an accepted answer to progress despite effect microphone activity", async () => {
  const run = await gardenRun(transport);
  runtime = run.runtime;
  await run.child("three");
  await run.tutor("Yes, three!", 0);
  expect(runtime.snapshot().runtime?.answerAccepted).toBe(true);
  expect(runtime.beginEffect("crunch", 500)).toBe(true);
  emit({ type: "microphone.activity_started" });
  emit({ type: "microphone.speech_started" });
  await run.advance();
  expect(runtime.snapshot().runtime?.visitId).toBe(2);
});

it("closes on stop without a later effect timer", async () => {
  const run = await gardenRun(transport);
  runtime = run.runtime;
  emit({ type: "output.activity", state: "quiet" });
  expect(runtime.beginEffect("test", 500)).toBe(true);
  runtime.stop();
  expect(transport.resumeInput).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(1000);
  expect(runtime.report().events.filter(e => e.type === "effect.ended")).toHaveLength(1);
});
