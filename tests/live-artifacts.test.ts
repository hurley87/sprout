import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportArtifacts, timeline } from "../scripts/live/artifacts.mjs";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
const directory = () => {
  const dir = mkdtempSync(join(tmpdir(), "sprout-artifacts-"));
  dirs.push(dir);
  return dir;
};

describe("readable live artifacts", () => {
  it("shows intent, separate clocks, structured transitions and the failure prominently", () => {
    const text = timeline("wrong", "runtime mic", [
      { dir: "scene", at: 0, scene: "hello-duck" },
      {
        dir: "child",
        at: 100,
        action: "child.action.started",
        type: "wrongAnswer",
        scene: "hello-duck",
        expected: 1,
        answer: 2,
        text: "Two!",
      },
      ...["synthesis-start", "synthesis-end", "playback-start", "playback-end"].map(action => ({
        dir: "child",
        at: 200,
        action,
      })),
      { dir: "in", at: 300, type: "session.input_transcript.delta", start_ms: 9000, end_ms: 9500, delta: "Two!" },
      {
        dir: "in",
        at: 500,
        type: "session.output_transcript.delta",
        start_ms: 10000,
        end_ms: 11000,
        delta: "Try again",
      },
      { dir: "scene", at: 700, scene: "duck-friends" },
      { dir: "in", at: 800, type: "session.closed", reason: "child_stop" },
      { dir: "scenario", at: 900, action: "assertion-failure", scenario: "wrong", error: "Expected scene to stay" },
    ]);
    expect(text).toContain("SCENE ∅ → hello-duck");
    expect(text).toContain("SCENE hello-duck → duck-friends");
    expect(text).toContain('CHILD ACTION START wrongAnswer scene=hello-duck expected=1 answer=2 text="Two!"');
    for (const phase of ["SYNTHESIS START", "SYNTHESIS END", "PLAYBACK START", "PLAYBACK END"])
      expect(text).toContain(`CHILD ${phase}`);
    expect(text).toContain("[provider 9.00s] CHILD TRANSCRIPT: Two!");
    expect(text).toContain("[page 0.50s] SPROUT TURN START");
    expect(text).toContain("child_stop");
    expect(text).toMatch(/=== SCENARIO FAILED ===\nExpected scene to stay$/);
  });

  it.each([false, true])("preserves core evidence when UI diagnostics fail (unreadable page=%s)", async unreadable => {
    const dir = directory();
    const page = {
      evaluate: vi.fn(async () => {
        if (unreadable) throw new Error("page closed");
        return [{ dir: "scene", at: 0, scene: "hello-duck" }];
      }),
      getByText: vi.fn(() => ({
        click: async () => {
          throw new Error("download unavailable");
        },
      })),
    };
    const failure = "Original assertion failure\nwith full evidence";
    await exportArtifacts({
      page,
      browser: { version: () => "test-browser" },
      dir,
      label: "test-2",
      scenario: { name: "test", mode: "reactive", timeoutMs: 120000 },
      micScript: "runtime",
      failure,
    });
    expect(readFileSync(join(dir, "timeline.txt"), "utf8")).toContain(failure);
    expect(JSON.parse(readFileSync(join(dir, "log.json"), "utf8"))).toMatchObject({
      browser: "test-browser",
      scenario: { mode: "reactive" },
    });
    expect(JSON.parse(readFileSync(join(dir, "diagnostics.json"), "utf8"))).toMatchObject({
      unavailable: expect.stringContaining("download unavailable"),
    });
  });
});

it("adds the structured application end reason without inventing a page timestamp", async () => {
  const dir = directory();
  const source = join(dir, "download.json");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(source, JSON.stringify({ ending: "child_stop" }));
  const page = {
    evaluate: async () => [],
    getByText: () => ({ click: async () => {} }),
    getByRole: () => ({ click: async () => {} }),
    waitForEvent: async () => ({ path: async () => source }),
  };
  await exportArtifacts({
    page,
    browser: { version: () => "fake" },
    dir,
    label: "stop",
    scenario: {},
    micScript: "runtime",
    failure: "failed assertion",
  });
  const text = readFileSync(join(dir, "timeline.txt"), "utf8");
  expect(text).toContain("APPLICATION SESSION END reason=child_stop (diagnostics; no browser timestamp)");
  expect(text.indexOf("APPLICATION SESSION END")).toBeLessThan(text.indexOf("=== SCENARIO FAILED ==="));
});

