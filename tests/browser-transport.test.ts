import { afterEach, describe, expect, it, vi } from "vitest";
import { REPLACEMENT_TIMEOUT_MS, BrowserTransport, microphoneTrackSettings } from "../lib/browser-transport";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const seed = {
  sceneIndex: 2,
  evaluatedSceneIndex: 1,
  decision: "ADVANCE" as const,
  childUtterance: "Two",
  transcriptRevision: 1,
  answerVersion: "0:Two",
};

it("exports only useful microphone settings and excludes device identifiers", () => {
  const track = {
    getSettings: () => ({
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: true,
      sampleRate: 48000,
      channelCount: 1,
      latency: 0.02,
      deviceId: "private-device",
      groupId: "private-group",
    }),
  } as unknown as MediaStreamTrack;
  expect(microphoneTrackSettings(track)).toEqual({
    echoCancellation: true,
    noiseSuppression: false,
    autoGainControl: true,
    sampleRate: 48000,
    channelCount: 1,
    latency: 0.02,
  });
});

function audioElement() {
  const audio = {
    muted: false,
    autoplay: false,
    srcObject: null as MediaStream | null,
    play: vi.fn(async () => {}),
    pause: vi.fn(),
  };
  return audio;
}

function liveConnection(autoStarted = true) {
  const remoteTrack = { stop: vi.fn() } as unknown as MediaStreamTrack;
  const micTrack = { stop: vi.fn() } as unknown as MediaStreamTrack;
  class Stream {
    constructor(private tracks: MediaStreamTrack[]) {}
    getTracks() {
      return this.tracks;
    }
    getAudioTracks() {
      return this.tracks;
    }
  }
  const channel = {
    readyState: "open",
    onmessage: null as ((event: { data: string }) => void) | null,
    onerror: null,
    onclose: null,
    send: vi.fn(),
    close: vi.fn(),
  };
  const peer = {
    connectionState: "connected",
    iceGatheringState: "complete",
    localDescription: { sdp: "offer" },
    ontrack: null as ((event: { track: MediaStreamTrack }) => void) | null,
    onconnectionstatechange: null,
    addTrack: vi.fn(),
    createDataChannel: vi.fn(() => channel),
    createOffer: vi.fn(async () => ({ type: "offer", sdp: "offer" })),
    setLocalDescription: vi.fn(async () => {}),
    setRemoteDescription: vi.fn(async () => {
      if (autoStarted) channel.onmessage?.({ data: JSON.stringify({ type: "session.started" }) });
    }),
    close: vi.fn(),
  };
  vi.stubGlobal("MediaStream", Stream);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => new Stream([micTrack])) } });
  const Peer = class {
    constructor() {
      return peer;
    }
  };
  vi.stubGlobal("window", { RTCPeerConnection: Peer });
  vi.stubGlobal("RTCPeerConnection", Peer);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ transport: { sdp: "answer" } }) })),
  );
  return { channel, peer, remoteTrack, micTrack };
}

describe("BrowserTransport output gating", () => {
  it("blocks before the remote track arrives, then unblocks during continuous playback", async () => {
    const audio = audioElement();
    const { channel, peer, remoteTrack } = liveConnection();
    const onEvent = vi.fn();
    const transport = new BrowserTransport(audio as unknown as HTMLAudioElement);

    transport.setOutputBlocked(true);
    transport.setOutputBlocked(true);
    expect(audio.muted).toBe(true);
    await transport.start(onEvent, vi.fn());
    peer.ontrack?.({ track: remoteTrack });
    expect(audio.srcObject).not.toBeNull();
    expect(audio.play).toHaveBeenCalledOnce();
    expect(audio.muted).toBe(true);
    expect(audio.pause).not.toHaveBeenCalled();

    channel.onmessage?.({
      data: JSON.stringify({ type: "session.output_transcript.delta", delta: "hello", start_ms: 0, end_ms: 500 }),
    });
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "transcript", speaker: "sprout", delta: "hello" }),
    );
    transport.setOutputBlocked(false);
    transport.setOutputBlocked(false);
    expect(audio.muted).toBe(false);
    expect(audio.pause).not.toHaveBeenCalled();
    expect(peer.close).not.toHaveBeenCalled();
    expect(channel.close).not.toHaveBeenCalled();
    expect(remoteTrack.stop).not.toHaveBeenCalled();
  });

  it("clears a blocked output on teardown and ignores late calls", async () => {
    const audio = audioElement();
    const { peer, remoteTrack } = liveConnection();
    const transport = new BrowserTransport(audio as unknown as HTMLAudioElement);
    await transport.start(vi.fn(), vi.fn());
    peer.ontrack?.({ track: remoteTrack });
    transport.setOutputBlocked(true);
    transport.stopMedia();
    expect(audio.muted).toBe(false);
    expect(audio.srcObject).toBeNull();
    expect(peer.close).toHaveBeenCalledOnce();
    transport.close();
    expect(peer.close).toHaveBeenCalledOnce();
    transport.setOutputBlocked(true);
    transport.close();
    expect(audio.muted).toBe(false);
  });
});

