import { expect, it, vi } from "vitest";
import type { Page } from "@playwright/test";
import {
  ChildScenario,
  countingAnswer,
  scenarioTimeline,
  speechForText,
  scopeFromEvent,
} from "./helpers/child-scenario";
import { LessonObserver } from "./helpers/lesson-observer";
import type { LessonDiagnostic, LessonObservation } from "../lib/lesson-runtime/lesson-runtime";
import type { installSyntheticMicrophone } from "./helpers/synthetic-microphone";
import { createLessonRuntime } from "../lib/lesson-runtime/lesson-runtime-reducer";
import manifest from "./fixtures/speech/manifest.json";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

function fixture() {
  const events: LessonDiagnostic[] = [];
  let runtimeId = "attempt-1";
  let nowMs = 50;
  const event = (type: string, detail: unknown = null, overrides: Partial<LessonDiagnostic> = {}) => {
    const value = {
      timestamp: "unused-wall-clock",
      atMs: ++nowMs,
      runtimeId,
      visitId: 1,
      childTurnId: 2,
      nodeId: "count-1-duck",
      transcriptRevision: 3,
      transcriptSpeaker: "unknown" as const,
      type,
      detail,
      ...overrides,
    };
    events.push(value);
    return value;
  };
  const observer = new LessonObserver({} as Page);
  vi.spyOn(observer, "read").mockImplementation(async after => {
    if (after && after.runtimeId !== runtimeId) throw new Error("cursor from old runtime");
    return {
      nowMs: ++nowMs,
      cursor: { runtimeId, offset: events.length },
      snapshot: {
        status: "live",
        transcript: "",
        error: null,
        awaitingSteering: false,
        diagnostics: [],
        display: { token: "test", nodeId: "count-1-duck", sceneId: "hello-duck" },
        runtime: {
          ...createLessonRuntime(runtimeId),
          visitId: 1,
          childTurnId: 2,
          nodeId: "count-1-duck",
          transcriptRevision: 3,
        },
      },
      events: events.slice(after?.offset ?? 0),
    } as LessonObservation;
  });
  const microphone = {
    loadSpeech: vi.fn(),
    playSpeech: vi.fn(async () => ({ id: 1, startedAt: 900000, durationSeconds: 1 })),
    waitForPlayback: vi.fn(async () => "ended"),
    cancel: vi.fn(async () => {}),
    silence: vi.fn(async () => {}),
  } as unknown as Awaited<ReturnType<typeof installSyntheticMicrophone>>;
  return {
    child: new ChildScenario({} as Page, observer, microphone),
    event,
    microphone,
    restart: () => {
      runtimeId = "attempt-2";
    },
  };
}

it("selects exact committed phrases and authored correct/wrong quantities; verifies every audio checksum", async () => {
  for (const [node, correct, wrong] of [
    ["count-1-duck", "one", "two"],
    ["count-2-ducks", "two", "three"],
    ["count-3-butterflies", "three", "one"],
  ] as const) {
    expect(countingAnswer(node, true)).toBe(correct);
    expect(countingAnswer(node, false)).toBe(wrong);
  }
  expect(speechForText("Help me please.")).toBe("help");
  expect(() => speechForText("novel phrase")).toThrow(/No committed speech fixture/);
  for (const fixture of Object.values(manifest.fixtures)) {
    const bytes = await readFile(`tests/fixtures/speech/${fixture.file}`);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(fixture.sha256);
  }
});

it("orders output waits, rejects old quiet and exact classifier identities, and isolates restarts", async () => {
  const { child, event, restart } = fixture();
  event("output.activity", { state: "quiet" });
  const from = await child.checkpoint();
  const active = event("output.activity", { state: "active" });
  expect((await child.waitForEvent("output.activity", { from, detail: { state: "active" } })).event).toEqual(active);
  await expect(child.waitForTutorQuiet(0)).rejects.toThrow(/Timed out/);
  event("output.activity", { state: "quiet" });
  await child.waitForTutorQuiet();
  const start = event("classifier.started");
  const started = await child.waitForClassifierStart();
  const classifierFrom = { after: started.cursor, scope: scopeFromEvent(start) };
  for (const overrides of [{ visitId: 2 }, { childTurnId: 1 }, { transcriptRevision: 2 }])
    event("classifier.result", null, overrides);
  await expect(child.waitForClassifierResult(classifierFrom, "classifier.result", 0)).rejects.toThrow(/Timed out/);
  const correctIdentity = event("classifier.result");
  expect((await child.waitForClassifierResult(classifierFrom)).event).toEqual(correctIdentity);
  restart();
  await expect(child.currentNode()).rejects.toThrow(/restarted/);
  await child.finish();
});

it("records audio cancellation and aborts pending waits before cleanup, retaining browser-clock stamps", async () => {
  const { child, microphone } = fixture();
  vi.mocked(microphone.waitForPlayback).mockResolvedValueOnce("cancelled");
  await child.say("One.");
  expect(microphone.playSpeech).toHaveBeenCalledWith("one");
  expect(child.records.at(-1)?.kind).toBe("cancelled");
  const waiting = child.waitForTutorQuiet();
  const elapsed = child.wait(60_000);
  const settled = Promise.allSettled([waiting, elapsed]);
  await child.finish();
  expect((await settled).every(result => result.status === "rejected")).toBe(true);
  expect(child.records.filter(record => record.kind === "cancelled")).toHaveLength(3);
  expect(child.records.filter(record => record.atMs !== null).every(record => record.atMs! < 1000)).toBe(true);
  expect(JSON.stringify(child.records)).not.toContain("900000");
  await expect(child.say("One.")).rejects.toThrow(/closed/);
});

it("merges on attempt atMs only and labels missing clock evidence", () => {
  const { child } = fixture();
  child.records.push(
    { action: 1, sequence: 0, atMs: 12, runtimeId: "r", name: "say", kind: "start", trigger: "One." },
    { action: 1, sequence: 1, atMs: null, runtimeId: "r", name: "say", kind: "failure", trigger: "destroyed page" },
  );
  const timeline = scenarioTimeline(null, child.records);
  expect(timeline.indexOf("12.000ms")).toBeLessThan(timeline.indexOf("unavailablems"));
});
