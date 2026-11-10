import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { summarizeGardenSession } from "../lib/garden-rescue/evidence-summary";
import { gardenGameEvents, projectGardenGame, type GardenGameEvent } from "../lib/garden-rescue/game-state";
import { GARDEN_RESCUE_LESSON, GARDEN_RESCUE_NODE_IDS as ids } from "../lib/lesson-runtime/garden-rescue-lesson";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
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

const NUMBERS = ["zero", "one", "two", "three", "four", "five"];
const lastLine = (transcript: string, speaker: "Child" | "Tutor") =>
  transcript
    .split("\n")
    .filter(line => line.startsWith(`${speaker}:`))
    .at(-1) ?? "";

/** Fake classifier route: labels come from the scripted words, as Jev's would. `abstain` returns
 * a null proposal for matching snapshots, leaving that tutor turn without a feedback label. */
function stubClassifier(abstain?: RegExp) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const input = JSON.parse(init.body as string) as {
        nodeId: string;
        transcriptRevision: number;
        transcript: string;
      };
      const tutorLast = input.transcript.split("\n").at(-1)?.startsWith("Tutor:") ?? false;
      if (abstain && tutorLast && abstain.test(lastLine(input.transcript, "Tutor")))
        return Response.json({ proposal: null });
      const quantity = (GARDEN_RESCUE_LESSON.nodes[input.nodeId].presentation as { quantity: number }).quantity;
      const child = lastLine(input.transcript, "Child").toLowerCase();
      const said = NUMBERS.findIndex(word => new RegExp(`\\b${word}\\b`).test(child));
      const answerOutcome =
        said < 0 ? (/mumble/.test(child) ? "unclear" : "none") : said === quantity ? "correct" : "incorrect";
      const tutor = lastLine(input.transcript, "Tutor");
      return Response.json({
        proposal: {
          nodeId: input.nodeId,
          transcriptRevision: input.transcriptRevision,
          childActivity: "unknown",
          answerOutcome,
          answerCommitment:
            answerOutcome === "correct" || answerOutcome === "incorrect"
              ? "committed"
              : answerOutcome === "unclear"
                ? "unresolved"
                : "no_answer",
          supportState: /\bhelp\b/.test(child) ? "needs_help" : "none",
          tutorState: !tutorLast
            ? "unknown"
            : /point/i.test(tutor)
              ? "helping"
              : /say that again/i.test(tutor)
                ? "clarifying"
                : /^Tutor: Yes/.test(tutor)
                  ? "acknowledging"
                  : "asking",
        },
      });
    }),
  );
}

/** Drives the real LessonRuntime through scripted provider events and records the game-event log
 * exactly as the Garden page derives it, from successive published snapshots. */
async function gardenRun(abstain?: RegExp) {
  stubClassifier(abstain);
  const gameEvents: GardenGameEvent[] = [];
  let game = projectGardenGame(null);
  const runtime = new LessonRuntime(
    {} as HTMLAudioElement,
    snapshot => {
      const next = projectGardenGame(snapshot);
      gameEvents.push(...gardenGameEvents(game, next));
      game = next;
    },
    GARDEN_RESCUE_LESSON,
  );
  let t = 0;
  const emit = (event: ProviderEvent) => transport.receive!(event);
  const acknowledgeSteering = () => {
    const steer = transport.send.mock.calls.map(([command]) => command).findLast(c => c.event_id.includes(":steer:"))!;
    t += 100;
    emit({
      type: "context.appended",
      name: "session.instructions.appended",
      clientEventId: steer.event_id,
      startMs: t,
    });
  };
  runtime.confirmRendered(runtime.snapshot().display);
  acknowledgeSteering();
  const run = {
    runtime,
    gameEvents,
    async child(text: string) {
      t += 1_000;
      emit({ type: "microphone.activity_started" });
      emit({ type: "transcript", speaker: "child", delta: text, startMs: t, endMs: t + 100 });
      emit({ type: "microphone.speech_stopped", quietMs: 900 });
      await vi.advanceTimersByTimeAsync(400);
    },
    async tutor(text: string, waitMs = 1_500) {
      t += 1_000;
      emit({ type: "transcript", speaker: "sprout", delta: text, startMs: t, endMs: t + 100 });
      emit({ type: "output.activity", state: "active", sourceId: 1 });
      emit({ type: "output.activity", state: "quiet", sourceId: 1 });
      await vi.advanceTimersByTimeAsync(waitMs);
    },
    /** Hold, then confirm the requested scene and acknowledge its steering. */
    async advance() {
      await vi.advanceTimersByTimeAsync(GARDEN_RESCUE_LESSON.successHoldMs! + 500);
      const snapshot = runtime.snapshot();
      expect(snapshot.runtime?.phase).toBe("rendering");
      runtime.confirmRendered(snapshot.display);
      if (runtime.snapshot().runtime?.phase !== "complete") acknowledgeSteering();
      await vi.advanceTimersByTimeAsync(100);
    },
    async succeed(word: string, child = word) {
      await run.child(child);
      await run.tutor(`Yes, ${word}!`);
      await run.advance();
    },
    summary() {
      return summarizeGardenSession({ report: runtime.report(), gameEvents });
    },
  };
  return run;
}
const visit = (summary: ReturnType<Awaited<ReturnType<typeof gardenRun>>["summary"]>, index = 0) =>
  summary.rehearsals[index];

