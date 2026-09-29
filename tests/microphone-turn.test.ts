import { afterEach, describe, expect, it, vi } from "vitest";
import { MicrophoneTurnDetector } from "../lib/microphone-turn";

afterEach(() => vi.unstubAllGlobals());

function harness(diagnostics = false) {
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
  const measure = vi.fn();
  const detector = new MicrophoneTurnDetector({} as MediaStream, emit, diagnostics ? measure : undefined);
  return {
    frame: (at: number) => frame(at),
    quiet: () => (amplitude = 0),
    loud: () => (amplitude = 0.05),
    level: (value: number) => (amplitude = value),
    emit,
    measure,
    detector,
  };
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

  it("does not add short noise bursts across quiet frames to confirm speech", () => {
    const { frame, quiet, loud, emit, detector } = harness();
    frame(0);
    frame(20);
    quiet();
    frame(40);
    loud();
    frame(60);
    frame(80);
    quiet();
    frame(100);
    loud();
    frame(120);
    frame(140);
    expect(emit.mock.calls.map(([event]) => event.type)).toEqual(["microphone.activity_started"]);
    quiet();
    frame(160);
    frame(311);
    expect(emit.mock.calls.map(([event]) => event.type)).toEqual([
      "microphone.activity_started",
      "microphone.activity_discarded",
    ]);
    detector.close();
  });

  it("bounds unresolved alternating noise with the onset plus quiet thresholds", () => {
    const { frame, quiet, loud, emit, detector } = harness();
    frame(0);
    for (let at = 20; at <= 240; at += 20) {
      if (at % 40) quiet();
      else loud();
      frame(at);
    }
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

describe("opt-in microphone measurements", () => {
  it("emits no measurements by default and leaves control events identical", () => {
    const drive = (h: ReturnType<typeof harness>) => {
      for (const at of [0, 20, 40, 60, 80]) h.frame(at);
      h.quiet();
      for (const at of [100, 350, 600, 1010]) h.frame(at);
      h.loud();
      h.frame(1200);
    };
    const without = harness();
    drive(without);
    const controlEvents = without.emit.mock.calls;
    expect(controlEvents.map(([event]) => event.type)).toContain("microphone.speech_stopped");
    expect(without.measure).not.toHaveBeenCalled();
    without.detector.close();
    const withDiagnostics = harness(true);
    drive(withDiagnostics);
    expect(withDiagnostics.measure.mock.calls.length).toBeLessThanOrEqual(4);
    expect(withDiagnostics.emit.mock.calls).toEqual(controlEvents);
    withDiagnostics.detector.close();
  });

  it("summarizes threshold, quiet resets and frame gaps without per-frame emission", () => {
    const { frame, quiet, loud, measure, detector } = harness(true);
    for (const at of [0, 20, 40, 60, 80]) frame(at);
    quiet();
    frame(100);
    frame(180);
    loud();
    frame(200);
    quiet();
    frame(220);
    frame(500);
    expect(measure).toHaveBeenCalledOnce();
    expect(measure.mock.lastCall?.[0]).toMatchObject({
      frames: 10,
      rmsMin: 0,
      threshold: 0.015,
      noiseFloor: 0.003,
      aboveThresholdFrames: 6,
      confirmed: true,
      candidate: false,
      quietMs: 280,
      quietResets: 1,
      longestResetQuietMs: 100,
      maxFrameGapMs: 280,
      frameGapsOver100Ms: 1,
    });
    expect(measure.mock.lastCall?.[0].rmsMax).toBeCloseTo(0.05);
    detector.close();
    frame(800);
    expect(measure).toHaveBeenCalledOnce();
  });

  it("reports the calibrated floor and effective threshold in bounded windows", () => {
    const { frame, level, measure, detector } = harness(true);
    level(0.01);
    for (let at = 0; at <= 2000; at += 20) frame(at);
    expect(measure.mock.calls.length).toBeLessThanOrEqual(8);
    const last = measure.mock.lastCall?.[0];
    expect(last.rmsMean).toBeCloseTo(0.01);
    expect(last.noiseFloor).toBeGreaterThan(0.005);
    expect(last.threshold).toBeGreaterThan(0.015);
    detector.close();
  });
});
