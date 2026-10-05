import { expect, it, vi } from "vitest";
import { observeOutboundAudio, outboundPlaybackEvidence, type AudioWindow } from "./helpers/outbound-audio";

it("bounds stats, whitelists audio only and never subtracts across resets or peers", async () => {
  class Peer {
    connectionState = "connected";
    iceConnectionState = "connected";
    packets = 3;
    fail = false;
    hang = false;
    createDataChannel() {
      return new EventTarget();
    }
    getSenders() {
      return [{ track: { kind: "audio", enabled: true, muted: false, readyState: "live", id: "PRIVATE" } }];
    }
    getStats() {
      if (this.fail) return Promise.reject(new Error("PRIVATE"));
      if (this.hang) return new Promise(() => {});
      return Promise.resolve(
        new Map([
          [
            "PRIVATE",
            {
              type: "outbound-rtp",
              kind: "audio",
              id: "PRIVATE",
              packetsSent: this.packets,
              bytesSent: this.packets * 10,
              address: "PRIVATE",
            },
          ],
          ["video", { type: "outbound-rtp", kind: "video", id: "PRIVATE", packetsSent: 99 }],
        ]),
      );
    }
  }
  const host = {} as AudioWindow;
  vi.stubGlobal("window", host);
  vi.stubGlobal("RTCPeerConnection", Peer);
  vi.useFakeTimers();
  const original = Peer.prototype.createDataChannel;
  try {
    observeOutboundAudio();
    const peer = new Peer();
    (peer as unknown as RTCPeerConnection).createDataChannel("oai-events");
    const control = host.sproutOutboundAudio!;
    control.boundary(1, "one", "start");
    await control.read();
    peer.packets = 8;
    control.boundary(1, "one", "ended");
    const capture = await control.read();
    expect(outboundPlaybackEvidence(capture)[0].deltas[0]).toMatchObject({ packetsSent: 5, bytesSent: 50 });
    expect(JSON.stringify(capture)).not.toContain("PRIVATE");
    control.boundary(2, "one", "start");
    await control.read();
    peer.packets = 1;
    control.boundary(2, "one", "cancelled");
    expect(outboundPlaybackEvidence(await control.read())[1].deltas[0].status).toBe("unknown");
    peer.fail = true;
    control.boundary(3, "one", "start");
    expect((await control.read()).records.at(-1)?.peers[0].status).toBe("unavailable");
    peer.fail = false;
    peer.hang = true;
    control.boundary(3, "one", "ended");
    await vi.advanceTimersByTimeAsync(501);
    expect((await control.read()).records.at(-1)?.peers[0].status).toBe("timeout");
    for (let i = 0; i < 260; i++) control.boundary(4, "one", "start");
    await vi.advanceTimersByTimeAsync(501);
    expect((await control.read()).records).toHaveLength(256);
    expect((await control.read()).dropped).toBeGreaterThan(0);
    control.dispose();
    expect(Peer.prototype.createDataChannel).toBe(original);
  } finally {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
