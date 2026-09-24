import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserTransport } from "../lib/browser-transport";

class FakeChannel {
  readyState = "open";
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  close() {}
  send() {}
}

class FakePeer extends EventTarget {
  static current?: FakePeer;
  iceGatheringState = "complete";
  connectionState = "new";
  localDescription?: RTCSessionDescriptionInit;
  ontrack?: (event: { track: FakeTrack }) => void;
  onconnectionstatechange?: () => void;
  channel = new FakeChannel();

  constructor() {
    super();
    FakePeer.current = this;
  }

  addTrack() {}
  createDataChannel() {
    return this.channel;
  }
  async createOffer() {
    return { type: "offer", sdp: "offer" } as RTCSessionDescriptionInit;
  }
  async setLocalDescription(description: RTCSessionDescriptionInit) {
    this.localDescription = description;
  }
  async setRemoteDescription() {}
  close() {}
}

class FakeTrack {
  onended?: () => void;
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

class FakeStream {
  constructor(private tracks: FakeTrack[]) {}
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks;
  }
}

class FakeAudio extends EventTarget {
  autoplay = false;
  muted = false;
  srcObject: unknown = null;
  play = vi.fn(async () => {});
  pause = vi.fn();
}

afterEach(() => vi.unstubAllGlobals());

describe("BrowserTransport startup audio diagnostic", () => {
  it("reports the first remote audio element playing event once", async () => {
    const micTrack = new FakeTrack();
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn(async () => new FakeStream([micTrack])) },
    });
    vi.stubGlobal("window", { RTCPeerConnection: FakePeer });
    vi.stubGlobal("RTCPeerConnection", FakePeer);
    vi.stubGlobal("MediaStream", FakeStream);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ transport: { sdp: "answer" } }),
      })),
    );

    const audio = new FakeAudio();
    const transport = new BrowserTransport(audio as unknown as HTMLAudioElement);
    const onDiagnostic = vi.fn();
    await transport.start(
      () => {},
      () => {},
      onDiagnostic,
    );
    const remoteTrack = new FakeTrack();
    FakePeer.current?.ontrack?.({ track: remoteTrack });
    audio.dispatchEvent(new Event("playing"));
    audio.dispatchEvent(new Event("playing"));

    expect(audio.play).toHaveBeenCalledOnce();
    expect(onDiagnostic).toHaveBeenCalledOnce();
    expect(onDiagnostic).toHaveBeenCalledWith("startup.first_audio_playing", {
      source: "remote_media_audio_element",
      acoustic_onset_verified: false,
      listener_heard_audio_verified: false,
    });
    transport.close();
  });
});
