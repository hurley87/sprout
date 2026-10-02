import { afterEach, expect, it, vi } from "vitest";
import {
  FinitePlayback,
  OUTPUT_DRAIN_TIMEOUT_MS,
  PLAYBACK_TIMEOUT_MS,
  type PlaybackRequest,
} from "../lib/local-playback";
import { parseProviderEvent, type LocalPlaybackEvent } from "../lib/events";

// These are focused callback/token tests of the production helper. Trusted
// events are simulated here; actual trusted HTML events and PCM are browser-tested.
class Surface extends EventTarget {
  callbacks = new Map<string, ((event: Event) => void)[]>();
  override addEventListener(
    name: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ) {
    if (typeof callback === "function") this.callbacks.set(name, [...(this.callbacks.get(name) ?? []), callback]);
    super.addEventListener(name, callback, options);
  }
  fire(name: string, trusted = true) {
    for (const callback of this.callbacks.get(name) ?? []) callback({ isTrusted: trusted } as Event);
  }
}
class AudioStub extends Surface {
  src = "";
  srcObject = null;
  currentTime = 0;
  duration = 0.9;
  muted = false;
  volume = 1;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  loop = false;
  seeking = false;
  error = null;
  paused = true;
  ended = false;
  sinkId = "";
  play = vi.fn(async () => {
    this.paused = false;
    this.fire("playing");
  });
  pause = vi.fn(() => {
    this.paused = true;
    this.fire("pause");
  });
  removeAttribute = vi.fn(() => {
    this.src = "";
  });
  load = vi.fn();
}
const request = (): PlaybackRequest => ({
  identity: {
    sessionAttemptId: "session",
    originSourceId: 1,
    owningSourceId: 1,
    evaluatedSceneIndex: 0,
    transcriptRevision: 1,
    answerVersion: "one:1",
    correlationKey: "eval:1",
    responseIdentity: {
      provenance: "application_evaluation",
      fragmentKeys: ["fragment:1"],
      sourceStatus: "known",
      evaluatedScene: { sceneId: "one-duck", displayedAtMs: 10 },
    },
    choreographyEpoch: 1,
    playbackAttemptId: "ack:1",
  },
  asset: { id: "fixture", sha256: "0".repeat(64), url: "/test.wav", mimeType: "audio/wav" },
});
function fixture(onEvent?: (event: LocalPlaybackEvent) => void) {
  vi.useFakeTimers();
  vi.stubGlobal("performance", { now: () => 10_000 });
  let nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const audio = new AudioStub();
  vi.stubGlobal(
    "Audio",
    class {
      constructor() {
        return audio;
      }
    },
  );
  const track = new Surface();
  const mix = { stream: { getAudioTracks: () => [track] } };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  const context = Object.assign(new Surface(), {
    state: "running",
    currentTime: 2,
    baseLatency: 0.01,
    outputLatency: 0.02,
    sinkId: "",
    destination: {},
    createMediaElementSource: vi.fn(() => source),
    createGain: vi.fn(() => gain),
    decodeAudioData: vi.fn(async () => ({ duration: 0.9 })),
    getOutputTimestamp: vi.fn(() => ({ contextTime: 1.9, performanceTime: 100 })),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(100) })),
  );
  vi.stubGlobal("crypto", { subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) } });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:private");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const events: LocalPlaybackEvent[] = [];
  let healthy = true;
  const input = request();
  const playback = new FinitePlayback(
    input,
    context as unknown as AudioContext,
    mix as unknown as MediaStreamAudioDestinationNode,
    () => healthy,
    event => {
      events.push(event);
      onEvent?.(event);
    },
  );
  const frame = () => {
    const current = [...frames.values()];
    frames.clear();
    current.forEach(callback => callback(100));
  };
  const end = () => {
    audio.currentTime = audio.duration;
    audio.ended = true;
    audio.paused = true;
    audio.fire("pause");
    audio.fire("ended");
  };
  const start = async () => {
    playback.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(playback.state).toBe("started");
  };
  return {
    playback,
    events,
    audio,
    context,
    source,
    gain,
    track,
    input,
    frame,
    end,
    start,
    unhealthy: () => {
      healthy = false;
    },
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("requires natural end and two advancing output observations beyond the latched render fence", async () => {
  const f = fixture();
  await f.start();
  f.frame();
  expect(f.events.some(event => event.state === "completed")).toBe(false);
  f.audio.fire("ended", false);
  expect(f.playback.state).toBe("started");
  f.end();
  expect(f.playback.state).toBe("media_ended");
  f.frame();
  expect(f.playback.state).toBe("media_ended");
  f.context.currentTime = 2.2;
  f.context.getOutputTimestamp.mockReturnValue({ contextTime: 2.1, performanceTime: 120 });
  f.frame();
  expect((await f.playback.result).state).toBe("completed");
  f.audio.fire("ended");
  f.end();
  f.playback.cancel();
  f.frame();
  expect(f.events.map(event => event.state)).toEqual(["requested", "ready", "started", "media_ended", "completed"]);
  expect(f.source.disconnect).toHaveBeenCalledOnce();
  expect(f.gain.gain.value).toBe(0);
});

it("freezes the originating answer, response fragments, scene, epoch and asset independently of caller mutation", async () => {
  const f = fixture();
  f.input.identity.responseIdentity.fragmentKeys.push("late");
  f.input.identity.choreographyEpoch = 9;
  f.input.asset.id = "other";
  await f.start();
  expect(f.events[0].identity.responseIdentity.fragmentKeys).toEqual(["fragment:1"]);
  expect(f.events[0].identity.choreographyEpoch).toBe(1);
  expect(f.events[0].assetId).toBe("fixture");
  expect(Object.isFrozen(f.events[0].identity.responseIdentity.evaluatedScene)).toBe(true);
  f.playback.cancel();
});

it("invalidates before teardown and retained/duplicate callbacks cannot revive cancellation", async () => {
  const f = fixture();
  await f.start();
  f.playback.cancel("superseded");
  f.audio.fire("playing");
  f.end();
  f.frame();
  f.playback.cancel("failed");
  expect((await f.playback.result).state).toBe("superseded");
  expect(f.events.filter(event => ["superseded", "completed", "failed"].includes(event.state))).toHaveLength(1);
  expect(f.gain.gain.value).toBe(0);
});

it("untyped cancellation cannot mint completion", async () => {
  const f = fixture();
  await f.start();
  // @ts-expect-error completed is deliberately excluded from cancellation.
  f.playback.cancel("completed");
  expect(await f.playback.result).toMatchObject({ state: "failed", reason: "invalid_cancellation_state" });
  f.end();
  f.frame();
  expect(f.events.some(event => event.state === "completed")).toBe(false);
});

it.each(["zero", "stalled", "unavailable", "throws", "regressed"])("%s output timestamps fail closed", async mode => {
  const f = fixture();
  await f.start();
  f.end();
  if (mode === "zero") f.context.getOutputTimestamp.mockReturnValue({ contextTime: 0, performanceTime: 0 });
  if (mode === "unavailable") Object.assign(f.context, { getOutputTimestamp: undefined });
  if (mode === "throws")
    f.context.getOutputTimestamp.mockImplementation(() => {
      throw new Error("clock unavailable");
    });
  f.frame();
  if (mode === "regressed") {
    f.context.getOutputTimestamp.mockReturnValue({ contextTime: 1.8, performanceTime: 90 });
    f.frame();
  }
  await vi.advanceTimersByTimeAsync(OUTPUT_DRAIN_TIMEOUT_MS);
  expect((await f.playback.result).state).toBe("failed");
  expect(f.events.some(event => event.state === "completed")).toBe(false);
});

it.each(["owner", "suspend", "sink", "gain", "mute", "pause", "seek", "loop", "rate", "resource", "track"])(
  "%s loss during drain prevents success",
  async mode => {
    const f = fixture();
    await f.start();
    f.end();
    if (mode === "owner") f.unhealthy();
    if (mode === "suspend") {
      f.context.state = "suspended";
      f.context.fire("statechange");
    }
    if (mode === "sink") f.context.sinkId = "changed";
    if (mode === "gain") f.gain.gain.value = 0;
    if (mode === "mute") f.audio.muted = true;
    if (mode === "pause") {
      f.audio.ended = false;
      f.audio.fire("pause");
    }
    if (mode === "seek") f.audio.seeking = true;
    if (mode === "loop") f.audio.loop = true;
    if (mode === "rate") f.audio.playbackRate = 2;
    if (mode === "resource") f.audio.src = "different";
    if (mode === "track") f.track.fire("ended");
    f.context.currentTime = 3;
    f.context.getOutputTimestamp.mockReturnValue({ contextTime: 2.9, performanceTime: 130 });
    f.frame();
    expect((await f.playback.result).state).toBe("failed");
  },
);

it("a hanging fetch times out, aborts and ignores late resource readiness", async () => {
  const f = fixture();
  let resolve!: (value: unknown) => void;
  let signal!: AbortSignal;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url, options) => {
      signal = options.signal;
      return new Promise(done => {
        resolve = done;
      });
    }),
  );
  f.playback.start();
  await vi.advanceTimersByTimeAsync(PLAYBACK_TIMEOUT_MS);
  expect(await f.playback.result).toMatchObject({ state: "failed", reason: "playback_timeout" });
  expect(signal.aborted).toBe(true);
  resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(100) });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.context.decodeAudioData).not.toHaveBeenCalled();
  expect(f.events.map(event => event.state)).toEqual(["requested", "failed"]);
});

