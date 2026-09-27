import { MICROPHONE_ONSET_MS, MICROPHONE_ONSET_QUIET_MS, MICROPHONE_QUIET_MS } from "./answer";
import type { MicrophoneEvent } from "./events";

/** Local energy VAD. GPT-Live has no input-turn completion event. This watches
 * the already-authorized microphone, without recording or retaining samples. */
export class MicrophoneTurnDetector {
  private context: AudioContext;
  private source: MediaStreamAudioSourceNode;
  private analyser: AnalyserNode;
  private samples: Float32Array<ArrayBuffer>;
  private frame = 0;
  private active = false;
  private candidate = false;
  private candidateStartedAt = 0;
  private voicedMs = 0;
  private lastVoicedAt?: number;
  private candidateQuietSince = 0;
  private quietSince = 0;
  private noiseFloor = 0.003;
  private stopped = false;

  constructor(
    stream: MediaStream,
    private emit: (event: MicrophoneEvent) => void,
  ) {
    this.context = new AudioContext();
    this.source = this.context.createMediaStreamSource(stream);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.samples = new Float32Array(this.analyser.fftSize);
    this.source.connect(this.analyser);
    this.frame = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    if (this.stopped) return;
    this.analyser.getFloatTimeDomainData(this.samples);
    let power = 0;
    for (const sample of this.samples) power += sample * sample;
    const rms = Math.sqrt(power / this.samples.length);
    const voice = rms > Math.max(0.015, this.noiseFloor * 3);
    if (voice) {
      this.quietSince = 0;
      if (!this.active && !this.candidate) {
        this.candidate = true;
        this.candidateStartedAt = now;
        this.voicedMs = 0;
        this.emit({ type: "microphone.activity_started" });
      } else if (this.candidate && this.lastVoicedAt !== undefined) {
        this.voicedMs += Math.min(50, Math.max(0, now - this.lastVoicedAt));
      }
      this.lastVoicedAt = now;
      this.candidateQuietSince = 0;
      if (this.candidate && this.voicedMs >= MICROPHONE_ONSET_MS) {
        this.candidate = false;
        this.active = true;
        this.emit({ type: "microphone.speech_started" });
      }
    } else if (this.candidate) {
      // A quiet frame breaks sustained onset; do not count its gap when the
      // next loud burst arrives before the candidate is discarded.
      this.voicedMs = 0;
      this.lastVoicedAt = undefined;
      if (!this.candidateQuietSince) this.candidateQuietSince = now;
      else if (now - this.candidateQuietSince >= MICROPHONE_ONSET_QUIET_MS) {
        this.candidate = false;
        this.voicedMs = 0;
        this.lastVoicedAt = undefined;
        this.emit({ type: "microphone.activity_discarded" });
      }
    } else if (this.active) {
      if (!this.quietSince) this.quietSince = now;
      else if (now - this.quietSince >= MICROPHONE_QUIET_MS) {
        const quietMs = now - this.quietSince;
        this.active = false;
        this.quietSince = 0;
        this.emit({ type: "microphone.speech_stopped", quietMs });
      }
    } else {
      this.noiseFloor = this.noiseFloor * 0.98 + rms * 0.02;
    }
    // Intermittent bursts can satisfy neither sustained onset nor sustained quiet.
    // Bound arbitration with the existing detector thresholds, without a session delay.
    if (this.candidate && now - this.candidateStartedAt >= MICROPHONE_ONSET_MS + MICROPHONE_ONSET_QUIET_MS) {
      this.candidate = false;
      this.voicedMs = 0;
      this.lastVoicedAt = undefined;
      this.emit({ type: "microphone.activity_discarded" });
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  close() {
    if (this.stopped) return;
    this.stopped = true;
    cancelAnimationFrame(this.frame);
    this.source.disconnect();
    this.analyser.disconnect();
    void this.context.close();
  }
}
