import { parseProviderEvent, parseSessionAnswer, type ClientCommand, type ProviderEvent } from "./events";
import type { SessionAudioRecording } from "./session-recorder";
import { MicrophoneTurnDetector, type MicrophoneMeasurement } from "./microphone-turn";
import { OutputActivityObserver } from "./output-activity";
import type { StartupStage } from "./startup-diagnostics";

const serverError = (body: unknown) =>
  typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
    ? body.error
    : undefined;

/** Application-owned identity; provider event IDs never select authority. */
export type LiveSourceId = number;
export type VoiceActivity = "speaking" | "listening" | "unavailable";

export type MicrophoneDiagnostic =
  | { type: "microphone.track_settings"; detail: Record<string, number | boolean | string> }
  | { type: "microphone.detector_unavailable"; detail: { reason: "web_audio_initialization_failed" } }
  | { type: "microphone.detector_window"; detail: MicrophoneMeasurement };

/** Deliberately omit deviceId, groupId, and labels from the local export. */
export function microphoneTrackSettings(track: MediaStreamTrack): Record<string, number | boolean | string> {
  let settings: Record<string, unknown> | undefined;
  try {
    settings = track.getSettings?.() as Record<string, unknown> | undefined;
  } catch {
    return {};
  }
  if (!settings) return {};
  const allowed = [
    "echoCancellation",
    "noiseSuppression",
    "autoGainControl",
    "sampleRate",
    "sampleSize",
    "channelCount",
    "latency",
  ] as const;
  const result: Record<string, number | boolean | string> = {};
  for (const key of allowed) {
    const value = settings[key];
    if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      (key === "echoCancellation" && typeof value === "string")
    )
      result[key] = value;
  }
  return result;
}

type LiveSource = {
  id: LiveSourceId;
  abort: AbortController;
  peer: RTCPeerConnection;
  channel?: RTCDataChannel;
  remote?: MediaStream;
  observer?: OutputActivityObserver;
  recordingSource?: MediaStreamAudioSourceNode;
  inputTracks?: MediaStreamTrack[];
  inputOpened?: boolean;
  requestedAt?: number;
  ready: boolean;
  sessionStarted: boolean;
  retired: boolean;
  outputDiscarded?: boolean;
  activity: Extract<ProviderEvent, { type: "output.activity" }>;
};

export class BrowserTransport {
  private nextSourceId = 0;
  private connections = new Map<LiveSourceId, LiveSource>();
  private current?: LiveSource;
  private onEvent?: (event: ProviderEvent) => void;
  private onFailure?: (message: string) => void;
  private mic?: MediaStream;
  private context?: AudioContext;
  private mix?: MediaStreamAudioDestinationNode;
  private sources: MediaStreamAudioSourceNode[] = [];
  private remoteGain?: GainNode;
  private mediaRecorder?: MediaRecorder;
  private captureError?: Error;
  private captureStartedAt?: number;
  private captureDurationMs = 0;
  private captureStartOffsetMs = 0;
  private chunks: Blob[] = [];
  private completed?: Promise<SessionAudioRecording | null>;
  private finishCapture?: (recording: SessionAudioRecording | null) => void;
  private playbackReady = false;
  private initialMediaReady = false;
  private initialStartedEmitted = false;
  private startupDiagnosticSink?: (stage: StartupStage) => void;
  private outputBlocked = false;
  private turnDetector?: MicrophoneTurnDetector;
  private voiceActivity: VoiceActivity = "unavailable";
  private voiceListeners: (() => void)[] = [];
  // The single record of "this attempt is over", set by stopMedia(). Late
  // callbacks and resolved awaits check it instead of tracking their own flags.
  private abort = new AbortController();
  constructor(
    private audio: HTMLAudioElement,
    private microphoneDiagnostics = false,
    private onVoiceActivity?: (activity: VoiceActivity) => void,
    private experiment?: "transcript-state-steering",
  ) {}

  /** UI feedback uses local media and playback gates, never transcript arrival. */
  private reportVoiceActivity = () => {
    const source = this.current;
    let activity: VoiceActivity = "unavailable";
    if (!this.cancelled && source?.sessionStarted && this.authoritative(source)) {
      const microphoneOpen = this.mic
        ?.getAudioTracks()
        .some(track => track.readyState === "live" && track.enabled && !track.muted);
      const playbackSilent = this.outputBlocked || this.audio.muted || this.audio.paused || this.audio.volume === 0;
      if (this.playbackReady && !playbackSilent && source.activity.state === "active") activity = "speaking";
      else if (
        microphoneOpen &&
        (this.outputBlocked || (this.playbackReady && (playbackSilent || source.activity.state === "quiet")))
      )
        activity = "listening";
    }
    if (activity === this.voiceActivity) return;
    this.voiceActivity = activity;
    this.onVoiceActivity?.(activity);
  };

