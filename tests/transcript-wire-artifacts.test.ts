import { expect, it, vi } from "vitest";
import type { Page } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { installChildScenarios } from "./helpers/child-scenario";
import { LessonObserver } from "./helpers/lesson-observer";
import { describeTranscriptWire, type WireCapture } from "./helpers/transcript-wire";
import { createLessonRuntime } from "../lib/lesson-runtime/lesson-runtime-reducer";
import type { LessonObservation } from "../lib/lesson-runtime/lesson-runtime";

it("retains bounded wire metadata and delivery layers in failure artifacts before cleanup", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "sprout-wire-artifacts-"));
  const state = createLessonRuntime("artifact-runtime");
  const capture: WireCapture = {
    version: 1,
    channels: 1,
    frames: 1,
    dropped: 0,
    observationErrors: 0,
    records: [
      {
        ...describeTranscriptWire('{"type":"session.input_transcript.delta","delta":null,"start_ms":1,"end_ms":2}'),
        sequence: 0,
        channelId: 1,
        channelRuntimeId: state.runtimeId,
        atMs: 20,
        runtimeId: state.runtimeId,
        visitId: state.visitId,
        nodeId: state.nodeId,
        childTurnId: state.childTurnId,
        transcriptRevision: 0,
        journalOffset: 0,
      },
    ],
  };
  const observation = {
    nowMs: 21,
    cursor: { runtimeId: state.runtimeId, offset: 0 },
    snapshot: { runtime: state },
    events: [],
  } as unknown as LessonObservation;
  const report = {
    runtimeId: state.runtimeId,
    status: "ended",
    runtime: state,
    error: null,
    events: [],
  } as unknown as NonNullable<Awaited<ReturnType<LessonObserver["report"]>>>;
  const cancelled = vi.fn(() => {
    capture.records.length = 0;
  });
  vi.stubGlobal("window", {
    sproutTranscriptWire: { read: () => structuredClone(capture), dispose: vi.fn() },
    syntheticMicrophone: { cancel: cancelled, dispose: vi.fn() },
  });
  vi.spyOn(LessonObserver.prototype, "read").mockResolvedValue(observation);
  vi.spyOn(LessonObserver.prototype, "report").mockResolvedValue(report);
  const page = {
    addInitScript: vi.fn(),
    evaluate: vi.fn(async (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg)),
  } as unknown as Page;
  const attach = vi.fn();
  try {
    const harness = await installChildScenarios(
      page,
      { outputPath: name => path.join(folder, name), attach },
      { retentionRoot: path.join(folder, "retained") },
    );
    await expect(
      harness.run("failure", async child => {
        await child.checkpoint();
        throw new Error("expected scenario failure");
      }),
    ).rejects.toThrow("expected scenario failure");
    const companion = JSON.parse(await readFile(path.join(folder, "attempt-1-failure-harness.json"), "utf8"));
    expect(companion.version).toBe(2);
    expect(companion.transcriptWire.records).toHaveLength(1);
    expect(companion.transcriptDelivery).toMatchObject({
      learnerWireEvents: 1,
      parserDiscardedLearnerEvents: 1,
      parserValidLearnerEvents: 0,
    });
    expect(companion.failure).toBe("expected scenario failure");
    expect(await readFile(path.join(folder, "attempt-1-failure-timeline.txt"), "utf8")).toContain(
      "20.000ms wire session.input_transcript.delta",
    );
    expect(JSON.parse(await readFile(path.join(folder, "attempt-1-failure-report.json"), "utf8"))).toEqual(report);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(attach).toHaveBeenCalledTimes(3);
    await harness.dispose();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await rm(folder, { recursive: true, force: true });
  }
});
