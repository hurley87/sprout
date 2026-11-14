/**
 * Crunch: three rapidly decaying bursts of seeded noise pass through a simple
 * low-pass filter, creating a soft, cartoon-like chomp.
 *
 * Horn: two short, gently enveloped pairs of sine tones make a friendly toy
 * truck beep-beep, with a little harmonic warmth.
 *
 * Truck rumble: a low sine and heavily filtered seeded noise fade in and out,
 * suggesting a small, soft engine without a sharp transient.
 *
 * Success: a rising C-E-G-C sequence of softly decaying sine tones overlaps
 * slightly to make a cheerful, rounded arpeggio.
 *
 * Run with Node; an optional argument selects the output directory. All sounds
 * use a fixed seed, 22050 Hz mono 16-bit PCM, peak normalization, and end fades.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const rate = 22050;
const output = resolve(process.argv[2] ?? "public/dinos/sfx");
let seed = 117;
function noise() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return (seed / 0x100000000) * 2 - 1;
}
function sine(frequency, time) {
  return Math.sin(2 * Math.PI * frequency * time);
}
function burst(time, start, duration) {
  const elapsed = time - start;
  return elapsed >= 0 && elapsed < duration ? Math.exp(-elapsed * 24) : 0;
}
function writeSound(name, ms, sample) {
  const count = Math.floor((rate * ms) / 1000);
  const values = new Float64Array(count);
  let peak = 0;
  for (let i = 0; i < count; i++) {
    const fade = Math.min(1, i / (rate * 0.01), (count - 1 - i) / (rate * 0.015));
    values[i] = sample(i / rate) * fade;
    peak = Math.max(peak, Math.abs(values[i]));
  }
  const wav = Buffer.alloc(44 + count * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) wav.writeInt16LE(Math.round((values[i] / peak) * 23197), 44 + i * 2);
  writeFileSync(resolve(output, `${name}.wav`), wav);
}
mkdirSync(output, { recursive: true });
let filtered = 0;
writeSound("crunch", 450, t => {
  filtered += 0.17 * (noise() - filtered);
  return filtered * (burst(t, 0.025, 0.14) + burst(t, 0.145, 0.14) + burst(t, 0.255, 0.16));
});
writeSound("horn", 500, t => {
  const elapsed = t < 0.23 ? t - 0.025 : t - 0.265;
  if (elapsed < 0 || elapsed > 0.18) return 0;
  const envelope = Math.min(1, elapsed / 0.012, (0.18 - elapsed) / 0.025);
  return envelope * (sine(440, elapsed) + 0.45 * sine(554.37, elapsed));
});
filtered = 0;
writeSound("truck-rumble", 800, t => {
  filtered += 0.025 * (noise() - filtered);
  const envelope = Math.min(1, t / 0.12, (0.8 - t) / 0.2);
  return envelope * (0.65 * sine(75, t) + filtered);
});
writeSound("success", 700, t => {
  return [261.63, 329.63, 392, 523.25].reduce((sum, frequency, i) => {
    const elapsed = t - i * 0.12;
    return elapsed >= 0 && elapsed < 0.32
      ? sum + sine(frequency, elapsed) * Math.exp(-elapsed * 7) * Math.min(1, elapsed / 0.01)
      : sum;
  }, 0);
});
