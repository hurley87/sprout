import type { Page } from "@playwright/test";
import type { LessonObservationWindow } from "../../lib/lesson-runtime/browser-observation";

export type AudioBoundary = {
  playbackId: number;
  fixture: string;
  boundary: "start" | "ended" | "cancelled";
  atMs: number | null;
  runtimeId: string | null;
  peers: {
    peerId: number;
    connectionState: string;
    iceConnectionState: string;
    tracks: { enabled: boolean; muted: boolean; readyState: string }[];
    status: "available" | "unavailable" | "timeout";
    sampledAtMs: number | null;
    counters: { stream: number; packetsSent: number | null; bytesSent: number | null }[];
  }[];
};
export type AudioCapture = { records: AudioBoundary[]; dropped: number; errors: number };
export type AudioWindow = LessonObservationWindow & {
  sproutOutboundAudio?: {
    boundary(playbackId: number, fixture: string, boundary: AudioBoundary["boundary"]): void;
    read(): Promise<AudioCapture>;
    dispose(): void;
  };
};

export function observeOutboundAudio() {
  const host = window as AudioWindow;
  const prototype = RTCPeerConnection.prototype;
  const original = prototype.createDataChannel;
  const peers = new Map<RTCPeerConnection, number>();
  const streams = new Map<RTCPeerConnection, Map<string, number>>();
  const capture: AudioCapture = { records: [], dropped: 0, errors: 0 };
  const pending = new Set<Promise<void>>();
  let nextPeer = 0;
  const wrapped: typeof original = function (this: RTCPeerConnection, ...args) {
    const channel = original.apply(this, args);
    if (args[0] === "oai-events" && !peers.has(this)) {
      if (peers.size < 32) {
        peers.set(this, ++nextPeer);
        streams.set(this, new Map());
      } else capture.errors++;
    }
    return channel;
  };
  prototype.createDataChannel = wrapped;
  host.sproutOutboundAudio = {
    boundary(playbackId, fixture, boundary) {
      if (capture.records.length >= 256) {
        capture.dropped++;
        return;
      }
      try {
        const observation = host.sproutLessonObservation?.read();
        const record: AudioBoundary = {
          playbackId,
          fixture,
          boundary,
          atMs: observation?.nowMs ?? null,
          runtimeId: observation?.cursor.runtimeId ?? null,
          peers: [],
        };
        capture.records.push(record);
        const task = Promise.all(
          [...peers].map(async ([peer, peerId]) => {
            const entry: AudioBoundary["peers"][number] = {
              peerId,
              connectionState: peer.connectionState,
              iceConnectionState: peer.iceConnectionState,
              tracks: peer.getSenders().flatMap(sender =>
                sender.track?.kind === "audio"
                  ? [
                      {
                        enabled: sender.track.enabled,
                        muted: sender.track.muted,
                        readyState: sender.track.readyState,
                      },
                    ]
                  : [],
              ),
              status: "unavailable",
              sampledAtMs: null,
              counters: [],
            };
            record.peers.push(entry);
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              const stats = await Promise.race([
                peer.getStats(),
                new Promise<null>(resolve => {
                  timer = setTimeout(() => resolve(null), 500);
                }),
              ]);
              if (!stats) {
                entry.status = "timeout";
                return;
              }
              entry.status = "available";
              const sampled = host.sproutLessonObservation?.read();
              entry.sampledAtMs = sampled?.cursor.runtimeId === record.runtimeId ? sampled.nowMs : null;
              const ids = streams.get(peer)!;
              stats.forEach(stat => {
                if (stat.type !== "outbound-rtp" || (stat.kind ?? stat.mediaType) !== "audio" || stat.isRemote) return;
                if (!ids.has(stat.id)) {
                  if (ids.size >= 16) {
                    capture.errors++;
                    return;
                  }
                  ids.set(stat.id, ids.size + 1);
                }
                const counter = (value: unknown) =>
                  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
                entry.counters.push({
                  stream: ids.get(stat.id)!,
                  packetsSent: counter(stat.packetsSent),
                  bytesSent: counter(stat.bytesSent),
                });
              });
            } catch {
              entry.status = "unavailable";
            } finally {
              if (timer) clearTimeout(timer);
            }
          }),
        ).then(() => {});
        pending.add(task);
        void task
          .finally(() => pending.delete(task))
          .catch(() => {
            capture.errors++;
          });
      } catch {
        capture.errors++;
      }
    },
    async read() {
      await Promise.allSettled([...pending]);
      return structuredClone(capture);
    },
    dispose() {
      if (prototype.createDataChannel === wrapped) prototype.createDataChannel = original;
      peers.clear();
      streams.clear();
    },
  };
}

export async function installOutboundAudio(page: Page) {
  await page.addInitScript(observeOutboundAudio);
  return {
    read: () => page.evaluate(() => (window as AudioWindow).sproutOutboundAudio?.read() ?? null),
    dispose: () => page.evaluate(() => (window as AudioWindow).sproutOutboundAudio?.dispose()),
  };
}

/** Compare only the same local peer and stream; no subtraction across restarts/resets. */
export function outboundPlaybackEvidence(capture: AudioCapture | null) {
  return (capture?.records.filter(row => row.boundary === "start") ?? []).map(start => {
    const end = capture?.records.find(row => row.playbackId === start.playbackId && row.boundary !== "start");
    const deltas = start.peers.flatMap(before =>
      before.counters.map(counter => {
        const after = end?.peers.find(peer => peer.peerId === before.peerId);
        const next = after?.counters.find(value => value.stream === counter.stream);
        const comparable =
          start.runtimeId === end?.runtimeId &&
          before.status === "available" &&
          before.connectionState !== "closed" &&
          after?.connectionState !== "closed" &&
          after?.status === "available" &&
          counter.packetsSent !== null &&
          counter.bytesSent !== null &&
          next?.packetsSent != null &&
          next.bytesSent !== null &&
          next.packetsSent >= counter.packetsSent &&
          next.bytesSent >= counter.bytesSent;
        return {
          peerId: before.peerId,
          stream: counter.stream,
          status: comparable ? "comparable" : "unknown",
          packetsSent: comparable ? next!.packetsSent! - counter.packetsSent! : null,
          bytesSent: comparable ? next!.bytesSent! - counter.bytesSent! : null,
        };
      }),
    );
    return {
      playbackId: start.playbackId,
      fixture: start.fixture,
      runtimeId: start.runtimeId,
      startMs: start.atMs,
      endMs: end?.atMs ?? null,
      result: end?.boundary ?? "unknown",
      status: deltas.some(delta => delta.status === "comparable") ? "comparable" : "unknown",
      deltas,
    };
  });
}
