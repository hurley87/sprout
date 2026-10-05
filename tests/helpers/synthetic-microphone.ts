import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import manifest from "../fixtures/speech/manifest.json";

export type SpeechFixture = keyof typeof manifest.fixtures;
export type Playback = { id: number; durationSeconds: number; startedAt: number };
export type PlaybackResult = "ended" | "cancelled";
export type NoiseOptions = { seed: number; durationMs?: number; amplitude?: number };

type MicrophoneControl = {
  resume(): Promise<void>;
  load(name: string, bytes: number[]): Promise<number>;
  speech(name: string): Playback;
  noise(options: NoiseOptions): Playback;
  cancel(): void;
  finished(id: number): Promise<PlaybackResult>;
  state(): {
    contextState: AudioContextState | "uninitialized";
    activeSources: number;
    trackStates: MediaStreamTrackState[];
    requests: number;
    disposed: boolean;
  };
  dispose(): Promise<void>;
};

type MicrophoneWindow = { syntheticMicrophone: MicrophoneControl };

/** Install before navigation/start. No app state, transcripts, or VAD events are injected. */
export async function installSyntheticMicrophone(page: Page) {
  await page.addInitScript(() => {
    let context: AudioContext | undefined;
    let destination: MediaStreamAudioDestinationNode | undefined;
    let disposed = false;
    let requests = 0;
    let nextId = 0;
    let active: { source: AudioBufferSourceNode; finish: (result: PlaybackResult) => void } | undefined;
    const tracks = new Set<MediaStreamTrack>();
    const buffers = new Map<string, AudioBuffer>();
    const completions = new Map<number, Promise<PlaybackResult>>();
    const original = navigator.mediaDevices.getUserMedia;
    const ensureContext = () => {
      if (disposed) throw new Error("Synthetic microphone is disposed");
      if (!context) {
        context = new AudioContext();
        destination = context.createMediaStreamDestination();
        destination.stream.getTracks().forEach(track => tracks.add(track));
      }
      return context;
    };
    const cancel = () => {
      if (!active) return;
      const playback = active;
      active = undefined;
      playback.source.onended = null;
      playback.source.stop();
      playback.source.disconnect();
      playback.finish("cancelled");
    };
    const start = (buffer: AudioBuffer): Playback => {
      const audio = ensureContext();
      if (audio.state !== "running") throw new Error("Click the lesson start button to resume browser audio first");
      cancel();
      const source = audio.createBufferSource();
      source.buffer = buffer;
      source.connect(destination!);
      const id = ++nextId;
      let finish!: (result: PlaybackResult) => void;
      completions.set(id, new Promise(resolve => (finish = resolve)));
      active = { source, finish };
      source.onended = () => {
        source.disconnect();
        if (active?.source === source) active = undefined;
        finish("ended");
      };
      const startedAt = audio.currentTime;
      source.start(startedAt);
      return { id, durationSeconds: buffer.duration, startedAt };
    };
    const replacement: typeof original = async constraints => {
      if (!constraints?.audio || constraints.video) throw new Error("Synthetic microphone supports audio-only capture");
      ensureContext();
      requests++;
      const stream = destination!.stream.clone();
      stream.getTracks().forEach(track => tracks.add(track));
      return stream;
    };
    navigator.mediaDevices.getUserMedia = replacement;
    const resume = async () => {
      await ensureContext().resume();
    };
    // Capture the trusted click before React's lesson handler requests its microphone.
    // Keep this listener until teardown so a later start gesture can also unlock audio.
    const unlock = () => {
      void resume().catch(() => {});
    };
    document.addEventListener("click", unlock, true);
    const control: MicrophoneControl = {
      resume,
      async load(name, bytes) {
        const audio = ensureContext();
        const buffer = await audio.decodeAudioData(new Uint8Array(bytes).buffer);
        if (disposed) throw new Error("Synthetic microphone is disposed");
        buffers.set(name, buffer);
        return buffer.duration;
      },
      speech(name) {
        const buffer = buffers.get(name);
        if (!buffer) throw new Error(`Load speech fixture first: ${name}`);
        return start(buffer);
      },
      noise({ seed, durationMs = 40, amplitude = 0.2 }) {
        if (
          !Number.isInteger(seed) ||
          seed < 0 ||
          seed > 0xffffffff ||
          !Number.isFinite(durationMs) ||
          durationMs <= 0 ||
          durationMs > 1000 ||
          !Number.isFinite(amplitude) ||
          amplitude < 0 ||
          amplitude > 1
        )
          throw new Error("Noise requires a uint32 seed, 0 < durationMs <= 1000, and 0 <= amplitude <= 1");
        const audio = ensureContext();
        const buffer = audio.createBuffer(
          1,
          Math.max(1, Math.round((audio.sampleRate * durationMs) / 1000)),
          audio.sampleRate,
        );
        const samples = buffer.getChannelData(0);
        let state = seed >>> 0;
        for (let i = 0; i < samples.length; i++) {
          state = (Math.imul(1664525, state) + 1013904223) >>> 0;
          samples[i] = ((state / 0x100000000) * 2 - 1) * amplitude;
        }
        return start(buffer);
      },
      cancel,
      finished(id) {
        const completion = completions.get(id);
        if (!completion) throw new Error(`Unknown playback: ${id}`);
        return completion;
      },
      state() {
        return {
          contextState: context?.state ?? "uninitialized",
          activeSources: active ? 1 : 0,
          trackStates: [...tracks].map(track => track.readyState),
          requests,
          disposed,
        };
      },
      async dispose() {
        if (disposed) return;
        disposed = true;
        document.removeEventListener("click", unlock, true);
        cancel();
        tracks.forEach(track => track.stop());
        destination?.disconnect();
        buffers.clear();
        if (navigator.mediaDevices.getUserMedia === replacement) navigator.mediaDevices.getUserMedia = original;
        if (context && context.state !== "closed") await context.close();
      },
    };
    (window as unknown as MicrophoneWindow).syntheticMicrophone = control;
  });
  return {
    async loadSpeech(name: SpeechFixture) {
      const fixture = manifest.fixtures[name];
      const bytes = await readFile(path.join(process.cwd(), "tests/fixtures/speech", fixture.file));
      if (createHash("sha256").update(bytes).digest("hex") !== fixture.sha256)
        throw new Error(`Speech fixture checksum mismatch: ${name}`);
      return page.evaluate(
        ({ name, bytes }) => (window as unknown as MicrophoneWindow).syntheticMicrophone.load(name, bytes),
        {
          name,
          bytes: [...bytes],
        },
      );
    },
    playSpeech: (name: SpeechFixture) =>
      page.evaluate(name => (window as unknown as MicrophoneWindow).syntheticMicrophone.speech(name), name),
    noise: (options: NoiseOptions) =>
      page.evaluate(options => (window as unknown as MicrophoneWindow).syntheticMicrophone.noise(options), options),
    waitForPlayback: (id: number) =>
      page.evaluate(id => (window as unknown as MicrophoneWindow).syntheticMicrophone.finished(id), id),
    // A connected destination with no active source supplies silence, not a stopped track.
    silence: () => page.evaluate(() => (window as unknown as MicrophoneWindow).syntheticMicrophone.cancel()),
    cancel: () => page.evaluate(() => (window as unknown as MicrophoneWindow).syntheticMicrophone.cancel()),
    state: () => page.evaluate(() => (window as unknown as MicrophoneWindow).syntheticMicrophone.state()),
    dispose: () => page.evaluate(() => (window as unknown as MicrophoneWindow).syntheticMicrophone.dispose()),
  };
}