function captureMocks() {
  const sources: { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
  const gain = { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
  const mix = { stream: { getTracks: () => [] }, disconnect: vi.fn() };
  const context = {
    state: "running",
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    createMediaStreamDestination: () => mix,
    createGain: () => gain,
    createMediaStreamSource: vi.fn(() => {
      const source = { connect: vi.fn(), disconnect: vi.fn() };
      sources.push(source);
      return source;
    }),
  };
  const recorders: Recorder[] = [];
  class Recorder {
    static isTypeSupported = (type: string) => type === "audio/webm;codecs=opus";
    state = "inactive";
    mimeType = "audio/webm;codecs=opus";
    ondataavailable?: ((event: { data: Blob }) => void) | null;
    onstop?: (() => void) | null;
    onerror?: (() => void) | null;
    constructor(readonly stream: unknown) {
      recorders.push(this);
    }
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(["audio"], { type: this.mimeType }) });
        this.onstop?.();
      });
    }
  }
  let contexts = 0;
  vi.stubGlobal(
    "AudioContext",
    class {
      constructor() {
        // Recording, microphone VAD and remote observation own separate contexts.
        return contexts++ === 0 ? context : { ...context, close: vi.fn(async () => {}) };
      }
    },
  );
  vi.stubGlobal("MediaRecorder", Recorder);
  return { sources, gain, mix, context, recorders };
}

it("only forwards microphone settings when the attempt explicitly opts in", async () => {
  const { micTrack } = liveConnection();
  Object.assign(micTrack, { getSettings: () => ({ sampleRate: 48000, deviceId: "private" }) });
  captureMocks();
  const off = new BrowserTransport(audioElement() as unknown as HTMLAudioElement);
  const offSink = vi.fn();
  off.setMicrophoneDiagnosticSink(offSink);
  await off.start(vi.fn(), vi.fn());
  expect(offSink).not.toHaveBeenCalled();
  off.stopMedia();

  const optedIn = liveConnection();
  Object.assign(optedIn.micTrack, { getSettings: () => ({ sampleRate: 48000, deviceId: "private" }) });
  captureMocks();
  const on = new BrowserTransport(audioElement() as unknown as HTMLAudioElement, true);
  const onSink = vi.fn();
  on.setMicrophoneDiagnosticSink(onSink);
  await on.start(vi.fn(), vi.fn());
  expect(onSink).toHaveBeenCalledWith({ type: "microphone.track_settings", detail: { sampleRate: 48000 } });
  on.stopMedia();
});

