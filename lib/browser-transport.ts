import { parseProviderEvent, parseSessionAnswer, type ClientCommand, type ProviderEvent } from "./events";
import type { SessionAudioRecording } from "./session-recorder";
import type { Transport } from "./session";
import { MicrophoneTurnDetector } from "./microphone-turn";
import { OutputActivityObserver } from "./output-activity";

const serverError = (body: unknown) =>
  typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
    ? body.error
    : undefined;

/** Application-owned identity; provider event IDs never select authority. */
export type LiveSourceId = number;

type LiveSource = {
  id: LiveSourceId;
  abort: AbortController;
  peer: RTCPeerConnection;
  channel?: RTCDataChannel;
  remote?: MediaStream;
  observer?: OutputActivityObserver;
  recordingSource?: MediaStreamAudioSourceNode;
  ready: boolean;
  retired: boolean;
  activity: Extract<ProviderEvent, { type: "output.activity" }>;
};

export class BrowserTransport implements Transport {
  private nextSourceId = 0;
  private connections = new Map<LiveSourceId, LiveSource>();
  private current?: LiveSource;
  private pending?: LiveSource;
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
  private chunks: Blob[] = [];
  private completed?: Promise<SessionAudioRecording | null>;
  private finishCapture?: (recording: SessionAudioRecording | null) => void;
  private playbackReady = false;
  private outputBlocked = false;
  private closed = false;
  private turnDetector?: MicrophoneTurnDetector;
  // The single record of "this attempt is over", set by stopMedia(). Late
  // callbacks and resolved awaits check it instead of tracking their own flags.
  private abort = new AbortController();
  constructor(private audio: HTMLAudioElement) {}

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
      this.turnDetector = new MicrophoneTurnDetector(stream, event => {
        if (!this.cancelled) onEvent(event);
      });
    } catch {
      // Transcript fallback remains available on browsers without Web Audio.
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
    await this.connectSource(source);
  }

  private live(source: LiveSource) {
    return !this.cancelled && !source.retired;
  }

  private authoritative(source: LiveSource) {
    return this.live(source) && this.current === source;
  }

  private emit(source: LiveSource, event: ProviderEvent) {
    if (this.authoritative(source)) this.onEvent?.(event);
  }

  private fail(source: LiveSource, message: string) {
    if (this.authoritative(source)) this.onFailure?.(message);
    else if (this.live(source)) this.retireSource(source.id);
  }

  private createSource(): LiveSource {
    const source: LiveSource = {
      id: ++this.nextSourceId,
      abort: new AbortController(),
      peer: new RTCPeerConnection(),
      ready: false,
      retired: false,
      activity: { type: "output.activity", state: "unavailable" },
    };
    this.connections.set(source.id, source);
    return source;
  }

  /** Signalling readiness is not application playback permission. Pending
   * media is observed but never attached to the audio element or recording. */
  async prepareReplacement(): Promise<LiveSourceId> {
    if (this.cancelled || !this.mic || !this.onEvent) throw new Error("Transport unavailable");
    if (this.pending) throw new Error("Replacement already pending");
    const source = this.createSource();
    this.pending = source;
    try {
      await this.connectSource(source);
      if (!this.live(source)) throw new Error("Replacement setup ended");
      return source.id;
    } catch (error) {
      this.retireSource(source.id);
      this.closeSource(source);
      throw error;
    }
  }

  activateSource(id: LiveSourceId): boolean {
    const source = this.connections.get(id);
    if (!source || !this.live(source) || !source.ready || source !== this.pending) return false;
    // Block first, invalidate/detach old authority, then install new authority.
    this.outputBlocked = true;
    this.audio.muted = true;
    this.syncRecordingGate();
    if (this.current) this.retireSource(this.current.id);
    if (!this.live(source)) return false;
    this.pending = undefined;
    this.current = source;
    this.emit(source, source.activity);
    if (this.authoritative(source) && source.remote) this.attachPlayback(source);
    return this.authoritative(source);
  }

  /** Invalidate before any abort, media or observer callbacks. Network close
   * remains separate, like stopMedia()/close(), until lesson-wide close(). */
  retireSource(id: LiveSourceId) {
    const source = this.connections.get(id);
    if (!source || source.retired) return;
    source.retired = true;
    const wasCurrent = this.current === source;
    if (wasCurrent) this.current = undefined;
    if (this.pending === source) this.pending = undefined;
    source.abort.abort();
    if (wasCurrent) {
      this.playbackReady = false;
      this.audio.muted = true;
      this.audio.pause();
      this.audio.srcObject = null;
      this.syncRecordingGate();
    }
    source.observer?.close();
    source.recordingSource?.disconnect();
    source.remote?.getTracks().forEach(track => track.stop());
  }

  private attachPlayback(source: LiveSource) {
    const remote = source.remote;
    if (!remote || !this.authoritative(source)) return;
    this.audio.muted = this.outputBlocked;
    this.audio.srcObject = remote;
    this.playbackReady = false;
    this.syncRecordingGate();
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
        if (this.authoritative(source) && source.remote === remote) {
          this.playbackReady = true;
          this.syncRecordingGate();
        }
      })
      .catch(() => {
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
      source.recordingSource?.disconnect();
      source.recordingSource = undefined;
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
    for (const track of this.mic!.getAudioTracks()) peer.addTrack(track, this.mic!);
    const channel = (source.channel = peer.createDataChannel("oai-events"));
    channel.onmessage = ({ data }) => {
      if (!this.authoritative(source)) return;
      let raw: unknown;
      try {
        raw = JSON.parse(data);
      } catch {
        this.fail(source, "Sprout received an unreadable voice event. Please start a new lesson.");
        return;
      }
      const event = parseProviderEvent(raw);
      if (event) this.emit(source, event);
    };
    channel.onerror = () => this.fail(source, "The voice connection reported an error. Please start a new lesson.");
    channel.onclose = () => this.fail(source, "The voice connection closed. Please start a new lesson.");
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
      body: JSON.stringify({ sdp }),
      signal: source.abort.signal,
    });
    if (!this.live(source)) return;
    const body: unknown = await response.json().catch(() => null);
    if (!this.live(source)) return;
    if (!response.ok) throw new Error(serverError(body) ?? "Sprout could not connect to the voice service.");
    const answer = parseSessionAnswer(body);
    if (!answer) throw new Error("The voice service returned an unusable connection answer.");
    await peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
    if (this.live(source)) source.ready = true;
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

  setOutputBlocked(blocked: boolean) {
    if (!this.cancelled) {
      this.outputBlocked = blocked;
      // Muting does not clear the receiver's jitter/decoder buffers, nor
      // isolate the next provider response. The track stays live.
      this.audio.muted = blocked || !this.current;
      this.syncRecordingGate();
    }
  }

  private syncRecordingGate() {
    if (this.remoteGain)
      this.remoteGain.gain.value =
        !!this.current && this.authoritative(this.current) && this.playbackReady && !this.outputBlocked ? 1 : 0;
  }

  startRecording() {
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
              startOffsetMs: 0,
              durationMs: this.captureDurationMs,
            },
      );
      recorder.ondataavailable = recorder.onerror = recorder.onstop = null;
    };
    this.captureStartedAt = performance.now();
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

  private closeSource(source: LiveSource) {
    if (!this.connections.has(source.id)) return;
    source.channel?.close();
    source.peer.close();
    this.connections.delete(source.id);
  }

  close() {
    this.stopMedia();
    if (this.closed) return;
    this.closed = true;
    for (const source of this.connections.values()) this.closeSource(source);
  }
}
