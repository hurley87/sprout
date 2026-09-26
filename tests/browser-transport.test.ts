import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserTransport } from "../lib/browser-transport";

afterEach(() => vi.unstubAllGlobals());

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

function liveConnection() {
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
    iceGatheringState: "complete",
    localDescription: { sdp: "offer" },
    ontrack: null as ((event: { track: MediaStreamTrack }) => void) | null,
    onconnectionstatechange: null,
    addTrack: vi.fn(),
    createDataChannel: vi.fn(() => channel),
    createOffer: vi.fn(async () => ({ type: "offer", sdp: "offer" })),
    setLocalDescription: vi.fn(async () => {}),
    setRemoteDescription: vi.fn(async () => {}),
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
    expect(peer.close).not.toHaveBeenCalled();
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
  vi.stubGlobal(
    "AudioContext",
    class {
      constructor() {
        return context;
      }
    },
  );
  vi.stubGlobal("MediaRecorder", Recorder);
  return { sources, gain, mix, context, recorders };
}

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