let active: Awaited<ReturnType<typeof gardenRun>> | undefined;
beforeEach(() => useRuntimeFakeTimers());
afterEach(() => {
  active?.runtime.stop();
  active = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function start(abstain?: RegExp) {
  active = await gardenRun(abstain);
  return active;
}

describe("Garden evidence summary", () => {
  it("records a correct answer with no help as none_observed with an authorized effect", async () => {
    const run = await start();
    await run.succeed("three");
    const summary = run.summary();
    const first = visit(summary);
    expect(summary).toMatchObject({ schema: "garden-evidence/v1", lessonId: "garden-rescue", ending: "in_progress" });
    expect(summary.classifierVersion).toBe("conversation-state-v2");
    expect(first).toMatchObject({
      questId: ids[0],
      visitId: 1,
      probe: "rehearsal",
      skillId: "count-total-1-5",
      quantity: 3,
      sceneVersion: "1",
      outcome: "succeeded",
      support: "none_observed",
      selfCorrected: false,
      difficulties: [],
      supportLimit: { status: "not_reached" },
      countingStrategy: "unknown",
      hints: { count: 0 },
      clarifications: { count: 0 },
    });
    expect(first.attempts).toEqual([
      expect.objectContaining({ answerOutcome: "correct", answerCommitment: "committed", status: "accepted" }),
    ]);
    const outcome = run.runtime.report().runtime!.visitOutcomes![0];
    expect(first.effect).toEqual({
      name: "ducklings.crossed",
      authorized: true,
      authorizedBy: outcome.source,
      renderConfirmed: true,
      playback: "unknown",
    });
    expect(visit(summary, 1)).toMatchObject({ questId: ids[1], outcome: "in_progress", attempts: [], effect: null });
    expect(summary.integrity).toEqual({ ok: true, issues: [] });
  });

  it("records a hint before acceptance as hinted, with observed audio", async () => {
    const run = await start();
    await run.child("I don't know");
    await run.tutor("Try pointing to each duckling.");
    await run.succeed("three");
    const first = visit(run.summary());
    expect(first.support).toBe("hinted");
    expect(first.hints).toEqual({
      count: 1,
      items: [expect.objectContaining({ beforeAcceptance: true, delivery: "audio_observed" })],
    });
    expect(first.selfCorrected).toBe(false);
    expect(first.difficulties).toEqual([]);
    expect(first.outcome).toBe("succeeded");
  });

  it("records a clarification without hints as clarification_only", async () => {
    const run = await start();
    await run.child("mumble");
    await run.tutor("Can you say that again?");
    await run.succeed("three");
    const first = visit(run.summary());
    expect(first.support).toBe("clarification_only");
    expect(first.clarifications.count).toBe(1);
    expect(first.hints.count).toBe(0);
    expect(first.attempts.map(attempt => [attempt.answerOutcome, attempt.status])).toEqual([
      ["unclear", "superseded"],
      ["correct", "accepted"],
    ]);
  });

  it("records incorrect then correct as self-corrected with one difficulty", async () => {
    const run = await start();
    await run.child("Two");
    await run.tutor("Are you sure?");
    await run.succeed("three");
    const first = visit(run.summary());
    expect(first.selfCorrected).toBe(true);
    expect(first.difficulties).toEqual([expect.objectContaining({ kind: "incorrect", visitId: 1 })]);
    expect(first.support).toBe("none_observed");
    expect(first.outcome).toBe("succeeded");
  });

  it("does not count repeated unclear speech as difficulty and keeps the quest unfinished", async () => {
    const run = await start();
    for (let i = 0; i < 3; i++) await run.child("mumble");
    const live = visit(run.summary());
    expect(live).toMatchObject({ outcome: "in_progress", difficulties: [], supportLimit: { status: "not_reached" } });
    run.runtime.stop();
    const stopped = run.summary();
    expect(visit(stopped).outcome).toBe("unfinished_stopped");
    expect(stopped.ending).toBe("stopped");
  });

  it("releases after repeated difficulty with no effect, and a released last quest completes with release", async () => {
    const run = await start();
    await run.succeed("three");
    await run.succeed("three");
    await run.succeed("four");
    for (let i = 0; i < 3; i++) await run.child("Two");
    await run.tutor("That is OK, thank you for helping.", 500);
    await run.advance();
    const summary = run.summary();
    expect(summary.ending).toBe("completed_with_release");
    expect(summary.transfer).toMatchObject({
      questId: ids[3],
      outcome: "released_after_support_limit",
      effect: null,
      supportLimit: { status: "reached", close: "sent" },
    });
    expect(summary.transfer!.difficulties).toHaveLength(3);
    expect(summary.transfer!.attempts.some(attempt => attempt.status === "accepted")).toBe(false);
    expect(summary.integrity.ok).toBe(true);
  });

  it("reports Stop mid-quest as unfinished_stopped and the run as stopped", async () => {
    const run = await start();
    await run.succeed("three");
    await run.child("Two");
    run.runtime.stop();
    const summary = run.summary();
    expect(summary.ending).toBe("stopped");
    expect(visit(summary, 0).outcome).toBe("succeeded");
    expect(visit(summary, 1)).toMatchObject({ outcome: "unfinished_stopped", effect: null });
    expect(summary.integrity.ok).toBe(true);
  });

  it("reports a technical error distinctly", async () => {
    const run = await start();
    await run.child("Two");
    transport.receive!({ type: "provider.error", code: "server_error" });
    const summary = run.summary();
    expect(summary.ending).toBe("error");
    expect(visit(summary).outcome).toBe("unfinished_error");
    expect(summary.integrity.ok).toBe(true);
  });

  it("never counts a superseded correct answer as the success", async () => {
    const run = await start();
    await run.child("Three");
    await run.child("No, two");
    await run.succeed("three");
    const first = visit(run.summary());
    expect(first.attempts.map(attempt => [attempt.answerOutcome, attempt.status, attempt.heldAuthority])).toEqual([
      ["correct", "superseded", true],
      ["incorrect", "superseded", false],
      ["correct", "accepted", true],
    ]);
    const outcome = run.runtime.report().runtime!.visitOutcomes![0];
    const accepted = first.attempts.find(attempt => attempt.status === "accepted")!;
    expect(accepted.childTurnId).toBe(outcome.source.childTurnId);
    expect(first.attempts.filter(attempt => attempt.status === "accepted")).toHaveLength(1);
    expect(first.selfCorrected).toBe(true);
  });

  it("reports unknown support when a tutor turn before acceptance has no feedback label", async () => {
    const run = await start(/point/);
    await run.child("I don't know");
    await run.tutor("Try pointing to each duckling.");
    await run.succeed("three");
    const first = visit(run.summary());
    expect(first.outcome).toBe("succeeded");
    expect(first.hints.count).toBe(0);
    expect(first.support).toBe("unknown");
  });

  it("reports the transfer probe separately from rehearsals", async () => {
    const run = await start();
    await run.succeed("three");
    await run.succeed("three");
    await run.succeed("four");
    await run.succeed("four");
    const summary = run.summary();
    expect(summary.ending).toBe("completed_all_restored");
    expect(summary.rehearsals.map(visit => [visit.questId, visit.probe])).toEqual([
      [ids[0], "rehearsal"],
      [ids[1], "rehearsal"],
      [ids[2], "rehearsal"],
    ]);
    expect(summary.rehearsals.every(visit => visit.effect?.authorized)).toBe(true);
    expect(summary.transfer).toMatchObject({
      questId: ids[3],
      probe: "transfer",
      quantity: 4,
      outcome: "succeeded",
      support: "none_observed",
      effect: null,
    });
    expect(summary.integrity).toEqual({ ok: true, issues: [] });
  });

  it("flags a forged world effect and duplicate success that no succeeded outcome backs", async () => {
    const run = await start();
    await run.child("Two");
    run.runtime.stop();
    const report = run.runtime.report();
    const runId = report.runtimeId;
    const forged: GardenGameEvent[] = [
      ...run.gameEvents,
      { type: "quest.succeeded", runId, questId: ids[0] },
      { type: "world.effect", runId, questId: ids[0], visitId: 1, effect: "ducklings.crossed" },
      { type: "quest.succeeded", runId, questId: ids[0] },
    ];
    const summary = summarizeGardenSession({ report, gameEvents: forged });
    expect(summary.integrity.ok).toBe(false);
    expect(summary.integrity.issues).toEqual(
      expect.arrayContaining([
        { code: "quest_succeeded_without_outcome", questId: ids[0] },
        { code: "world_effect_without_outcome", questId: ids[0], visitId: 1 },
        { code: "duplicate_success", questId: ids[0] },
      ]),
    );
    expect(visit(summary).effect).toBeNull();
    expect(visit(summary).outcome).toBe("unfinished_stopped");
  });

  it("contains no transcript text and never claims mastery or independence", async () => {
    const run = await start();
    await run.child("I think fuzzy duckies");
    await run.tutor("Try pointing to each fuzzy duckling.");
    await run.succeed("three", "Three fuzzy duckies please");
    await run.child("Two");
    run.runtime.stop();
    const report = run.runtime.report();
    expect(JSON.stringify(report)).toContain("fuzzy duckies");
    const summary = summarizeGardenSession({ report, gameEvents: run.gameEvents });
    const json = JSON.stringify(summary);
    expect(json).not.toMatch(/fuzzy|duckies|pointing/i);
    expect(json).not.toMatch(/master|independen/i);
    expect(summarizeGardenSession({ report, gameEvents: run.gameEvents })).toEqual(summary);
  });
});
