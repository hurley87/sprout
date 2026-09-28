import { parseProviderEvent, parseSessionAnswer, type ClientCommand, type ProviderEvent } from "./events";
import type { SessionAudioRecording } from "./session-recorder";
import type { Transport } from "./session";
import { MicrophoneTurnDetector } from "./microphone-turn";
import { OutputActivityObserver } from "./output-activity";

const serverError = (body: unknown) =>
  typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
    ? body.error
    : undefined;

export class BrowserTransport implements Transport {
  private peer?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private mic?: MediaStream;
  private remote?: MediaStream;
  private context?: AudioContext;
  private mix?: MediaStreamAudioDestinationNode;
  private sources: MediaStreamAudioSourceNode[] = [];
  private remoteGain?: GainNode;
  private remoteSource?: MediaStreamAudioSourceNode;
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
  private outputObserver?: OutputActivityObserver;
  // The single record of "this attempt is over", set by stopMedia(). Late
  // callbacks and resolved awaits check it instead of tracking their own flags.
  private abort = new AbortController();
  constructor(private audio: HTMLAudioElement) {}

  private get cancelled() {
    return this.abort.signal.aborted;
  }

  async start(onEvent: (event: ProviderEvent) => void, onFailure: (message: string) => void) {
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection)
      throw new Error("Use a MacBook browser with microphone support, on localhost.");
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
    const peer = new RTCPeerConnection();
    this.peer = peer;
    onEvent({ type: "output.activity", state: "unavailable" });
    if (this.cancelled) return;
    peer.ontrack = ({ track }) => {
      if (this.cancelled) {
        track.stop();
        return;
      }
      this.outputObserver?.close();
      this.outputObserver = undefined;
      onEvent({ type: "output.activity", state: "unavailable" });
      if (this.cancelled) {
        track.stop();
        return;
      }
      this.remoteSource?.disconnect();
      this.remote?.getTracks().forEach(oldTrack => oldTrack.stop());
      const remote = new MediaStream([track]);
      this.remote = remote;
      try {
        this.outputObserver = new OutputActivityObserver(remote, event => {
          if (!this.cancelled && this.remote === remote) onEvent(event);
        });
      } catch {
        // Observation failure never qualifies playback recovery.
        onEvent({ type: "output.activity", state: "unavailable" });
      }
      if (this.cancelled) return;
      this.audio.srcObject = this.remote;
      this.playbackReady = false;
      this.syncRecordingGate();
      try {
        if (this.context && this.remoteGain) {
          const source = this.context.createMediaStreamSource(this.remote);
          this.sources.push(source);
          source.connect(this.remoteGain);
          this.remoteSource = source;
        }
      } catch {
        this.captureError = new Error("Remote audio could not join the recording mix");
      }
      void this.audio
        .play()
        .then(() => {
          if (!this.cancelled && this.remote === remote) {
            this.playbackReady = true;
            this.syncRecordingGate();
          }
        })
        .catch(() => {
          if (!this.cancelled)
            onFailure(
              "The browser blocked Sprout's voice playback. Allow sound for this site, then start a new lesson.",
            );
        });
    };
    peer.onconnectionstatechange = () => {
      if (!this.cancelled && ["failed", "disconnected", "closed"].includes(peer.connectionState))
        onFailure("The voice connection was lost. This attempt has ended; you can start a new lesson.");
    };
    for (const track of stream.getAudioTracks()) {
      track.onended = () => {
        if (!this.cancelled) onFailure("The microphone stopped. Check microphone access and start a new lesson.");
      };
      peer.addTrack(track, stream);
    }
    const channel = peer.createDataChannel("oai-events");
    this.channel = channel;
    channel.onmessage = ({ data }) => {
      let raw: unknown;
      try {
        raw = JSON.parse(data);
      } catch {
        onFailure("Sprout received an unreadable voice event. Please start a new lesson.");
        return;
      }
      const event = parseProviderEvent(raw);
      if (event) onEvent(event);
    };
    channel.onerror = () => {
      if (!this.cancelled) onFailure("The voice connection reported an error. Please start a new lesson.");
    };
    channel.onclose = () => {
      if (!this.cancelled) onFailure("The voice connection closed. Please start a new lesson.");
    };
    const offer = await peer.createOffer();
    if (this.cancelled) return;
    await peer.setLocalDescription(offer);
    await this.gatherIce(peer);
    if (this.cancelled) return;
    const sdp = peer.localDescription?.sdp;
    if (!sdp) throw new Error("The browser could not prepare its microphone connection.");
    const response = await fetch("/api/live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sdp }),
      signal: this.abort.signal,
    });
    if (this.cancelled) return;
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(serverError(body) ?? "Sprout could not connect to the voice service.");
    const answer = parseSessionAnswer(body);
    if (!answer) throw new Error("The voice service returned an unusable connection answer.");
    if (this.cancelled) return;
    await peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
  }

  private gatherIce(peer: RTCPeerConnection): Promise<void> {
    if (peer.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        peer.removeEventListener("icegatheringstatechange", check);
        this.abort.signal.removeEventListener("abort", cancel);
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
      this.abort.signal.addEventListener("abort", cancel, { once: true });
      if (this.cancelled) cancel();
      else check();
    });
  }

  send(command: ClientCommand) {
    if (this.channel?.readyState !== "open") throw new Error("Channel unavailable");
    this.channel.send(JSON.stringify(command));
  }

  setOutputBlocked(blocked: boolean) {
    if (!this.cancelled) {
      this.outputBlocked = blocked;
      // Muting does not clear the receiver's jitter/decoder buffers, nor
      // isolate the next provider response. The track stays live.
      this.audio.muted = blocked;
      this.syncRecordingGate();
    }
  }

  private syncRecordingGate() {
    if (this.remoteGain)
      this.remoteGain.gain.value = !this.cancelled && this.playbackReady && !this.outputBlocked ? 1 : 0;
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
    this.audio.muted = true;
    this.audio.pause();
    this.audio.srcObject = null;
    this.outputObserver?.close();
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
    this.remote?.getTracks().forEach(track => track.stop());
    this.audio.muted = false;
  }

  close() {
    this.stopMedia();
    if (this.closed) return;
    this.closed = true;
    this.channel?.close();
    this.peer?.close();
  }
}
