import { vi } from "vitest";

/** Synthetic media surfaces for current-runtime transport boundary tests. */
export function audioElement() {
  const audio = {
    muted: false,
    autoplay: false,
    srcObject: null as MediaStream | null,
    play: vi.fn(async () => {}),
    pause: vi.fn(),
  };
  return audio;
}

export function liveConnection(autoStarted = true) {
  const remoteTrack = { stop: vi.fn() } as unknown as MediaStreamTrack;
  const inputTrack = { enabled: true, stop: vi.fn() } as unknown as MediaStreamTrack;
  const inputs: MediaStreamTrack[] = [];
  const micTrack = {
    stop: vi.fn(),
    clone: vi.fn(() => {
      const track = inputs.length ? ({ enabled: true, stop: vi.fn() } as unknown as MediaStreamTrack) : inputTrack;
      inputs.push(track);
      return track;
    }),
  } as unknown as MediaStreamTrack;
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
    onopen: null as (() => void) | null,
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
  return { channel, peer, remoteTrack, micTrack, inputTrack, inputs };
}
