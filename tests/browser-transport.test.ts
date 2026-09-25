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
