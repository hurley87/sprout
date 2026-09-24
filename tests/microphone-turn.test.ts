import { afterEach, describe, expect, it, vi } from "vitest";
import { MicrophoneTurnDetector } from "../lib/microphone-turn";

afterEach(() => vi.unstubAllGlobals());

describe("microphone turn timing", () => {
  it("reports the measured quiet interval from the first quiet audio frame", () => {
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
    frame(0);
    expect(emit).toHaveBeenCalledWith({ type: "microphone.speech_started" });
    amplitude = 0;
    frame(100);
    frame(999);
    expect(emit).toHaveBeenCalledTimes(1);
    frame(1015);
    expect(emit).toHaveBeenLastCalledWith({ type: "microphone.speech_stopped", quietMs: 915 });
    detector.close();
  });
});