it("mixes mic and permitted remote audio, starts at live boundary, and finishes once", async () => {
  const { peer, remoteTrack, micTrack } = liveConnection();
  const { sources, gain, mix, context, recorders } = captureMocks();
  const audio = audioElement();
  let play!: () => void;
  audio.play.mockImplementation(
    () =>
      new Promise<void>(resolve => {
        play = resolve;
      }),
  );
  const transport = new BrowserTransport(audio as unknown as HTMLAudioElement);
  await transport.start(vi.fn(), vi.fn());
  expect(recorders).toHaveLength(0);
  peer.ontrack?.({ track: remoteTrack });
  expect(gain.gain.value).toBe(0);
  transport.startRecording();
  transport.startRecording();
  expect(recorders).toHaveLength(1);
  expect(recorders[0].stream).toBe(mix.stream);
  expect(sources[0].connect).toHaveBeenCalledWith(mix);
  expect(sources.at(-1)?.connect).toHaveBeenCalledWith(gain);
  expect(gain.connect).toHaveBeenCalledWith(mix);
  play();
  await Promise.resolve();
  expect(gain.gain.value).toBe(1);
  transport.setOutputBlocked(true);
  expect(audio.muted).toBe(true);
  expect(gain.gain.value).toBe(0);
  expect(sources[0].disconnect).not.toHaveBeenCalled();
  transport.setOutputBlocked(false);
  expect(audio.muted).toBe(false);
  expect(gain.gain.value).toBe(1);
  transport.stopMedia();
  transport.stopMedia();
  transport.close();
  transport.close();
  const recording = await transport.recording();
  expect(recording).toMatchObject({ startOffsetMs: 0, mimeType: "audio/webm;codecs=opus" });
  expect(recording?.blob.size).toBeGreaterThan(0);
  expect(recording?.durationMs).toBeGreaterThanOrEqual(0);
  expect(context.close).toHaveBeenCalledOnce();
  expect(micTrack.stop).toHaveBeenCalledOnce();
  expect(remoteTrack.stop).toHaveBeenCalledOnce();
  expect(peer.close).toHaveBeenCalledOnce();
});

it("explicitly fails capture when unsupported without disrupting the connection", async () => {
  liveConnection();
  vi.stubGlobal("MediaRecorder", undefined);
  const transport = new BrowserTransport(audioElement() as unknown as HTMLAudioElement);
  await transport.start(vi.fn(), vi.fn());
  expect(() => transport.startRecording()).toThrow("unavailable");
  transport.close();
  await expect(transport.recording()).rejects.toThrow("unavailable");
});

it("rejects unexpectedly stopped or errored capture", async () => {
  liveConnection();
  const { recorders } = captureMocks();
  const transport = new BrowserTransport(audioElement() as unknown as HTMLAudioElement);
  await transport.start(vi.fn(), vi.fn());
  transport.startRecording();
  recorders[0].stop();
  await Promise.resolve();
  transport.close();
  await expect(transport.recording()).rejects.toThrow("unexpectedly");
});

it.each(["error", "empty"])("reports %s recording instead of claiming usable audio", async failure => {
  liveConnection();
  const { recorders } = captureMocks();
  const transport = new BrowserTransport(audioElement() as unknown as HTMLAudioElement);
  await transport.start(vi.fn(), vi.fn());
  transport.startRecording();
  if (failure === "error") recorders[0].onerror?.();
  else
    recorders[0].stop = () => {
      recorders[0].state = "inactive";
      queueMicrotask(() => recorders[0].onstop?.());
    };
  transport.close();
  await expect(transport.recording()).rejects.toThrow(failure === "error" ? "failed" : "empty");
});

it("late remote tracks and play resolution cannot restore output after stop", async () => {
  const { peer, remoteTrack } = liveConnection();
  const audio = audioElement();
  let finishPlay!: () => void;
  audio.play.mockImplementation(
    () =>
      new Promise<void>(resolve => {
        finishPlay = resolve;
      }),
  );
  const transport = new BrowserTransport(audio as unknown as HTMLAudioElement);
  transport.setOutputBlocked(true);
  await transport.start(vi.fn(), vi.fn());
  peer.ontrack?.({ track: remoteTrack });
  transport.stopMedia();
  finishPlay();
  await Promise.resolve();
  const late = { stop: vi.fn() } as unknown as MediaStreamTrack;
  peer.ontrack?.({ track: late });
  expect(late.stop).toHaveBeenCalledOnce();
  expect(audio.srcObject).toBeNull();
  expect(audio.pause).toHaveBeenCalledOnce();
  expect(audio.play).toHaveBeenCalledOnce();
  transport.close();
});