  private watchVoiceMedia(target: EventTarget, events: string[]) {
    if (!this.onVoiceActivity) return;
    for (const event of events) {
      target.addEventListener(event, this.reportVoiceActivity);
      this.voiceListeners.push(() => target.removeEventListener(event, this.reportVoiceActivity));
    }
  }

  private diagnosticSink?: (event: MicrophoneDiagnostic) => void;

  setMicrophoneDiagnosticSink(sink: (event: MicrophoneDiagnostic) => void) {
    if (this.microphoneDiagnostics && !this.cancelled) this.diagnosticSink = sink;
  }

  setStartupDiagnosticSink(sink: (stage: StartupStage) => void) {
    if (!this.cancelled) this.startupDiagnosticSink = sink;
  }

  private startup(stage: StartupStage) {
    if (!this.cancelled) this.startupDiagnosticSink?.(stage);
  }

  private publishInitialReady(source: LiveSource) {
    if (
      this.initialStartedEmitted ||
      !this.initialMediaReady ||
      !source.ready ||
      !source.sessionStarted ||
      source.channel?.readyState !== "open" ||
      !this.authoritative(source)
    )
      return;
    this.initialStartedEmitted = true;
    this.emit(source, { type: "session.started" });
  }

  get activeSourceId(): LiveSourceId | undefined {
    return this.current?.id;
  }

  private get cancelled() {
    return this.abort.signal.aborted;
  }

