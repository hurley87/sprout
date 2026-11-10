import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import {
  buildGardenExport,
  GARDEN_EXPORT_SCHEMA,
  gardenLessonRevision,
  redactExport,
} from "../lib/garden-rescue/evidence-export";
import { GARDEN_RESCUE_LESSON, GARDEN_RESCUE_NODE_IDS as ids } from "../lib/lesson-runtime/garden-rescue-lesson";
import type { LessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import { redactionViolations } from "./helpers/export-redaction";
import { gardenRun } from "./helpers/garden-session";
import { useRuntimeFakeTimers } from "./helpers/runtime-harness";

const transport = vi.hoisted(() => ({
  receive: undefined as ((event: ProviderEvent) => void) | undefined,
  send: vi.fn<(command: ClientCommand) => void>(),
  close: vi.fn(),
}));
vi.mock("../lib/browser-transport", async () => {
  const { mockBrowserTransport } = await import("./helpers/runtime-harness");
  return { BrowserTransport: mockBrowserTransport(transport) };
});

let active: Awaited<ReturnType<typeof gardenRun>> | undefined;
beforeEach(() => useRuntimeFakeTimers());
afterEach(() => {
  active?.runtime.stop();
  active = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function start() {
  active = await gardenRun(transport);
  return active;
}

const editNode = (lesson: LessonDefinition, id: string, edit: (node: Record<string, unknown>) => void) => {
  const copy = structuredClone(lesson) as LessonDefinition & { nodes: Record<string, Record<string, unknown>> };
  edit(copy.nodes[id]);
  return copy;
};

describe("Garden lesson revision", () => {
  it("is stable for the same authored definition, regardless of key order", () => {
    const revision = gardenLessonRevision();
    expect(revision).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
    expect(gardenLessonRevision(GARDEN_RESCUE_LESSON)).toBe(revision);
    expect(gardenLessonRevision(structuredClone(GARDEN_RESCUE_LESSON))).toBe(revision);
    const reordered = Object.fromEntries(Object.entries(GARDEN_RESCUE_LESSON).reverse()) as LessonDefinition;
    expect(gardenLessonRevision(reordered)).toBe(revision);
  });

  it("changes when an authored node field changes", () => {
    const revision = gardenLessonRevision();
    const edits: ((node: Record<string, unknown>) => void)[] = [
      node => (node.tutorBrief = `${node.tutorBrief} `),
      node => (node.learningObjective = "Identify the total of five displayed ducklings."),
      node => ((node.presentation as Record<string, unknown>).quantity = 5),
      node => ((node.presentation as Record<string, unknown>).sceneVersion = "2"),
      node => (node.evidenceRole = "transfer"),
    ];
    const revisions = edits.map(edit => gardenLessonRevision(editNode(GARDEN_RESCUE_LESSON, ids[0], edit)));
    for (const changed of revisions) expect(changed).not.toBe(revision);
    expect(new Set(revisions).size).toBe(edits.length);
  });
});

describe("Garden evidence export", () => {
  it("adds a game block with summary and provenance, and passes the redaction audit", async () => {
    const run = await start();
    await run.child("I don't know, a fuzzy duckie");
    await run.tutor("Try pointing to each duckling.");
    await run.succeed("three");
    await run.succeed("three");
    await run.succeed("four");
    await run.succeed("four");
    const report = run.runtime.report();
    expect(report.runtime?.phase).toBe("complete");
    const exportedAt = new Date("2026-11-10T12:00:00.000Z");
    const exported = buildGardenExport({ report, gameEvents: run.gameEvents, exportedAt });
    const runId = report.runtimeId;

    // The runtime report is carried through unchanged; nothing in it needed redaction.
    const { game, ...rest } = exported;
    expect(rest).toEqual(report);
    expect(game.events).toEqual(run.gameEvents);
    expect(game.provenance).toEqual({
      schema: GARDEN_EXPORT_SCHEMA,
      summarySchema: "garden-evidence/v1",
      lessonId: "garden-rescue",
      lessonRevision: gardenLessonRevision(),
      sceneVersions: Object.fromEntries(ids.map(id => [id, "1"])),
      classifierVersion: "conversation-state-v2",
      runId,
      exportedAt: "2026-11-10T12:00:00.000Z",
      build: "unknown",
      redactions: [],
    });
    expect(game.summary).toMatchObject({
      schema: "garden-evidence/v1",
      runId,
      ending: "completed_all_restored",
      integrity: { ok: true, issues: [] },
    });
    expect(game.summary.rehearsals.map(visit => visit.questId)).toEqual(ids.slice(0, 3));
    expect(game.summary.rehearsals[0].support).toBe("hinted");
    expect(game.summary.transfer).toMatchObject({ questId: ids[3], probe: "transfer", outcome: "succeeded" });

    // Redaction audit on the in-memory object and on the downloaded JSON form.
    expect(redactionViolations(exported, runId)).toEqual([]);
    expect(redactionViolations(JSON.parse(JSON.stringify(exported)), runId)).toEqual([]);
    // Conversation text stays in the diagnostics (disclosed in the UI), never in the summary.
    expect(JSON.stringify(rest)).toContain("fuzzy duckie");
    expect(JSON.stringify(game.summary)).not.toMatch(/fuzzy|duckie|pointing|I don't know/i);
  });

  it("reports a stopped run as stopped, never completed", async () => {
    const run = await start();
    await run.succeed("three");
    run.runtime.stop();
    const exported = buildGardenExport({ report: run.runtime.report(), gameEvents: run.gameEvents });
    expect(exported.game.summary.ending).toBe("stopped");
    expect(exported.game.events.at(-1)).toMatchObject({ type: "game.ended", outcome: "stopped" });
    expect(exported.game.summary.integrity.ok).toBe(true);
    expect(redactionViolations(exported, exported.runtimeId)).toEqual([]);
  });

  it("keeps only the current run's game events", async () => {
    const run = await start();
    await run.succeed("three");
    const stale = [{ type: "game.started", runId: "previous-run" } as const];
    const exported = buildGardenExport({ report: run.runtime.report(), gameEvents: [...stale, ...run.gameEvents] });
    expect(exported.game.events).toEqual(run.gameEvents);
    expect(exported.game.summary.integrity.ok).toBe(true);
  });

  it("strips credential-like keys and raw audio, and records each removal", () => {
    const base64 = "UklGRiQAAABXQVZF".repeat(64);
    const { value, redactions } = redactExport({
      session: { client_secret: { value: "ek_live" }, apiKey: "k", headers: { Authorization: "Bearer abc" } },
      sdp: "v=0",
      note: "Bearer abcdefghijklmnop",
      clip: "data:audio/wav;base64,UklGRg==",
      pcm: base64,
      samples: new Float32Array(4),
      buffer: new ArrayBuffer(8),
      transcript: "Child: three. ".repeat(80),
      display: { token: "run:initial" },
    });
    expect(value).toEqual({
      session: { headers: {} },
      note: "[redacted]",
      clip: "[redacted]",
      pcm: "[redacted]",
      samples: "[redacted]",
      buffer: "[redacted]",
      transcript: "Child: three. ".repeat(80),
      display: { token: "run:initial" },
    });
    expect(redactions).toEqual([
      { path: "$.session.client_secret", reason: "credential_key" },
      { path: "$.session.apiKey", reason: "credential_key" },
      { path: "$.session.headers.Authorization", reason: "credential_key" },
      { path: "$.sdp", reason: "credential_key" },
      { path: "$.note", reason: "credential_value" },
      { path: "$.clip", reason: "audio" },
      { path: "$.pcm", reason: "audio" },
      { path: "$.samples", reason: "audio" },
      { path: "$.buffer", reason: "audio" },
    ]);
    expect(redactionViolations(value, "run")).toEqual([]);
  });
});