describe("production response-source isolation", () => {
  it("keeps B detached, retires A before promotion, rejects every late A callback, and routes send to B", async () => {
    const a = liveConnection();
    const audio = audioElement();
    let resolveA!: () => void;
    audio.play.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          resolveA = resolve;
        }),
    );
    const events = vi.fn();
    const failures = vi.fn();
    const transport = new BrowserTransport(audio as unknown as HTMLAudioElement);
    await transport.start(events, failures);
    const idA = transport.activeSourceId!;
    a.peer.ontrack?.({ track: a.remoteTrack });
    const streamA = audio.srcObject;
    const b = liveConnection();
    const idB = await transport.prepareReplacement(seed);
    expect(idB).toBeGreaterThan(idA);
    b.peer.ontrack?.({ track: b.remoteTrack });
    expect(audio.srcObject).toBe(streamA);
    expect(audio.play).toHaveBeenCalledOnce();
    const count = events.mock.calls.length;
    a.peer.connectionState = "failed";
    const lateA = () => {
      for (const raw of [
        { type: "session.output_transcript.delta", delta: "late", start_ms: 0, end_ms: 1 },
        { type: "session.closed" },
        { type: "error" },
      ])
        a.channel.onmessage?.({ data: JSON.stringify(raw) });
      a.channel.onmessage?.({ data: "invalid json" });
      (a.channel.onclose as (() => void) | null)?.();
      (a.channel.onerror as (() => void) | null)?.();
      (a.peer.onconnectionstatechange as (() => void) | null)?.();
    };
    const teardown: string[] = [];
    a.channel.close.mockImplementation(() => {
      teardown.push("channel");
      expect(transport.activeSourceId).toBeUndefined();
      expect(audio.srcObject).toBeNull();
      expect(a.remoteTrack.stop).toHaveBeenCalledOnce();
      expect(transport.activateSource(idA)).toBe(false);
      lateA();
    });
    a.peer.close.mockImplementation(() => {
      teardown.push("peer");
      expect(a.channel.close).toHaveBeenCalledOnce();
      a.peer.connectionState = "closed";
      lateA();
    });
    // Synchronous media and network teardown callbacks see A invalidated.
    vi.mocked(a.remoteTrack.stop).mockImplementation(() => {
      expect(transport.activeSourceId).toBeUndefined();
      expect(audio.muted).toBe(true);
      expect(audio.srcObject).toBeNull();
      teardown.push("remote");
      lateA();
    });
    transport.retireSource(idA);
    transport.retireSource(idA);
    expect(teardown).toEqual(["remote", "channel", "peer"]);
    expect(a.channel.close).toHaveBeenCalledOnce();
    expect(a.peer.close).toHaveBeenCalledOnce();
    expect(a.remoteTrack.stop).toHaveBeenCalledOnce();
    expect(b.channel.close).not.toHaveBeenCalled();
    expect(b.peer.close).not.toHaveBeenCalled();
    expect(b.remoteTrack.stop).not.toHaveBeenCalled();
    expect(a.micTrack.stop).not.toHaveBeenCalled();
    expect(events).toHaveBeenCalledTimes(count);
    transport.setOutputBlocked(false);
    expect(audio.muted).toBe(true);
    expect(transport.activateSource(idA)).toBe(false);
    expect(transport.activateSource(idB)).toBe(true);
    expect(audio.srcObject).not.toBe(streamA);
    expect(audio.muted).toBe(true);
    resolveA();
    await Promise.resolve();
    const lateTrack = { stop: vi.fn() } as unknown as MediaStreamTrack;
    a.peer.ontrack?.({ track: lateTrack });
    lateA();
    expect(lateTrack.stop).toHaveBeenCalledOnce();
    expect(failures).not.toHaveBeenCalled();
    expect(events.mock.calls.slice(count)).toEqual([[{ type: "output.activity", state: "unavailable", sourceId: 2 }]]);
    transport.setOutputBlocked(false);
    expect(audio.muted).toBe(false);
    const command = { type: "session.close" as const, event_id: "test" };
    transport.send(command);
    expect(a.channel.send).not.toHaveBeenCalled();
    expect(b.channel.send).toHaveBeenCalledOnce();
    expect(b.channel.close).not.toHaveBeenCalled();
    expect(b.peer.close).not.toHaveBeenCalled();
    transport.close();
    transport.close();
    expect(a.peer.close).toHaveBeenCalledOnce();
    expect(b.peer.close).toHaveBeenCalledOnce();
    expect(a.remoteTrack.stop).toHaveBeenCalledOnce();
    expect(b.remoteTrack.stop).toHaveBeenCalledOnce();
    expect(a.micTrack.stop).toHaveBeenCalledOnce();
  });

  it("lesson teardown retires both current and pending and cannot promote after stop", async () => {
    const a = liveConnection();
    const transport = new BrowserTransport(audioElement() as unknown as HTMLAudioElement);
    await transport.start(vi.fn(), vi.fn());
    a.peer.ontrack?.({ track: a.remoteTrack });
    const b = liveConnection();
    const idB = await transport.prepareReplacement(seed);
    b.peer.ontrack?.({ track: b.remoteTrack });
    transport.stopMedia();
    transport.stopMedia();
    expect(transport.activateSource(idB)).toBe(false);
    expect(a.remoteTrack.stop).toHaveBeenCalledOnce();
    expect(b.remoteTrack.stop).toHaveBeenCalledOnce();
    expect(a.micTrack.stop).toHaveBeenCalledOnce();
    transport.close();
    expect(a.peer.close).toHaveBeenCalledOnce();
    expect(b.peer.close).toHaveBeenCalledOnce();
  });

  it("rejects overlapping preparations and cancellation during setup without touching A", async () => {
    const a = liveConnection();
    const transport = new BrowserTransport(audioElement() as unknown as HTMLAudioElement);
    await transport.start(vi.fn(), vi.fn());
    const idA = transport.activeSourceId;
    const b = liveConnection();
    let offer!: (value: { type: string; sdp: string }) => void;
    b.peer.createOffer.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          offer = resolve;
        }),
    );
    const preparing = transport.prepareReplacement(seed);
    await expect(transport.prepareReplacement(seed)).rejects.toThrow("already pending");
    // IDs are monotonically allocated, so the first pending source follows A.
    expect(transport.activateSource(idA! + 1)).toBe(false);
    transport.retireSource(idA! + 1);
    offer({ type: "offer", sdp: "offer" });
    await expect(preparing).rejects.toThrow("setup ended");
    expect(transport.activeSourceId).toBe(idA);
    expect(a.peer.close).not.toHaveBeenCalled();
    expect(b.peer.close).toHaveBeenCalledOnce();
    transport.close();
  });
});

