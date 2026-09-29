import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OutputActivityObserver } from "../lib/output-activity";
import { parseProviderEvent } from "../lib/events";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup() {
  let energy = 0;
  const track = { readyState: "live", muted: false };
  const stream = { getAudioTracks: () => [track] };
  const analyser = {
    fftSize: 0,
    connect: vi.fn(),
    disconnect: vi.fn(),
    getFloatTimeDomainData: vi.fn((samples: Float32Array) => samples.fill(energy)),
  };
  const source = { mediaStream: stream, connect: vi.fn(), disconnect: vi.fn() };
  const sink = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  const context = {
    state: "running",
    onstatechange: null as (() => void) | null,
    destination: {},
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    createMediaStreamSource: () => source,
    createAnalyser: () => analyser,
    createGain: () => sink,
  };
  vi.stubGlobal(
    "AudioContext",
    class {
      constructor() {
        return context;
      }
    },
  );
  const emit = vi.fn();
  const observer = new OutputActivityObserver(stream as unknown as MediaStream, emit);
  return {
    observer,
    emit,
    context,
    analyser,
    sink,
    source,
    track,
    energy: (value: number) => {
      energy = value;
    },
  };
}

it("observes decoded energy, including long pauses that resume, without a transcript clock", () => {
  const { observer, emit, energy, sink } = setup();
  expect(sink.gain.value).toBe(0);
  energy(0.1);
  vi.advanceTimersByTime(500);
  expect(emit.mock.calls).toEqual([[{ type: "output.activity", state: "active" }]]);
  energy(0);
  vi.advanceTimersByTime(5000);
  energy(0.1);
  vi.advanceTimersByTime(50);
  expect(emit.mock.calls.map(([event]) => event.state)).toEqual(["active", "quiet", "active"]);
  observer.close();
});

it("reports suspended, muted or ended input as unavailable, never quiet", () => {
  const { observer, context, emit, track } = setup();
  vi.advanceTimersByTime(50);
  context.state = "suspended";
  context.onstatechange?.();
  expect(emit).toHaveBeenLastCalledWith({ type: "output.activity", state: "unavailable" });
  context.state = "running";
  track.muted = true;
  vi.advanceTimersByTime(50);
  expect(emit).toHaveBeenCalledTimes(2);
  track.muted = false;
  vi.advanceTimersByTime(50);
  track.readyState = "ended";
  vi.advanceTimersByTime(50);
  expect(emit).toHaveBeenLastCalledWith({ type: "output.activity", state: "unavailable" });
  observer.close();
});

it("handles failed reads and ignores queued callbacks after idempotent cleanup", () => {
  const { observer, context, analyser, emit, source } = setup();
  analyser.getFloatTimeDomainData.mockImplementation(() => {
    throw new Error("lost source");
  });
  vi.advanceTimersByTime(50);
  expect(emit).toHaveBeenLastCalledWith({ type: "output.activity", state: "unavailable" });
  const late = context.onstatechange;
  observer.close();
  observer.close();
  late?.();
  vi.advanceTimersByTime(5000);
  expect(emit).toHaveBeenCalledOnce();
  expect(source.disconnect).toHaveBeenCalledOnce();
  expect(context.close).toHaveBeenCalledOnce();
});

it("does not let the provider fabricate a local media signal", () => {
  expect(parseProviderEvent({ type: "output.activity", state: "quiet" })).toBeNull();
});

it("releases partially initialized observation resources when setup fails", () => {
  const { observer, context, source, emit } = setup();
  observer.close();
  context.createAnalyser = () => {
    throw new Error("analyser unavailable");
  };
  expect(() => new OutputActivityObserver(source.mediaStream as unknown as MediaStream, emit)).toThrow(
    "analyser unavailable",
  );
  expect(context.close).toHaveBeenCalledTimes(2);
  expect(source.disconnect).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(500);
  expect(emit).not.toHaveBeenCalled();
});
