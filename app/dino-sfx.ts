/** Generated sounds and their rounded-up durations in milliseconds. */
export const DINO_SFX = {
  crunch: { src: "/dinos/sfx/crunch.wav", durationMs: 450 },
  horn: { src: "/dinos/sfx/horn.wav", durationMs: 500 },
  "truck-rumble": { src: "/dinos/sfx/truck-rumble.wav", durationMs: 800 },
  success: { src: "/dinos/sfx/success.wav", durationMs: 700 },
} as const;

type DinoSound = keyof typeof DINO_SFX;

export function createDinoSfx() {
  let context: AudioContext | undefined;
  let loading: Promise<Record<DinoSound, AudioBuffer>> | undefined;
  let buffers: Partial<Record<DinoSound, AudioBuffer>> = {};
  let playing = false;

  async function unlock(): Promise<void> {
    try {
      context ??= new AudioContext();
      const audio = context;
      // Resume synchronously from the gesture, even when a preload is already in flight.
      const resumed = audio.resume();
      loading ??= Promise.all(
        (Object.keys(DINO_SFX) as DinoSound[]).map(async name => {
          const response = await fetch(DINO_SFX[name].src);
          if (!response.ok) throw new Error("Sound unavailable");
          return [name, await audio.decodeAudioData(await response.arrayBuffer())] as const;
        }),
      ).then(entries => Object.fromEntries(entries) as Record<DinoSound, AudioBuffer>);
      const [, decoded] = await Promise.all([resumed, loading]);
      buffers = decoded;
    } catch {
      buffers = {};
      loading = undefined;
    }
  }

  function play(name: DinoSound, gate: (name: string, durationMs: number) => boolean): boolean {
    const buffer = buffers[name];
    if (!context || context.state !== "running" || !buffer || playing) return false;
    try {
      if (!gate(name, DINO_SFX[name].durationMs)) return false;
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      gain.gain.value = 0.6;
      source.connect(gain);
      gain.connect(context.destination);
      playing = true;
      source.onended = () => {
        playing = false;
        source.disconnect();
        gain.disconnect();
      };
      source.start();
      return true;
    } catch {
      playing = false;
      return false;
    }
  }

  return { unlock, play };
}