it("pending connection failure stays local and a late setup completion cannot survive lesson close", async () => {
  const a = liveConnection();
  const failure = vi.fn();
  const transport = new BrowserTransport(audioElement() as unknown as HTMLAudioElement);
  await transport.start(vi.fn(), failure);
  const idA = transport.activeSourceId;
  const b = liveConnection();
  const idB = await transport.prepareReplacement(seed);
  (b.channel.onerror as (() => void) | null)?.();
  expect(transport.activateSource(idB)).toBe(false);
  expect(transport.activeSourceId).toBe(idA);
  expect(b.channel.close).toHaveBeenCalledOnce();
  expect(b.peer.close).toHaveBeenCalledOnce();
  expect(a.channel.close).not.toHaveBeenCalled();
  expect(a.peer.close).not.toHaveBeenCalled();
  expect(a.micTrack.stop).not.toHaveBeenCalled();
  expect(failure).not.toHaveBeenCalled();
  const c = liveConnection();
  let answer!: () => void;
  c.peer.setRemoteDescription.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        answer = resolve;
      }),
  );
  const preparing = transport.prepareReplacement(seed);
  // Let setup reach its final await, then end the lesson before it resolves.
  await vi.waitFor(() => expect(c.peer.setRemoteDescription).toHaveBeenCalledOnce());
  transport.close();
  answer();
  await expect(preparing).rejects.toThrow("setup ended");
  expect(transport.activeSourceId).toBeUndefined();
  expect(a.peer.close).toHaveBeenCalledOnce();
  expect(b.peer.close).toHaveBeenCalledOnce();
  expect(c.peer.close).toHaveBeenCalledOnce();
  expect(failure).not.toHaveBeenCalled();
});

