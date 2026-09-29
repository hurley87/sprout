import { describe, expect, it, vi } from "vitest";
import {
  outboundMicrophoneRtp,
  microphoneRtpDeltas,
  replacementMicrophone,
} from "../scripts/live/replacement-input.mjs";

describe("experiment outbound RTP extraction (not provider behavior)", () => {
  it("selects the audio sender and extracts only outbound audio counters with native timestamps", async () => {
    const report = new Map([
      [
        "audio",
        { id: "audio", type: "outbound-rtp", kind: "audio", timestamp: 123456, packetsSent: 9, bytesSent: 120 },
      ],
      [
        "video",
        { id: "video", type: "outbound-rtp", kind: "video", timestamp: 123456, packetsSent: 99, bytesSent: 999 },
      ],
      [
        "remote",
        { id: "remote", type: "remote-inbound-rtp", kind: "audio", timestamp: 123456, packetsSent: 99, bytesSent: 999 },
      ],
    ]);
    const getStats = vi.fn(async () => report);
    const videoStats = vi.fn();
    const peer = {
      getSenders: () => [
        { track: { kind: "video" }, getStats: videoStats },
        { track: { kind: "audio" }, getStats },
      ],
    };
    const snapshot = await outboundMicrophoneRtp(peer, "ready");
    expect(snapshot).toMatchObject({
      label: "ready",
      packetsSent: 9,
      bytesSent: 120,
      reports: [{ id: "audio", timestamp: 123456, packetsSent: 9, bytesSent: 120 }],
    });
    expect(getStats).toHaveBeenCalledOnce();
    expect(videoStats).not.toHaveBeenCalled();
    expect(snapshot.sampledAt).toBeGreaterThanOrEqual(0);
    const after = {
      ...snapshot,
      label: "promoted",
      sampledAt: snapshot.sampledAt + 100,
      packetsSent: 12,
      bytesSent: 150,
    };
    const delta = microphoneRtpDeltas([snapshot, after])[0];
    expect(delta).toMatchObject({ from: "ready", to: "promoted", packetsSent: 3, bytesSent: 30 });
    expect(delta.elapsedMs).toBeCloseTo(100);
  });
  it("reports missing counters as unavailable rather than zero transmission", async () => {
    const snapshot = await outboundMicrophoneRtp(
      { getSenders: () => [{ track: { kind: "audio" }, getStats: async () => new Map() }] },
      "ready",
    );
    expect(snapshot).toMatchObject({ reports: [], packetsSent: null, bytesSent: null });
    expect(microphoneRtpDeltas([snapshot, { ...snapshot, label: "end" }])[0]).toMatchObject({
      packetsSent: null,
      bytesSent: null,
    });
    await expect(outboundMicrophoneRtp({ getSenders: () => [] }, "ready")).rejects.toThrow("No audio");
  });
  it("rejects unsupported microphone modes before creating nodes", () => {
    const context = { createMediaStreamDestination: vi.fn() };
    expect(() => replacementMicrophone(context, "speech")).toThrow("Unknown");
    expect(context.createMediaStreamDestination).not.toHaveBeenCalled();
  });
});
