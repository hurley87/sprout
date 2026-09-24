import { parseProviderEvent, parseSessionAnswer, type ClientCommand, type ProviderEvent } from "./events";
import type { Transport } from "./session";
import { MicrophoneTurnDetector } from "./microphone-turn";

const serverError = (body: unknown) =>
  typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
    ? body.error
    : undefined;

export class BrowserTransport implements Transport {
  private peer?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private mic?: MediaStream;
  private remote?: MediaStream;
  private turnDetector?: MicrophoneTurnDetector;
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
      this.turnDetector = new MicrophoneTurnDetector(stream, type => {
        if (!this.cancelled) onEvent({ type });
      });
    } catch {
      // Transcript fallback remains available on browsers without Web Audio.
    }
    const peer = new RTCPeerConnection();
    this.peer = peer;
    peer.ontrack = ({ track }) => {
      if (this.cancelled) {
        track.stop();
        return;
      }
      this.remote = new MediaStream([track]);
      this.audio.srcObject = this.remote;
      void this.audio.play().catch(() => {
        if (!this.cancelled)
          onFailure("The browser blocked Sprout's voice playback. Allow sound for this site, then start a new lesson.");
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

  stopMedia() {
    this.abort.abort();
    this.turnDetector?.close();
    this.mic?.getTracks().forEach(track => track.stop());
    this.remote?.getTracks().forEach(track => track.stop());
    this.audio.pause();
    this.audio.srcObject = null;
  }

  close() {
    this.stopMedia();
    this.channel?.close();
    this.peer?.close();
  }
}