it("promotion retires a playable A and leaves B's playback and recording blocked", async () => {
  const a = liveConnection();
  const { gain } = captureMocks();
  const audio = audioElement();
  const transport = new BrowserTransport(audio as unknown as HTMLAudioElement);
  await transport.start(vi.fn(), vi.fn());
  a.peer.ontrack?.({ track: a.remoteTrack });
  await Promise.resolve();
  expect(gain.gain.value).toBe(1);
  const b = liveConnection();
  const idB = await transport.prepareReplacement(seed);
  b.peer.ontrack?.({ track: b.remoteTrack });
  expect(gain.gain.value).toBe(1); // Pending B has no path into the mix.
  vi.mocked(a.remoteTrack.stop).mockImplementation(() => {
    expect(audio.muted).toBe(true);
    expect(audio.srcObject).toBeNull();
    expect(gain.gain.value).toBe(0);
    expect(transport.activeSourceId).toBeUndefined();
  });
  expect(transport.activateSource(idB)).toBe(true);
  await Promise.resolve();
  expect(a.remoteTrack.stop).toHaveBeenCalledOnce();
  expect(audio.muted).toBe(true);
  expect(gain.gain.value).toBe(0);
  transport.setOutputBlocked(false);
  expect(audio.muted).toBe(false);
  expect(gain.gain.value).toBe(1);
  transport.close();
});

it("SDP and A events cannot qualify B; B started qualifies without promotion or event leakage", async () => {
  const a = liveConnection();
  const events = vi.fn();
  const audio = audioElement();
  const transport = new BrowserTransport(audio as unknown as HTMLAudioElement);
  await transport.start(events, vi.fn());
  a.peer.ontrack?.({ track: a.remoteTrack });
  const streamA = audio.srcObject;
  const b = liveConnection(false);
  let resolved = false;
  const preparing = transport.prepareReplacement(seed).then(id => {
    resolved = true;
    return id;
  });
  await vi.waitFor(() => expect(b.peer.setRemoteDescription).toHaveBeenCalledOnce());
  const count = events.mock.calls.length;
  const emitB = (raw: unknown) => b.channel.onmessage?.({ data: JSON.stringify(raw) });
  emitB({ type: "session.output_transcript.delta", delta: "hidden", start_ms: 0, end_ms: 1 });
  emitB({ type: "session.instructions.appended" });
  emitB({ type: 42 });
  a.channel.onmessage?.({ data: JSON.stringify({ type: "session.started" }) });
  await Promise.resolve();
  expect(resolved).toBe(false);
  expect(transport.activateSource(2)).toBe(false);
  expect(a.peer.close).not.toHaveBeenCalled();
  emitB({ type: "session.started" });
  const id = await preparing;
  expect(id).toBe(2);
  expect(events.mock.calls.slice(count)).toEqual([[expect.objectContaining({ type: "session.started" })]]);
  expect(transport.activeSourceId).toBe(1);
  expect(audio.srcObject).toBe(streamA);
  expect(a.peer.close).not.toHaveBeenCalled();
  expect(transport.replacementTiming).toMatchObject({ sourceId: 2, clock: "browser.performance.now" });
  const timing = transport.replacementTiming!;
  expect(timing.total_prepare_ms).toBe(timing.replacement_ready_at! - timing.replacement_requested_at);
  expect(timing.request_to_sdp_ms).toBe(timing.provider_response_received_at! - timing.replacement_requested_at);
  expect(timing.sdp_to_session_started_ms).toBe(timing.session_started_at! - timing.provider_response_received_at!);
  expect(timing.remote_description_applied_at).toBeGreaterThanOrEqual(timing.provider_response_received_at!);
  const request = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
  expect(request).toEqual({ sdp: "offer", replacement: seed });
  transport.close();
});

