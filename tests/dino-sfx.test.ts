import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDinoSfx, DINO_SFX } from "../app/dino-sfx";

const names = Object.keys(DINO_SFX) as (keyof typeof DINO_SFX)[];
afterEach(() => vi.unstubAllGlobals());

describe("generated dinosaur sounds", () => {
  it.each(names)("%s is a valid WAV with the advertised duration", name => {
    const wav = readFileSync(join(process.cwd(), "public", DINO_SFX[name].src));
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
    expect(wav.toString("ascii", 8, 16)).toBe("WAVEfmt ");
    expect(wav.readUInt32LE(16)).toBe(16);
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(22050);
    expect(wav.readUInt32LE(28)).toBe(44100);
    expect(wav.readUInt16LE(32)).toBe(2);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.toString("ascii", 36, 40)).toBe("data");
    expect(wav.readUInt32LE(40)).toBe(wav.length - 44);
    const duration = ((wav.length - 44) / 2 / 22050) * 1000;
    expect(duration).toBeLessThan(1000);
    expect(Math.ceil(duration)).toBe(DINO_SFX[name].durationMs);
  });

  it("reproduces the committed files byte for byte", () => {
    const directory = mkdtempSync(join(tmpdir(), "dino-sfx-"));
    try {
      execFileSync(process.execPath, ["scripts/generate-dino-sfx.mjs", directory]);
      for (const name of names) {
        expect(readFileSync(join(directory, `${name}.wav`))).toEqual(
          readFileSync(join(process.cwd(), "public", DINO_SFX[name].src)),
        );
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("dinosaur sound player", () => {
  function setup() {
    const start = vi.fn();
    const gain = { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
    const source = { buffer: null, connect: vi.fn(), disconnect: vi.fn(), start, onended: null as (() => void) | null };
    const context = {
      state: "running",
      destination: {},
      resume: vi.fn().mockResolvedValue(undefined),
      decodeAudioData: vi.fn().mockResolvedValue({}),
      createBufferSource: vi.fn(() => source),
      createGain: vi.fn(() => gain),
    };
    const AudioContextMock = vi.fn(function () {
      return context;
    });
    vi.stubGlobal("AudioContext", AudioContextMock);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }));
    return { context, source, gain, start, AudioContextMock };
  }

  it("gates only decoded sounds, starts at moderate gain, and prevents overlap", async () => {
    const { context, source, gain, start, AudioContextMock } = setup();
    const player = createDinoSfx();
    const gate = vi.fn().mockReturnValue(false);
    expect(player.play("crunch", gate)).toBe(false);
    expect(gate).not.toHaveBeenCalled();
    await player.unlock();
    await player.unlock();
    expect(AudioContextMock).toHaveBeenCalledTimes(1);
    expect(context.decodeAudioData).toHaveBeenCalledTimes(4);
    expect(player.play("crunch", gate)).toBe(false);
    expect(start).not.toHaveBeenCalled();
    gate.mockReturnValue(true);
    expect(player.play("crunch", gate)).toBe(true);
    expect(gate).toHaveBeenLastCalledWith("crunch", 450);
    expect(start).toHaveBeenCalledTimes(1);
    expect(gain.gain.value).toBeCloseTo(0.6);
    expect(player.play("horn", gate)).toBe(false);
    expect(gate).toHaveBeenCalledTimes(2);
    source.onended?.();
    expect(player.play("horn", gate)).toBe(true);
    expect(gate).toHaveBeenLastCalledWith("horn", 500);
  });

  it("stays silent when unlock fails", async () => {
    const { context } = setup();
    context.decodeAudioData.mockRejectedValue(new Error("decode failed"));
    const player = createDinoSfx();
    await expect(player.unlock()).resolves.toBeUndefined();
    const gate = vi.fn();
    expect(player.play("success", gate)).toBe(false);
    expect(gate).not.toHaveBeenCalled();
  });
});
