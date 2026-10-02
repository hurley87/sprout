import { vi } from "vitest";
import type { ChoreographyPhase } from "../../lib/choreography";
import type { Transport } from "../../lib/session";
import type { LocalPlaybackEvent } from "../../lib/events";

/** Unit-only finite playback port: lifecycle facts are explicit and immediate.
 * Real finite media, output drain and recording are covered in Chromium. Existing
 * transcript/evidence unit fixtures have no DOM media graph. */
export function immediateAcknowledgment(transport: Transport, phase?: () => ChoreographyPhase | undefined) {
  let sink: (event: LocalPlaybackEvent) => void = () => {};
  transport.setPlaybackEventSink = callback => {
    sink = callback;
  };
  if (transport.preloadAcknowledgments) transport.preloadAcknowledgments = vi.fn(async () => {});
  transport.playAcknowledgment = vi.fn(request => {
    let terminal = false;
    let resolve!: (event: LocalPlaybackEvent) => void;
    const result = new Promise<LocalPlaybackEvent>(r => {
      resolve = r;
    });
    const emit = (state: LocalPlaybackEvent["state"]) => {
      if (terminal) return;
      const event: LocalPlaybackEvent = {
        type: "local.playback",
        identity: request.identity,
        sourceId: request.identity.owningSourceId,
        assetId: request.asset.id,
        assetSha256: request.asset.sha256,
        state,
        clock: "browser.performance.now",
        observedAt: performance.now(),
        ...(state === "completed"
          ? {
              mediaTime: 1,
              duration: 1,
              renderFence: 1,
              outputTimestamp: { contextTime: 1.1, performanceTime: performance.now() },
            }
          : {}),
      };
      terminal = ["completed", "interrupted", "superseded", "stopped", "source_retired", "failed"].includes(state);
      sink(event);
      if (terminal) resolve(event);
    };
    emit("requested");
    emit("ready");
    emit("started");
    emit("media_ended");
    emit("completed");
    return { result, cancel: (reason?: "interrupted" | "superseded" | "stopped") => emit(reason ?? "interrupted") };
  });
  if (!("activeSourceId" in transport))
    Object.defineProperty(transport, "activeSourceId", { value: 1, writable: true, configurable: true });
  transport.discardOutput ??= vi.fn(() => phase?.() === "accepted_pending_ack");
  let nextSource = transport.activeSourceId ?? 1;
  transport.prepareReplacement ??= vi.fn(async () => ++nextSource);
  transport.activateSource ??= vi.fn(id => {
    Object.assign(transport, { activeSourceId: id });
    return true;
  });
  transport.retireSource ??= vi.fn();
}
