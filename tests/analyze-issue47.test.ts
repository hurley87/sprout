import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeTrial } from "../scripts/live/analyze-issue47.mjs";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

function fixture(transcriptHash?: string) {
  const dir = mkdtempSync(join(tmpdir(), "sprout-issue47-analysis-"));
  dirs.push(dir);
  const bytes = Buffer.from("public synthetic recording");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(join(dir, "session-recording.webm"), bytes);
  writeFileSync(
    join(dir, "diagnostics.json"),
    JSON.stringify({
      model: "gpt-live-1",
      createdAt: "2026-10-02T00:00:00Z",
      liveStartedAtMs: 10,
      browser: "test",
      events: [],
    }),
  );
  writeFileSync(
    join(dir, "recording-metadata.json"),
    JSON.stringify({
      mimeType: "audio/webm",
      startedAtPerformanceMs: 100,
      stoppedAtPerformanceMs: 200,
      bytes: bytes.length,
      sha256,
    }),
  );
  writeFileSync(
    join(dir, "recording-transcript.json"),
    JSON.stringify({
      model: "gpt-4o-transcribe-diarize",
      audioSha256: transcriptHash ?? sha256,
      payload: { segments: [] },
    }),
  );
  writeFileSync(join(dir, "log.json"), JSON.stringify({ log: [] }));
  return dir;
}

it("rejects an empty expected scene chain instead of passing it vacuously", () => {
  const summary = analyzeTrial(fixture(), [0, 1, 2]);
  expect(summary.passed).toBe(false);
  expect(summary.errors).toContain("expected evaluated scenes [0,1,2], observed []");
});

it("rejects an independent transcript bound to a different recording", () => {
  const summary = analyzeTrial(fixture("different-recording-hash"), []);
  expect(summary.passed).toBe(false);
  expect(summary.errors).toContain("independent transcription is not bound to this recording SHA-256");
});
