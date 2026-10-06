import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import manifest from "./fixtures/speech/manifest.json";

it("verifies matched hesitant answer text, synthesis settings, checksums, PCM format and unclipped samples", async () => {
  const albert = manifest.fixtures["hesitant-three"];
  const samantha = manifest.fixtures["hesitant-three-samantha"];
  expect(samantha.text).toBe(albert.text);
  expect(samantha.format).toBe(albert.format);
  expect(albert.provenance.commands[0].slice(3, 5)).toEqual(["-r", "130"]);
  expect(samantha.provenance.commands[0].slice(3, 5)).toEqual(["-r", "130"]);
  const settings = (fixture: typeof albert) => fixture.provenance.commands[1].slice(7, -1);
  expect(settings(samantha)).toEqual(settings(albert));
  expect(albert.provenance.commands[0][2]).toBe("Albert");
  expect(samantha.provenance.commands[0][2]).toBe("Samantha");
  for (const fixture of [albert, samantha]) {
    const bytes = await readFile(`tests/fixtures/speech/${fixture.file}`);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(fixture.sha256);
    expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
    expect(bytes.toString("ascii", 8, 12)).toBe("WAVE");
    let data: Buffer | undefined;
    let format: Buffer | undefined;
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const size = bytes.readUInt32LE(offset + 4);
      const chunk = bytes.subarray(offset + 8, offset + 8 + size);
      if (bytes.toString("ascii", offset, offset + 4) === "fmt ") format = chunk;
      if (bytes.toString("ascii", offset, offset + 4) === "data") data = chunk;
      offset += 8 + size + (size % 2);
    }
    expect(format).toBeDefined();
    expect(data).toBeDefined();
    expect(format!.readUInt16LE(0)).toBe(1); // PCM
    expect(format!.readUInt16LE(2)).toBe(1); // mono
    expect(format!.readUInt32LE(4)).toBe(24_000);
    expect(format!.readUInt16LE(14)).toBe(16);
    expect(data!.length / 2 / 24_000).toBeCloseTo(fixture.durationSeconds, 6);
    let peak = 0;
    for (let offset = 0; offset < data!.length; offset += 2) peak = Math.max(peak, Math.abs(data!.readInt16LE(offset)));
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThan(32_767);
  }
});