it("a delayed decode loses ownership without creating a media graph", async () => {
  const f = fixture();
  let resolve!: (value: { duration: number }) => void;
  f.context.decodeAudioData.mockImplementation(
    () =>
      new Promise(done => {
        resolve = done;
      }),
  );
  f.playback.start();
  await vi.advanceTimersByTimeAsync(0);
  f.playback.cancel("source_retired");
  resolve({ duration: 0.9 });
  await vi.advanceTimersByTimeAsync(0);
  expect((await f.playback.result).state).toBe("source_retired");
  expect(f.context.createMediaElementSource).not.toHaveBeenCalled();
});

it("cancellation during a lifecycle callback stops subsequent async work", async () => {
  const f = fixture(event => {
    if (event.state === "ready") cancel();
  });
  const cancel = () => f.playback.cancel("stopped");
  f.playback.start();
  await vi.advanceTimersByTimeAsync(0);
  expect((await f.playback.result).state).toBe("stopped");
  expect(f.audio.play).not.toHaveBeenCalled();
});

it("raw provider JSON cannot manufacture any local playback state", () => {
  for (const state of [
    "requested",
    "ready",
    "started",
    "media_ended",
    "completed",
    "interrupted",
    "superseded",
    "stopped",
    "source_retired",
    "failed",
  ])
    expect(parseProviderEvent({ type: "local.playback", state, identity: request().identity, sourceId: 1 })).toBeNull();
});

it("early ready/failure observations omit unknown nonfinite timing instead of serializing null", async () => {
  const f = fixture();
  f.audio.duration = NaN;
  f.context.baseLatency = NaN;
  f.context.outputLatency = Infinity;
  await f.start();
  f.playback.cancel("failed");
  const ready = f.events.find(event => event.state === "ready")!;
  expect(ready).toHaveProperty("mediaTime", 0);
  expect(ready).not.toHaveProperty("duration");
  expect(ready).not.toHaveProperty("baseLatency");
  expect(ready).not.toHaveProperty("outputLatency");
  for (const event of f.events) {
    expect(JSON.parse(JSON.stringify(event))).toEqual(event);
    for (const value of Object.values(event)) if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
  }
});