it("renders response-gate conditions and terminal evidence in the artifact timeline", async () => {
  const dir = directory();
  const source = join(dir, "download.json");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    source,
    JSON.stringify({
      events: [
        {
          at: 10,
          type: "answer.candidate",
          detail: { sceneIndex: 0, revision: 3, version: "10:One", transcript_at: 9 },
        },
        {
          at: 20,
          type: "answer.response_gate_observed",
          detail: {
            scene_index: 0,
            transcript_revision: 3,
            answer_version: "10:One",
            conditions: ["output_transcript_quiet"],
            output_blocked: true,
            output_quiet_at: 40,
          },
        },
        {
          at: 30,
          type: "answer.response_gate_observed",
          detail: {
            scene_index: 0,
            transcript_revision: 3,
            answer_version: "10:One",
            conditions: [],
            output_blocked: false,
          },
        },
        {
          at: 30,
          type: "answer.response_gate_released",
          detail: {
            scene_index: 0,
            transcript_revision: 3,
            answer_version: "10:One",
            decision: "STAY",
            reason: "output_transcript_quiet",
            context_sent_at: 30,
            eligible_at: 40,
          },
        },
        { at: 31, type: "output.media_activity", detail: { state: "active", output_blocked: false } },
        { at: 32, type: "transcript.sprout", detail: { delta: "Nice!" } },
      ],
    }),
  );
  const page = {
    evaluate: async () => [],
    getByText: () => ({ click: async () => {} }),
    getByRole: () => ({ click: async () => {} }),
    waitForEvent: async () => ({ path: async () => source }),
  };
  const text = await exportArtifacts({
    page,
    browser: { version: () => "fake" },
    dir,
    label: "gate",
    scenario: {},
    micScript: "runtime",
    failure: undefined,
  });
  expect(text).toContain("Response gate timeline (application session-relative clock)");
  expect(text).toContain("output_transcript_quiet=10ms");
  expect(text).toContain("blocked union=10ms (condition intervals may overlap)");
  expect(text).toContain("released STAY/output_transcript_quiet at 30ms; context sent 30ms");
  expect(text).toContain("first transcript observed after release at 32ms");
  expect(text).toContain("first decoded-media activity after release at 31ms");
  expect(text).toContain("output.media_activity active at 31ms");
  expect(text).toContain(
    "transcript/media observations do not prove current-answer generation, acoustic delivery or completion",
  );
  expect(text).toContain("audible onset/provider completion unobserved");
});

it("prints recovery failure with its answer identity", async () => {
  const dir = directory();
  const source = join(dir, "download.json");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    source,
    JSON.stringify({
      events: [
        {
          at: 10,
          type: "answer.candidate",
          detail: { sceneIndex: 0, revision: 2, version: "10:Two", transcript_at: 9 },
        },
        {
          at: 20,
          type: "answer.response_gate_recovery_failed",
          detail: {
            scene_index: 0,
            transcript_revision: 2,
            answer_version: "10:Two",
            wait_ms: 15000,
            output_media_activity: "quiet",
          },
        },
      ],
    }),
  );
  const page = {
    evaluate: async () => [],
    getByText: () => ({ click: async () => {} }),
    getByRole: () => ({ click: async () => {} }),
    waitForEvent: async () => ({ path: async () => source }),
  };
  const text = await exportArtifacts({
    page,
    browser: { version: () => "fake" },
    dir,
    label: "recovery",
    scenario: {},
    micScript: "runtime",
    failure: undefined,
  });
  expect(text).toContain(
    'answer.response_gate_recovery_failed scene=0 revision=2 answer="10:Two" at 20ms after 15000ms',
  );
});
