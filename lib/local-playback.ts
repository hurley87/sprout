import type { LocalPlaybackEvent, PlaybackIdentity, PlaybackTerminalState } from "./events";

/** Reviewed catalog metadata. The bytes, element and graph remain private. */
export type PlaybackRequest = {
  identity: PlaybackIdentity;
  asset: { id: string; sha256: string; url: string; mimeType: string };
};
export type PlaybackHandle = {
  result: Promise<LocalPlaybackEvent>;
  cancel(reason?: "interrupted" | "superseded" | "stopped"): void;
};
export const PLAYBACK_TIMEOUT_MS = 15_000;
export const OUTPUT_DRAIN_TIMEOUT_MS = 2_000;
const MAX_ASSET_BYTES = 4 * 1024 * 1024;
const MAX_DURATION_SECONDS = 10;

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** One finite playback attempt. No lesson/scene authority lives here. Success
 * means natural media end followed by an advancing browser output-clock fence;
 * it is not physical hearing or a provider delivery claim. */
export class FinitePlayback {
  readonly request: PlaybackRequest;
  readonly result: Promise<LocalPlaybackEvent>;
  state: LocalPlaybackEvent["state"] = "requested";
  private terminal = false;
  private abort = new AbortController();
  private audio?: HTMLAudioElement;
  private source?: MediaElementAudioSourceNode;
  private gain?: GainNode;
  private url?: string;
  private listeners: (() => void)[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private drainTimer?: ReturnType<typeof setTimeout>;
  private frame?: number;
  private resolve!: (event: LocalPlaybackEvent) => void;
  private fence?: number;
  private output?: AudioTimestamp;
  private lastOutput?: AudioTimestamp;
  private contextSink: unknown;
  private duration?: number;

  constructor(
    request: PlaybackRequest,
    private context: AudioContext,
    private mix: MediaStreamAudioDestinationNode,
    private healthy: () => boolean,
    private emit: (event: LocalPlaybackEvent) => void,
  ) {
    this.request = freeze(structuredClone(request));
    this.contextSink = this.sink();
    this.result = new Promise(resolve => {
      this.resolve = resolve;
    });
  }

  get speaking() {
    return !this.terminal && (this.state === "started" || this.state === "media_ended");
  }

  start() {
    if (this.terminal || this.timer) return;
    this.timer = setTimeout(() => this.cancel("failed", "playback_timeout"), PLAYBACK_TIMEOUT_MS);
    this.watch(this.context, "statechange", () => {
      if (this.context.state !== "running") this.cancel("failed", "context_suspended");
    });
    this.watch(this.context, "sinkchange", () => this.cancel("failed", "sink_changed"));
    for (const track of this.mix.stream.getAudioTracks()) {
      this.watch(track, "ended", () => this.cancel("failed", "recording_route_failed"));
      this.watch(track, "mute", () => this.cancel("failed", "recording_route_failed"));
    }
    this.publish("requested");
    if (!this.check()) return;
    this.frame = requestAnimationFrame(this.poll);
    void this.load();
  }

  private sink() {
    return (this.context as AudioContext & { sinkId?: unknown }).sinkId;
  }

  private watch(target: EventTarget, name: string, callback: (event: Event) => void) {
    target.addEventListener(name, callback);
    this.listeners.push(() => target.removeEventListener(name, callback));
  }

  private publish(state: LocalPlaybackEvent["state"], reason?: string): LocalPlaybackEvent {
    this.state = state;
    const event: LocalPlaybackEvent = freeze({
      type: "local.playback",
      identity: this.request.identity,
      sourceId: this.request.identity.owningSourceId,
      assetId: this.request.asset.id,
      assetSha256: this.request.asset.sha256,
      state,
      ...(reason ? { reason } : {}),
      clock: "browser.performance.now",
      observedAt: performance.now(),
      ...(this.audio && Number.isFinite(this.audio.currentTime) && this.audio.currentTime >= 0
        ? { mediaTime: this.audio.currentTime }
        : {}),
      ...(this.audio && Number.isFinite(this.audio.duration) && this.audio.duration > 0
        ? { duration: this.audio.duration }
        : {}),
      ...(this.fence !== undefined ? { renderFence: this.fence } : {}),
      ...(this.output ? { outputTimestamp: { ...this.output } } : {}),
      ...(Number.isFinite(this.context.baseLatency) && this.context.baseLatency >= 0
        ? { baseLatency: this.context.baseLatency }
        : {}),
      ...(Number.isFinite(this.context.outputLatency) && this.context.outputLatency >= 0
        ? { outputLatency: this.context.outputLatency }
        : {}),
    });
    this.emit(event);
    return event;
  }

  /** Ownership is invalidated synchronously before teardown queues callbacks. */
  cancel(state: Exclude<PlaybackTerminalState, "completed"> = "interrupted", reason: string = state) {
    if (this.terminal) return;
    // Retained/untyped callers cannot mint a successful terminal fact.
    if (!["interrupted", "superseded", "stopped", "source_retired", "failed"].includes(state)) {
      state = "failed";
      reason = "invalid_cancellation_state";
    }
    this.terminal = true;
    if (this.gain) this.gain.gain.value = 0;
    const event = this.publish(state, reason);
    this.cleanup();
    this.resolve(event);
  }

  private cleanup() {
    this.abort.abort();
    clearTimeout(this.timer);
    clearTimeout(this.drainTimer);
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.listeners.forEach(remove => remove());
    this.listeners = [];
    if (this.gain) this.gain.gain.value = 0;
    this.source?.disconnect();
    this.gain?.disconnect();
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
    }
    if (this.url) URL.revokeObjectURL(this.url);
  }

