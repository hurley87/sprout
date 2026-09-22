import type { LiveEvent, Transport } from "./session";

export class BrowserTransport implements Transport {
  private peer?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private mic?: MediaStream;
  private remote?: MediaStream;
  private abort = new AbortController();
  private stopped = false;
  private closing = false;
  constructor(private audio: HTMLAudioElement) {}

  async start(onEvent: (event: LiveEvent) => void, onFailure: (message: string) => void) {
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw new Error("Use a MacBook browser with microphone support, on localhost.");
    this.audio.autoplay = true;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    if (this.stopped) { stream.getTracks().forEach(track => track.stop()); return; }
    this.mic = stream;
    const peer = new RTCPeerConnection();
    this.peer = peer;
    peer.ontrack = ({ track }) => {
      if (this.stopped) { track.stop(); return; }
      this.remote = new MediaStream([track]);
      this.audio.srcObject = this.remote;
      void this.audio.play().catch(() => {
        if (!this.stopped) onFailure("The browser blocked Sprout's voice playback. Allow sound for this site, then start a new lesson.");
      });
    };
    peer.onconnectionstatechange = () => {
      if (!this.closing && ["failed", "disconnected", "closed"].includes(peer.connectionState)) onFailure("The voice connection was lost. This attempt has ended; you can start a new lesson.");
    };
    for (const track of stream.getAudioTracks()) {
      track.onended = () => { if (!this.stopped) onFailure("The microphone stopped. Check microphone access and start a new lesson."); };
      peer.addTrack(track, stream);
    }
    const channel = peer.createDataChannel("oai-events");
    this.channel = channel;
    channel.onmessage = ({ data }) => {
      try {
        const event: unknown = JSON.parse(data);
        if (event && typeof event === "object" && "type" in event && typeof event.type === "string") onEvent(event as LiveEvent);
      } catch { onFailure("Sprout received an unreadable voice event. Please start a new lesson."); }
    };
    channel.onerror = () => { if (!this.closing) onFailure("The voice connection reported an error. Please start a new lesson."); };
    channel.onclose = () => { if (!this.closing) onFailure("The voice connection closed. Please start a new lesson."); };
    const offer = await peer.createOffer();
    if (this.stopped) return;
    await peer.setLocalDescription(offer);
    await this.gatherIce(peer);
    if (this.stopped) return;
    const sdp = peer.localDescription?.sdp;
    if (!sdp) throw new Error("The browser could not prepare its microphone connection.");
    const response = await fetch("/api/live", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sdp }), signal: this.abort.signal,
    });
    if (this.stopped) return;
    const result = await response.json();
    if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Sprout could not connect to the voice service.");
    if (this.stopped) return;
    await peer.setRemoteDescription({ type: "answer", sdp: result.transport.sdp });
  }

  private gatherIce(peer: RTCPeerConnection): Promise<void> {
    if (peer.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        peer.removeEventListener("icegatheringstatechange", check);
        this.abort.signal.removeEventListener("abort", cancel);
        if (error) reject(error); else resolve();
      };
      const check = () => { if (peer.iceGatheringState === "complete") finish(); };
      const cancel = () => finish(new Error("Connection setup ended."));
      const timer = setTimeout(() => finish(new Error("Microphone connection setup timed out. Please try again.")), 10_000);
      peer.addEventListener("icegatheringstatechange", check);
      this.abort.signal.addEventListener("abort", cancel, { once: true });
      if (this.abort.signal.aborted) cancel(); else check();
    });
  }

  send(event: LiveEvent) {
    if (this.channel?.readyState !== "open") throw new Error("Channel unavailable");
    this.channel.send(JSON.stringify(event));
  }
  stopMedia() {
    this.stopped = true;
    this.closing = true;
    this.abort.abort();
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
