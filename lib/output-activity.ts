import type { OutputActivityEvent } from "./events";

/** Observes decoded remote PCM independently of playback.
 * Energy is media activity, never response completion or delivery attribution.
 * No samples are retained. Missing/suspended media is unknown, not silence. */
export class OutputActivityObserver {
  private context: AudioContext;
  private source!: MediaStreamAudioSourceNode;
  private analyser!: AnalyserNode;
  private sink!: GainNode;
  private samples!: Float32Array<ArrayBuffer>;
  private timer?: ReturnType<typeof setInterval>;
  private state?: OutputActivityEvent["state"];
  private closed = false;

  constructor(
    stream: MediaStream,
    private emit: (event: OutputActivityEvent) => void,
  ) {
    this.context = new AudioContext();
    try {
      this.source = this.context.createMediaStreamSource(stream);
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.samples = new Float32Array(this.analyser.fftSize);
      this.sink = this.context.createGain();
      this.sink.gain.value = 0;
      this.source.connect(this.analyser);
      this.analyser.connect(this.sink);
      this.sink.connect(this.context.destination);
      this.context.onstatechange = this.sample;
      this.timer = setInterval(this.sample, 50);
      void this.context.resume().catch(() => this.report("unavailable"));
    } catch (error) {
      this.close();
      throw error;
    }
  }

  private report(state: OutputActivityEvent["state"]) {
    if (this.closed || state === this.state) return;
    this.state = state;
    this.emit({ type: "output.activity", state });
  }

  private sample = () => {
    if (this.closed) return;
    if (
      this.context.state !== "running" ||
      !this.source.mediaStream.getAudioTracks().some(track => track.readyState === "live" && !track.muted)
    ) {
      this.report("unavailable");
      return;
    }
    try {
      this.analyser.getFloatTimeDomainData(this.samples);
      let power = 0;
      for (const sample of this.samples) power += sample * sample;
      // Fixed energy floor, not speech recognition. Quiet can be an arbitrarily
      // long pause in the same response; even active PCM has no response ID.
      this.report(Math.sqrt(power / this.samples.length) > 0.005 ? "active" : "quiet");
    } catch {
      this.report("unavailable");
    }
  };

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.context.onstatechange = null;
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.sink?.disconnect();
    void this.context.close().catch(() => {});
  }
}