  private check() {
    if (this.terminal) return false;
    if (!this.healthy()) {
      this.cancel("failed", "owner_or_recording_route_unavailable");
      return false;
    }
    if (this.context.state !== "running") {
      this.cancel("failed", "context_suspended");
      return false;
    }
    if (this.sink() !== this.contextSink) {
      this.cancel("failed", "sink_changed");
      return false;
    }
    const audio = this.audio;
    if (
      audio &&
      (audio.src !== this.url ||
        audio.srcObject !== null ||
        ((audio as HTMLAudioElement & { sinkId?: string }).sinkId &&
          (audio as HTMLAudioElement & { sinkId?: string }).sinkId !== "") ||
        audio.muted ||
        audio.volume !== 1 ||
        audio.playbackRate !== 1 ||
        audio.defaultPlaybackRate !== 1 ||
        audio.loop ||
        audio.seeking ||
        audio.error ||
        this.gain?.gain.value !== 1 ||
        (this.state === "started" && audio.paused && !this.atEnd()))
    ) {
      this.cancel("failed", "media_route_changed");
      return false;
    }
    return true;
  }

  private atEnd() {
    const audio = this.audio;
    return (
      !!audio &&
      audio.ended &&
      Number.isFinite(audio.duration) &&
      audio.duration > 0 &&
      audio.currentTime === audio.duration &&
      this.duration !== undefined &&
      Math.abs(audio.duration - this.duration) < 0.002
    );
  }

