import { execFileSync } from "node:child_process";

/** Builds the existing fixed-timeline microphone track with macOS say and ffmpeg. */
export function buildMicTrack(dir, { seconds, lines }) {
  const inputs = [];
  const delayed = lines.map(([at, text], i) => {
    const clip = `${dir}/line${i}.aiff`;
    execFileSync("say", ["-v", "Samantha", "-r", "150", "-o", clip, text]);
    inputs.push("-i", clip);
    return `[${i + 1}:a]aresample=48000,adelay=${Math.round(at * 1000)}:all=1[a${i}]`;
  });
  const wav = `${dir}/mic.wav`;
  const mix = `${delayed.join(";")};[0:a]${lines.map((_, i) => `[a${i}]`).join("")}amix=inputs=${lines.length + 1}:duration=first:normalize=0[out]`;
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-t",
    String(seconds + 5),
    "-i",
    "anullsrc=r=48000:cl=mono",
    ...inputs,
    "-filter_complex",
    mix,
    "-map",
    "[out]",
    "-ac",
    "1",
    "-ar",
    "48000",
    "-c:a",
    "pcm_s16le",
    wav,
  ]);
  return wav;
}
