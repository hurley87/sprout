import type { MicrophoneEvent } from "./events";

/** Quiet audio required before the local microphone detector signals speech stop. */
export const MICROPHONE_QUIET_MS = 900;
/** Sustained microphone energy required before activity becomes confirmed speech. */
export const MICROPHONE_ONSET_MS = 80;
/** Quiet needed to discard an unconfirmed microphone burst. */
export const MICROPHONE_ONSET_QUIET_MS = 150;

export type MicrophoneMeasurement = {
  frames: number;
  rmsMin: number;
  rmsMean: number;
  rmsMax: number;
  threshold: number;
  noiseFloor: number;
  aboveThresholdFrames: number;
  candidate: boolean;
  confirmed: boolean;
  quietMs: number;
  quietResets: number;
  longestResetQuietMs: number;
  maxFrameGapMs: number;
  frameGapsOver100Ms: number;
  audioContextState: AudioContextState;
};

const MEASUREMENT_WINDOW_MS = 250;

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
  private lastFrameAt?: number;
  private windowStartedAt?: number;
  private windowFrames = 0;
  private rmsSum = 0;
  private rmsMin = Infinity;
  private rmsMax = 0;
  private aboveThresholdFrames = 0;
  private quietResets = 0;
  private longestResetQuietMs = 0;
  private maxFrameGapMs = 0;
  private frameGapsOver100Ms = 0;
  private lastThreshold = 0.015;

  constructor(
    stream: MediaStream,
    private emit: (event: MicrophoneEvent) => void,
    private measure?: (measurement: MicrophoneMeasurement) => void,
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
    const threshold = Math.max(0.015, this.noiseFloor * 3);
    const voice = rms > threshold;
    if (this.measure) {
      this.lastThreshold = threshold;
      this.windowStartedAt ??= now;
      this.windowFrames++;
      this.rmsSum += rms;
      this.rmsMin = Math.min(this.rmsMin, rms);
      this.rmsMax = Math.max(this.rmsMax, rms);
      if (voice) this.aboveThresholdFrames++;
      if (this.lastFrameAt !== undefined) {
        const gap = Math.max(0, now - this.lastFrameAt);
        this.maxFrameGapMs = Math.max(this.maxFrameGapMs, gap);
        if (gap > 100) this.frameGapsOver100Ms++;
      }
      this.lastFrameAt = now;
      if (voice && this.quietSince) {
        this.quietResets++;
        this.longestResetQuietMs = Math.max(this.longestResetQuietMs, now - this.quietSince);
      }
    }
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
    if (this.measure && now - this.windowStartedAt! >= MEASUREMENT_WINDOW_MS) {
      this.measure({
        frames: this.windowFrames,
        rmsMin: this.rmsMin,
        rmsMean: this.rmsSum / this.windowFrames,
        rmsMax: this.rmsMax,
        threshold: this.lastThreshold,
        noiseFloor: this.noiseFloor,
        aboveThresholdFrames: this.aboveThresholdFrames,
        candidate: this.candidate,
        confirmed: this.active,
        quietMs: this.quietSince ? now - this.quietSince : 0,
        quietResets: this.quietResets,
        longestResetQuietMs: this.longestResetQuietMs,
        maxFrameGapMs: this.maxFrameGapMs,
        frameGapsOver100Ms: this.frameGapsOver100Ms,
        audioContextState: this.context.state,
      });
      this.windowStartedAt = now;
      this.windowFrames = 0;
      this.rmsSum = 0;
      this.rmsMin = Infinity;
      this.rmsMax = 0;
      this.aboveThresholdFrames = 0;
      this.quietResets = 0;
      this.longestResetQuietMs = 0;
      this.maxFrameGapMs = 0;
      this.frameGapsOver100Ms = 0;
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
