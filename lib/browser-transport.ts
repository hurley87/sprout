import { parseProviderEvent, parseSessionAnswer, type ClientCommand, type ProviderEvent } from "./events";
import { MicrophoneTurnDetector, type MicrophoneMeasurement } from "./microphone-turn";
import { OutputActivityObserver } from "./output-activity";

const serverError = (body: unknown) =>
  typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
    ? body.error
    : undefined;

/** Application-owned identity; provider event IDs never select authority. */
export type LiveSourceId = number;

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
  inputTracks?: MediaStreamTrack[];
  inputOpened?: boolean;
  ready: boolean;
  sessionStarted: boolean;
  retired: boolean;
  activity: Extract<ProviderEvent, { type: "output.activity" }>;
};

export class BrowserTransport {
  private current?: LiveSource;
  private onEvent?: (event: ProviderEvent) => void;
  private onFailure?: (message: string) => void;
  private mic?: MediaStream;
  private initialMediaReady = false;
  private initialStartedEmitted = false;
  private lessonId = "counting";
  private turnDetector?: MicrophoneTurnDetector;
  // The single record of "this attempt is over", set by close(). Late
  // callbacks and resolved awaits check it instead of tracking their own flags.
  private abort = new AbortController();
  constructor(
    private audio: HTMLAudioElement,
    private microphoneDiagnostics = false,
  ) {}

  private diagnosticSink?: (event: MicrophoneDiagnostic) => void;

  setMicrophoneDiagnosticSink(sink: (event: MicrophoneDiagnostic) => void) {
    if (this.microphoneDiagnostics && !this.cancelled) this.diagnosticSink = sink;
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

  async start(onEvent: (event: ProviderEvent) => void, onFailure: (message: string) => void, lessonId = "counting") {
    this.lessonId = lessonId;
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection)
      throw new Error("Use a MacBook browser with microphone support, on localhost.");
    if (this.mic || this.onEvent || this.cancelled) throw new Error("Transport already started or ended");
    this.onEvent = onEvent;
    this.onFailure = onFailure;
    this.audio.autoplay = true;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    if (this.cancelled) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    this.mic = stream;
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
    // Set up local VAD and the SDP connection before publishing readiness.
    await Promise.all([this.setupMedia(stream, onEvent), this.connectSource(source)]);
    if (!this.live(source)) return;
    this.initialMediaReady = true;
    this.publishInitialReady(source);
  }

  private async setupMedia(stream: MediaStream, onEvent: (event: ProviderEvent) => void) {
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
      // Without local VAD, the runtime cannot authorize a completed child turn.
      if (this.microphoneDiagnostics && !this.cancelled)
        this.diagnosticSink?.({
          type: "microphone.detector_unavailable",
          detail: { reason: "web_audio_initialization_failed" },
        });
    }
  }

  private live(source: LiveSource) {
    return !this.cancelled && !source.retired;
  }

  private authoritative(source: LiveSource) {
    return this.live(source) && this.current === source;
  }

  private emit(source: LiveSource, event: ProviderEvent) {
    if (this.authoritative(source)) {
      this.onEvent?.({ ...event, sourceId: source.id });
    }
  }

  private fail(source: LiveSource, message: string) {
    if (this.authoritative(source)) this.onFailure?.(message);
  }

  private createSource(): LiveSource {
    const source: LiveSource = {
      id: 1,
      abort: new AbortController(),
      peer: new RTCPeerConnection(),
      ready: false,
      sessionStarted: false,
      retired: false,
      activity: { type: "output.activity", state: "unavailable" },
    };
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
  private retireSource() {
    const source = this.current;
    if (!source || source.retired) return;
    source.retired = true;
    this.current = undefined;
    this.audio.muted = true;
    this.audio.pause();
    this.audio.srcObject = null;
    source.abort.abort();
    source.observer?.close();
    source.remote?.getTracks().forEach(track => track.stop());
    source.inputTracks?.forEach(track => track.stop());
    source.channel?.close();
    source.peer.close();
  }

  private attachPlayback(source: LiveSource) {
    const remote = source.remote;
    if (!remote || !this.authoritative(source)) return;
    this.audio.muted = false;
    this.audio.srcObject = remote;
    void this.audio.play().catch(() => {
      if (source.remote === remote)
        this.fail(
          source,
          "The browser blocked Sprout's voice playback. Allow sound for this site, then start a new lesson.",
        );
    });
  }

  private async connectSource(source: LiveSource) {
    const peer = source.peer;
    peer.ontrack = ({ track }) => {
      if (!this.live(source)) {
        track.stop();
        return;
      }
      source.observer?.close();
      source.remote?.getTracks().forEach(oldTrack => oldTrack.stop());
      source.activity = { type: "output.activity", state: "unavailable" };
      this.emit(source, source.activity);
      if (!this.live(source)) {
        track.stop();
        return;
      }
      const remote = (source.remote = new MediaStream([track]));
      try {
        source.observer = new OutputActivityObserver(remote, event => {
          if (this.live(source) && source.remote === remote) {
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
    // The original microphone feeds local VAD; provider input stays silent
    // until the runtime opens it after the initial scene is confirmed.
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
      if (event?.type === "session.started") source.sessionStarted = true;
      if (event?.type === "session.started") {
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
    await peer.setLocalDescription(offer);
    if (!this.live(source)) return;
    await this.gatherIce(peer, source.abort.signal);
    if (!this.live(source)) return;
    const sdp = peer.localDescription?.sdp;
    if (!sdp) throw new Error("The browser could not prepare its microphone connection.");
    const response = await fetch("/api/live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sdp, lessonId: this.lessonId }),
      signal: source.abort.signal,
    });
    if (!this.live(source)) return;
    const body: unknown = await response.json().catch(() => null);
    if (!this.live(source)) return;
    if (!response.ok) throw new Error(serverError(body) ?? "Sprout could not connect to the voice service.");
    const answer = parseSessionAnswer(body);
    if (!answer) throw new Error("The voice service returned an unusable connection answer.");
    await peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
    if (this.live(source)) {
      source.ready = true;
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

  close() {
    if (this.cancelled) return;
    this.abort.abort();
    this.diagnosticSink = undefined;
    this.retireSource();
    this.audio.muted = true;
    if (this.audio.srcObject) this.audio.pause();
    this.audio.srcObject = null;
    this.turnDetector?.close();
    this.mic?.getTracks().forEach(track => track.stop());
    this.audio.muted = false;
  }
}