  private async load() {
    try {
      const asset = this.request.asset;
      if (!asset.id || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error("Invalid catalog asset");
      const response = await fetch(asset.url, { signal: this.abort.signal });
      if (!this.check()) return;
      if (!response.ok) throw new Error("Asset fetch failed");
      const bytes = await response.arrayBuffer();
      if (!this.check()) return;
      if (!bytes.byteLength || bytes.byteLength > MAX_ASSET_BYTES) throw new Error("Invalid asset size");
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      if (!this.check()) return;
      const hash = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, "0")).join("");
      if (hash !== asset.sha256) throw new Error("Asset hash mismatch");
      const decoded = await this.context.decodeAudioData(bytes.slice(0));
      if (!this.check()) return; // decodeAudioData cannot be aborted; its result can lose ownership.
      if (!Number.isFinite(decoded.duration) || decoded.duration <= 0 || decoded.duration > MAX_DURATION_SECONDS)
        throw new Error("Invalid finite duration");
      this.duration = decoded.duration;
      const audio = (this.audio = new Audio());
      audio.preload = "auto";
      audio.loop = false;
      audio.muted = false;
      audio.volume = 1;
      audio.playbackRate = audio.defaultPlaybackRate = 1;
      this.url = URL.createObjectURL(new Blob([bytes], { type: asset.mimeType }));
      audio.src = this.url;
      this.source = this.context.createMediaElementSource(audio);
      this.gain = this.context.createGain();
      this.gain.gain.value = 1;
      this.source.connect(this.gain);
      this.gain.connect(this.context.destination);
      this.gain.connect(this.mix);
      for (const name of ["error", "abort", "emptied", "seeking", "ratechange", "volumechange", "sinkchange"])
        this.watch(audio, name, () => this.cancel("failed", `media_${name}`));
      this.watch(audio, "pause", () => {
        // HTML's natural terminal pause may be queued before ended.
        if (!this.atEnd()) this.cancel("failed", "unexpected_pause");
      });
      this.watch(audio, "playing", event => {
        if (!event.isTrusted || this.state !== "ready" || !this.check()) return;
        this.publish("started");
      });
      this.watch(audio, "ended", this.ended);
      if (audio.currentTime !== 0 || !this.check()) throw new Error("Playback did not start at zero");
      this.publish("ready");
      if (!this.check()) return;
      await audio.play(); // Never completion authority. A rejection is failure.
      this.check();
    } catch {
      this.cancel("failed", "asset_or_play_failed");
    }
  }

  private ended = (event: Event) => {
    if (!event.isTrusted || this.state !== "started" || !this.check() || !this.atEnd()) return;
    this.fence = this.context.currentTime;
    if (!Number.isFinite(this.fence) || this.fence <= 0) {
      this.cancel("failed", "invalid_render_fence");
      return;
    }
    this.lastOutput = undefined;
    this.publish("media_ended");
    if (!this.check()) return;
    this.drainTimer = setTimeout(() => this.cancel("failed", "output_clock_timeout"), OUTPUT_DRAIN_TIMEOUT_MS);
  };

  private poll = () => {
    if (!this.check()) return;
    if (typeof this.context.getOutputTimestamp !== "function") {
      this.cancel("failed", "output_clock_unavailable");
      return;
    }
    if (this.state === "media_ended") {
      let timestamp: AudioTimestamp;
      try {
        timestamp = this.context.getOutputTimestamp();
      } catch {
        this.cancel("failed", "output_clock_unavailable");
        return;
      }
      const { contextTime, performanceTime } = timestamp;
      if (
        contextTime !== undefined &&
        performanceTime !== undefined &&
        Number.isFinite(contextTime) &&
        contextTime > 0 &&
        contextTime <= this.context.currentTime &&
        Number.isFinite(performanceTime) &&
        performanceTime > 0 &&
        performanceTime <= performance.now()
      ) {
        const previous = this.lastOutput;
        if (previous && (contextTime < previous.contextTime! || performanceTime < previous.performanceTime!)) {
          this.cancel("failed", "output_clock_regressed");
          return;
        }
        this.lastOutput = { contextTime, performanceTime };
        if (
          previous &&
          contextTime > previous.contextTime! &&
          performanceTime > previous.performanceTime! &&
          contextTime >= this.fence! &&
          this.check() &&
          this.atEnd()
        ) {
          this.output = { contextTime, performanceTime };
          // Full owner/lifecycle recheck is synchronous with this terminal fact.
          this.terminal = true;
          const event = this.publish("completed");
          this.cleanup();
          this.resolve(event);
          return;
        }
      }
    }
    this.frame = requestAnimationFrame(this.poll);
  };
}
