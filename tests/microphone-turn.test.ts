import { afterEach, describe, expect, it, vi } from "vitest";
import { MicrophoneTurnDetector } from "../lib/microphone-turn";

afterEach(() => vi.unstubAllGlobals());

function harness() {
  let frame!: FrameRequestCallback;
  let amplitude = 0.05;
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "AudioContext",
    class {
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: vi.fn() };
      }
      createAnalyser() {
        return {
          fftSize: 0,
          getFloatTimeDomainData: (samples: Float32Array) => samples.fill(amplitude),
          disconnect: vi.fn(),
        };
      }
      close() {
        return Promise.resolve();
      }
    },
  );
  const emit = vi.fn();
  const detector = new MicrophoneTurnDetector({} as MediaStream, emit);
  return { frame: (at: number) => frame(at), quiet: () => (amplitude = 0), emit, detector };
}

describe("microphone turn timing", () => {
  it("reports the measured quiet interval from the first quiet audio frame", () => {
    const { frame, quiet, emit, detector } = harness();
    frame(0);
    expect(emit).toHaveBeenCalledWith({ type: "microphone.activity_started" });
    for (const at of [20, 40, 60, 80]) frame(at);
    expect(emit).toHaveBeenCalledWith({ type: "microphone.speech_started" });
    quiet();
    frame(100);
    frame(999);
    expect(emit).toHaveBeenCalledTimes(2);
    frame(1015);
    expect(emit).toHaveBeenLastCalledWith({ type: "microphone.speech_stopped", quietMs: 915 });
    detector.close();
  });

  it("discards a single loud frame before confirming speech", () => {
    const { frame, quiet, emit, detector } = harness();
    frame(0);
    quiet();
    frame(20);
    frame(169);
    expect(emit).toHaveBeenCalledTimes(1);
    frame(171);
    expect(emit.mock.calls.map(([event]) => event.type)).toEqual([
      "microphone.activity_started",
      "microphone.activity_discarded",
    ]);
    detector.close();
  });

  it("confirms sustained speech when animation frames are slow", () => {
    const { frame, emit, detector } = harness();
    frame(0);
    frame(60);
    frame(120);
    expect(emit).toHaveBeenLastCalledWith({ type: "microphone.speech_started" });
    detector.close();
  });
});