  async start(onEvent: (event: ProviderEvent) => void, onFailure: (message: string) => void) {
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection)
      throw new Error("Use a MacBook browser with microphone support, on localhost.");
    if (this.mic || this.onEvent || this.cancelled) throw new Error("Transport already started or ended");
    this.onEvent = onEvent;
    this.onFailure = onFailure;
    this.watchVoiceMedia(this.audio, ["playing", "pause", "volumechange", "emptied"]);
    this.audio.autoplay = true;
    this.startup("startup.media_started");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    if (this.cancelled) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    this.mic = stream;
    this.startup("startup.microphone_ready");
    for (const track of stream.getAudioTracks()) this.watchVoiceMedia(track, ["mute", "unmute", "ended"]);
    if (this.microphoneDiagnostics) {
      const track = stream.getAudioTracks()[0];
      if (track) this.diagnosticSink?.({ type: "microphone.track_settings", detail: microphoneTrackSettings(track) });
    }
    for (const track of stream.getAudioTracks()) {
      track.onended = () => {
        if (!this.cancelled) onFailure("The microphone stopped. Check microphone access and start a new lesson.");
      };
    }
    const source = this.createSource();
    this.current = source;
    this.emit(source, source.activity);
    if (!this.live(source)) return;
    // The microphone is required for the SDP offer. Recording resume and VAD
    // setup are independent of network setup, so neither serializes the other.
    await Promise.all([this.setupMedia(stream, onEvent), this.connectSource(source)]);
    if (!this.live(source)) return;
    this.initialMediaReady = true;
    this.publishInitialReady(source);
  }

  private async setupMedia(stream: MediaStream, onEvent: (event: ProviderEvent) => void) {
    try {
      if (typeof MediaRecorder === "undefined") throw new Error("MediaRecorder is unavailable");
      this.context = new AudioContext();
      this.mix = this.context.createMediaStreamDestination();
      const source = this.context.createMediaStreamSource(stream);
      this.sources.push(source);
      source.connect(this.mix);
      this.remoteGain = this.context.createGain();
      this.remoteGain.gain.value = 0;
      this.remoteGain.connect(this.mix);
      await this.context.resume();
      if (this.cancelled) {
        this.releaseMix();
        return;
      }
      if (this.context.state !== "running") throw new Error("Recording AudioContext did not start");
      this.context.onstatechange = () => {
        if (!this.cancelled && this.captureStartedAt !== undefined && this.context?.state !== "running")
          this.captureError = new Error("Recording AudioContext stopped running");
      };
    } catch (error) {
      this.captureError = error instanceof Error ? error : new Error("Audio mix initialization failed");
      this.releaseMix();
    }
    if (this.cancelled) return;
    try {
      this.turnDetector = new MicrophoneTurnDetector(
        stream,
        event => {
          if (!this.cancelled) onEvent(event);
        },
        this.microphoneDiagnostics
          ? detail => {
              if (!this.cancelled) this.diagnosticSink?.({ type: "microphone.detector_window", detail });
            }
          : undefined,
      );
    } catch {
      // Transcript fallback remains available on browsers without Web Audio.
      if (this.microphoneDiagnostics && !this.cancelled)
        this.diagnosticSink?.({
          type: "microphone.detector_unavailable",
          detail: { reason: "web_audio_initialization_failed" },
        });
    }
    this.startup("startup.media_ready");
  }

  private live(source: LiveSource) {
    return !this.cancelled && !source.retired;
  }

  private authoritative(source: LiveSource) {
    return this.live(source) && this.current === source;
  }

  private emit(source: LiveSource, event: ProviderEvent) {
    if (this.authoritative(source)) {
      this.onEvent?.({
        ...event,
        sourceId: source.id,
        ...(event.type === "transcript" && source.requestedAt !== undefined
          ? { sourceRequestedAt: source.requestedAt }
          : {}),
      });
      this.reportVoiceActivity();
    }
  }

  private fail(source: LiveSource, message: string) {
    if (this.authoritative(source)) this.onFailure?.(message);
    else if (this.live(source)) {
      this.retireSource(source.id);
    }
  }

  private createSource(): LiveSource {
    const source: LiveSource = {
      id: ++this.nextSourceId,
      abort: new AbortController(),
      peer: new RTCPeerConnection(),
      ready: false,
      sessionStarted: false,
      retired: false,
      activity: { type: "output.activity", state: "unavailable" },
    };
    this.connections.set(source.id, source);
    return source;
  }

  /** Invoke the application fence before enabling any source input. Each cloned
   * track has supplied only silence since attachment, including during warmup. */
  openInput(fence: (sourceId: number) => void): boolean {
    const source = this.current;
    if (!source || !this.authoritative(source) || !source.inputTracks?.length) return false;
    if (source.inputOpened) return true;
    fence(source.id);
    source.inputOpened = true;
    for (const track of source.inputTracks) track.enabled = true;
    return true;
  }

  /** Invalidate authority before teardown callbacks, then stop all media and
   * close the connection so this source cannot keep receiving microphone audio. */
  retireSource(id: LiveSourceId) {
    const source = this.connections.get(id);
    if (!source || source.retired) return;
    source.retired = true;
    const wasCurrent = this.current === source;
    if (wasCurrent) this.current = undefined;
    if (wasCurrent) {
      this.playbackReady = false;
      this.audio.muted = true;
      this.audio.pause();
      this.audio.srcObject = null;
      this.syncRecordingGate();
    }
    this.reportVoiceActivity();
    source.abort.abort();
    source.observer?.close();
    source.recordingSource?.disconnect();
    source.remote?.getTracks().forEach(track => track.stop());
    source.inputTracks?.forEach(track => track.stop());
    source.channel?.close();
    source.peer.close();
    this.connections.delete(source.id);
  }

  private attachPlayback(source: LiveSource) {
    const remote = source.remote;
    if (!remote || !this.authoritative(source) || source.outputDiscarded) return;
    this.audio.muted = this.outputBlocked;
    this.audio.srcObject = remote;
    this.playbackReady = false;
    this.syncRecordingGate();
    this.reportVoiceActivity();
    try {
      if (this.context && this.remoteGain) {
        source.recordingSource = this.context.createMediaStreamSource(remote);
        source.recordingSource.connect(this.remoteGain);
      }
    } catch {
      this.captureError = new Error("Remote audio could not join the recording mix");
    }
    void this.audio
      .play()
      .then(() => {
        if (this.authoritative(source) && source.remote === remote && !source.outputDiscarded) {
          this.playbackReady = true;
          this.syncRecordingGate();
          this.reportVoiceActivity();
        }
      })
      .catch(() => {
        if (source.remote === remote && !source.outputDiscarded)
          this.fail(
            source,
            "The browser blocked Sprout's voice playback. Allow sound for this site, then start a new lesson.",
          );
      });
  }

  private async connectSource(source: LiveSource) {
    this.startup("startup.live_connection_started");
    const peer = source.peer;
    peer.ontrack = ({ track }) => {
      if (!this.live(source) || source.outputDiscarded) {
        track.stop();
        return;
      }
      source.observer?.close();
      source.recordingSource?.disconnect();
      source.recordingSource = undefined;
      source.remote?.getTracks().forEach(oldTrack => oldTrack.stop());
      source.activity = { type: "output.activity", state: "unavailable" };
      this.emit(source, source.activity);
      if (!this.live(source) || source.outputDiscarded) {
        track.stop();
        return;
      }
      const remote = (source.remote = new MediaStream([track]));
      try {
        source.observer = new OutputActivityObserver(remote, event => {
          if (this.live(source) && source.remote === remote && !source.outputDiscarded) {
            source.activity = event;
            this.emit(source, event);
          }
        });
      } catch {
        this.emit(source, source.activity);
      }
      if (this.authoritative(source)) this.attachPlayback(source);
    };
    peer.onconnectionstatechange = () => {
      if (["failed", "disconnected", "closed"].includes(peer.connectionState))
        this.fail(source, "The voice connection was lost. This attempt has ended; you can start a new lesson.");
    };
    // The original microphone remains available to recording and local VAD.
    // Pending sources must never accumulate child input before promotion.
    source.inputTracks = this.mic!.getAudioTracks().map(track => {
      const input = track.clone();
      input.enabled = false;
      peer.addTrack(input, this.mic!);
      return input;
    });
    const channel = (source.channel = peer.createDataChannel("oai-events"));
    channel.onmessage = ({ data }) => {
      if (!this.live(source)) return;
      let raw: unknown;
      try {
        raw = JSON.parse(data);
      } catch {
        this.fail(source, "Sprout received an unreadable voice event. Please start a new lesson.");
        return;
      }
      const event = parseProviderEvent(raw);
      if (
        this.authoritative(source) &&
        typeof raw === "object" &&
        raw !== null &&
        "type" in raw &&
        typeof raw.type === "string" &&
        raw.type.startsWith("session.output")
      )
        this.startup("startup.first_provider_output");
      if (event?.type === "session.started") source.sessionStarted = true;
      if (event?.type === "session.started") {
        this.startup("startup.provider_session_started");
        this.publishInitialReady(source);
        return;
      }
      if (event) this.emit(source, event);
    };
    channel.onerror = () => this.fail(source, "The voice connection reported an error. Please start a new lesson.");
    channel.onclose = () => this.fail(source, "The voice connection closed. Please start a new lesson.");
    channel.onopen = () => this.publishInitialReady(source);
    const offer = await peer.createOffer();
    if (!this.live(source)) return;
    this.startup("startup.offer_ready");
    await peer.setLocalDescription(offer);
    if (!this.live(source)) return;
    await this.gatherIce(peer, source.abort.signal);
    if (!this.live(source)) return;
    this.startup("startup.ice_ready");
    const sdp = peer.localDescription?.sdp;
    if (!sdp) throw new Error("The browser could not prepare its microphone connection.");
    this.startup("startup.provider_request_started");
    source.requestedAt = performance.now();
    const response = await fetch("/api/live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sdp, ...(this.experiment ? { experiment: this.experiment } : {}) }),
      signal: source.abort.signal,
    });
    if (!this.live(source)) return;
    this.startup("startup.provider_response_received");
    const body: unknown = await response.json().catch(() => null);
    if (!this.live(source)) return;
    if (!response.ok) throw new Error(serverError(body) ?? "Sprout could not connect to the voice service.");
    const answer = parseSessionAnswer(body);
    if (!answer) throw new Error("The voice service returned an unusable connection answer.");
    await peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
    if (this.live(source)) {
      source.ready = true;
      this.startup("startup.remote_description_applied");
      this.publishInitialReady(source);
    }
  }

  private gatherIce(peer: RTCPeerConnection, signal: AbortSignal): Promise<void> {
    if (peer.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        peer.removeEventListener("icegatheringstatechange", check);
        signal.removeEventListener("abort", cancel);
        if (error) reject(error);
        else resolve();
      };
      const check = () => {
        if (peer.iceGatheringState === "complete") finish();
      };
      const cancel = () => finish(new Error("Connection setup ended."));
      const timer = setTimeout(
        () => finish(new Error("Microphone connection setup timed out. Please try again.")),
        10_000,
      );
      peer.addEventListener("icegatheringstatechange", check);
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
      else check();
    });
  }

  send(command: ClientCommand) {
    const source = this.current;
    if (!source || !this.authoritative(source) || source.channel?.readyState !== "open")
      throw new Error("Channel unavailable");
    source.channel.send(JSON.stringify(command));
  }

  /** Permanently discard this source's decoded/buffered output. Keep its
   * microphone and data channel alive for answer revisions until replacement.
   * This is local isolation, not a provider cancellation acknowledgment. */
  discardOutput(): boolean {
    const source = this.current;
    if (!source || !this.authoritative(source)) return false;
    source.outputDiscarded = true; // Invalidate late track/play/observer callbacks first.
    this.outputBlocked = true;
    this.playbackReady = false;
    this.audio.muted = true;
    this.audio.pause();
    this.audio.srcObject = null;
    this.syncRecordingGate();
    source.observer?.close();
    source.recordingSource?.disconnect();
    source.remote?.getTracks().forEach(track => track.stop());
    source.activity = { type: "output.activity", state: "unavailable" };
    this.reportVoiceActivity();
    return true;
  }

  setOutputBlocked(blocked: boolean) {
    if (!this.cancelled) {
      this.outputBlocked = blocked;
      // Muting does not clear the receiver's jitter/decoder buffers, nor
      // isolate the next provider response. The track stays live.
      this.audio.muted = blocked || !this.current || this.current.outputDiscarded === true;
      this.syncRecordingGate();
      this.reportVoiceActivity();
    }
  }

  private syncRecordingGate() {
    if (this.remoteGain)
      this.remoteGain.gain.value =
        !!this.current && this.authoritative(this.current) && this.playbackReady && !this.outputBlocked ? 1 : 0;
  }

  startRecording(canonicalClockOrigin?: number) {
    if (this.captureStartedAt !== undefined || this.cancelled) return;
    if (this.captureError) throw this.captureError;
    if (!this.mix) throw new Error("Recording mix is unavailable");
    const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find(type =>
      MediaRecorder.isTypeSupported?.(type),
    );
    const recorder = new MediaRecorder(this.mix.stream, mimeType ? { mimeType } : undefined);
    this.mediaRecorder = recorder;
    this.completed = new Promise(resolve => {
      this.finishCapture = resolve;
    });
    recorder.ondataavailable = event => {
      if (event.data.size) this.chunks.push(event.data);
    };
    recorder.onerror = () => {
      this.captureError = new Error("Session audio recorder failed");
    };
    recorder.onstop = () => {
      if (!this.cancelled) this.captureError = new Error("Session audio recorder stopped unexpectedly");
      const blob = new Blob(this.chunks, { type: this.chunks[0]?.type || recorder.mimeType });
      this.chunks = [];
      if (!blob.size || !blob.type) this.captureError ??= new Error("Session audio recording is empty or unusable");
      this.finishCapture?.(
        this.captureError
          ? null
          : {
              blob,
              mimeType: blob.type,
              startOffsetMs: this.captureStartOffsetMs,
              durationMs: this.captureDurationMs,
            },
      );
      recorder.ondataavailable = recorder.onerror = recorder.onstop = null;
    };
    this.captureStartedAt = performance.now();
    this.captureStartOffsetMs =
      canonicalClockOrigin === undefined ? 0 : Math.max(0, Math.floor(this.captureStartedAt - canonicalClockOrigin));
    try {
      recorder.start();
    } catch (error) {
      this.captureError = error instanceof Error ? error : new Error("Recording failed to start");
      this.finishCapture?.(null);
      recorder.ondataavailable = recorder.onerror = recorder.onstop = null;
      throw this.captureError;
    }
  }

  async recording(): Promise<SessionAudioRecording | null> {
    const recording = await this.completed;
    if (this.captureError) throw this.captureError;
    return recording ?? null;
  }

  private releaseMix() {
    this.sources.forEach(source => source.disconnect());
    this.sources = [];
    this.remoteGain?.disconnect();
    this.remoteGain = undefined;
    this.mix?.disconnect();
    this.mix?.stream.getTracks().forEach(track => track.stop());
    this.mix = undefined;
    if (this.context) {
      this.context.onstatechange = null;
      void this.context.close().catch(() => {});
      this.context = undefined;
    }
  }

  stopMedia() {
    if (this.cancelled) return;
    this.abort.abort();
    this.reportVoiceActivity();
    this.voiceListeners.forEach(remove => remove());
    this.voiceListeners = [];
    this.diagnosticSink = undefined;
    this.startupDiagnosticSink = undefined;
    for (const source of this.connections.values()) this.retireSource(source.id);
    this.audio.muted = true;
    if (this.audio.srcObject) this.audio.pause();
    this.audio.srcObject = null;
    this.syncRecordingGate();
    if (this.captureStartedAt !== undefined) this.captureDurationMs = performance.now() - this.captureStartedAt;
    try {
      if (this.mediaRecorder?.state !== "inactive") this.mediaRecorder?.stop();
    } catch {
      this.captureError = new Error("Session audio could not finish");
      this.finishCapture?.(null);
    }
    this.releaseMix();
    this.turnDetector?.close();
    this.mic?.getTracks().forEach(track => track.stop());
    this.audio.muted = false;
  }

  close() {
    this.stopMedia();
  }
}