it.each([
  "provider error",
  "provider close",
  "channel error",
  "channel close",
  "peer failure",
  "retire",
  "stop",
  "timeout",
  "stalled SDP",
])("%s before started rejects, closes B, and ignores late started", async cause => {
  const a = liveConnection();
  const failure = vi.fn();
  const events = vi.fn();
  const transport = new BrowserTransport(audioElement() as unknown as HTMLAudioElement);
  await transport.start(events, failure);
  const b = liveConnection(false);
  if (cause === "stalled SDP") b.peer.setRemoteDescription.mockImplementation(() => new Promise(() => {}));
  vi.useFakeTimers();
  const preparing = transport.prepareReplacement(seed);
  const rejection = expect(preparing).rejects.toThrow();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(b.peer.setRemoteDescription).toHaveBeenCalledOnce();
  if (cause === "provider error" || cause === "provider close")
    b.channel.onmessage?.({ data: JSON.stringify({ type: cause === "provider error" ? "error" : "session.closed" }) });
  else if (cause === "channel error") (b.channel.onerror as (() => void) | null)?.();
  else if (cause === "channel close") (b.channel.onclose as (() => void) | null)?.();
  else if (cause === "peer failure") {
    b.peer.connectionState = "failed";
    (b.peer.onconnectionstatechange as (() => void) | null)?.();
  } else if (cause === "retire") transport.retireSource(2);
  else if (cause === "stop") transport.stopMedia();
  else await vi.advanceTimersByTimeAsync(REPLACEMENT_TIMEOUT_MS);
  await rejection;
  const count = events.mock.calls.length;
  b.channel.onmessage?.({ data: JSON.stringify({ type: "session.started" }) });
  expect(events).toHaveBeenCalledTimes(count);
  expect(transport.activateSource(2)).toBe(false);
  expect(b.peer.close).toHaveBeenCalledOnce();
  expect(b.channel.close).toHaveBeenCalledOnce();
  expect(transport.replacementTiming?.replacement_ready_at).toBeUndefined();
  if (cause !== "stop") {
    expect(transport.activeSourceId).toBe(1);
    expect(a.peer.close).not.toHaveBeenCalled();
  }
  expect(failure).not.toHaveBeenCalled();
  transport.close();
  expect(vi.getTimerCount()).toBe(0);
});

it("invalid replacement seed fails before creating a connection or paid request", async () => {
  const a = liveConnection();
  const transport = new BrowserTransport(audioElement() as unknown as HTMLAudioElement);
  await transport.start(vi.fn(), vi.fn());
  vi.mocked(fetch).mockClear();
  await expect(transport.prepareReplacement({ ...seed, sceneIndex: -1 })).rejects.toThrow("Invalid");
  expect(fetch).not.toHaveBeenCalled();
  expect(a.peer.close).not.toHaveBeenCalled();
  transport.close();
});

it("gate cancellation signal immediately retires pending B without stopping A", async () => {
  const a = liveConnection();
  const transport = new BrowserTransport(audioElement() as unknown as HTMLAudioElement);
  await transport.start(vi.fn(), vi.fn());
  const b = liveConnection(false);
  const abort = new AbortController();
  const preparing = transport.prepareReplacement(seed, abort.signal);
  const rejected = expect(preparing).rejects.toThrow("setup ended");
  await vi.waitFor(() => expect(b.peer.setRemoteDescription).toHaveBeenCalledOnce());
  abort.abort();
  await rejected;
  expect(b.peer.close).toHaveBeenCalledOnce();
  expect(b.channel.close).toHaveBeenCalledOnce();
  expect(a.peer.close).not.toHaveBeenCalled();
  b.channel.onmessage?.({ data: JSON.stringify({ type: "session.started" }) });
  expect(transport.activateSource(2)).toBe(false);
  expect(transport.activeSourceId).toBe(1);
  transport.close();
});
