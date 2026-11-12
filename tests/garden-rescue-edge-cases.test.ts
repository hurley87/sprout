// Existing coverage: ordinary correct/incorrect/unclear answers, explicit help, separate-turn
// correction, transfer reporting and render-confirmed progression are covered by garden-evidence-
// summary, garden-bounded-support and garden-rescue-game-state tests. Success-hold covers renewed speech.
// This file also covers source replacement, duplicate input, delayed render confirmation and spoken revisions.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { GARDEN_RESCUE_LESSON, GARDEN_RESCUE_NODE_IDS as ids } from "../lib/lesson-runtime/garden-rescue-lesson";
import { classificationSource, runtimeSource } from "../lib/lesson-runtime/lesson-runtime-reducer";
import { classifierProposal } from "./helpers/runtime-classifier";
import { gardenRun } from "./helpers/garden-session";
import { createReducerHarness, prepareLearnerClassification, useRuntimeFakeTimers } from "./helpers/runtime-harness";

const transport = vi.hoisted(() => ({
  receive: undefined as ((event: ProviderEvent) => void) | undefined,
  send: vi.fn<(command: ClientCommand) => void>(),
  close: vi.fn(),
  instance: undefined as { activeSourceId: number } | undefined,
}));
vi.mock("../lib/browser-transport", async () => {
  const { mockBrowserTransport } = await import("./helpers/runtime-harness");
  const Base = mockBrowserTransport(transport);
  return {
    BrowserTransport: class extends Base {
      constructor() {
        super();
        transport.instance = this;
      }
    },
  };
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
const successes = (run: Awaited<ReturnType<typeof gardenRun>>) =>
  run.gameEvents.filter(event => event.type === "quest.succeeded" || event.type === "world.effect");

it("keeps silence and a long pause on the current quest without evidence", async () => {
  const run = (active = await gardenRun(transport));
  transport.receive!({ type: "microphone.activity_started" });
  transport.receive!({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(run.runtime.snapshot().runtime?.nodeId).toBe(ids[0]);
  expect(run.runtime.snapshot().runtime?.visitOutcomes).toEqual([]);
  expect(successes(run)).toEqual([]);
});

it("does not commit while tutor output is unavailable", async () => {
  const run = (active = await gardenRun(transport));
  await run.child("three");
  transport.receive!({ type: "output.activity", state: "unavailable", sourceId: 1 });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(run.runtime.snapshot().runtime?.visitOutcomes).toEqual([]);
  expect(run.runtime.snapshot().display.nodeId).toBe(ids[0]);
  expect(successes(run)).toEqual([]);
});

it("waits for the exact render acknowledgement and ignores it after Stop", async () => {
  const run = (active = await gardenRun(transport));
  await run.child("three");
  await run.tutor("Yes, three!");
  await vi.advanceTimersByTimeAsync(4_000);
  const pending = run.runtime.snapshot().display;
  expect(run.runtime.snapshot().runtime?.phase).toBe("rendering");
  expect(successes(run)).toEqual([]);
  run.runtime.stop();
  run.runtime.confirmRendered(pending);
  expect(run.runtime.snapshot().runtime?.visitOutcomes).toEqual([]);
  expect(successes(run)).toEqual([]);
});

it("rejects a previous visit classification and duplicate classification after commit", () => {
  const h = createReducerHarness("edge", { lesson: GARDEN_RESCUE_LESSON, quietDrainMs: 250 });
  const source = prepareLearnerClassification(h, 1);
  const proposal = classifierProposal(source, {
    answerOutcome: "correct",
    answerCommitment: "committed",
    tutorState: "acknowledging",
  });
  const event = { type: "proposal.received" as const, source, proposal, transcriptSnapshot: "Child: Three" };
  h.send(event);
  h.send(event);
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "active" });
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
  h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 4_000);
  expect(h.state.phase).toBe("rendering");
  expect(h.state.visitOutcomes).toEqual([]);
  h.send({ type: "render.confirmed", runtimeId: h.state.runtimeId, identity: h.state.pendingRender!.identity });
  expect(h.state.nodeId).toBe(ids[1]);
  h.send(event);
  expect(h.state.nodeId).toBe(ids[1]);
  expect(h.state.answerAccepted).toBe(false);
  expect(h.state.visitOutcomes).toHaveLength(1);
});

it("does not carry a pending answer into a replay", async () => {
  const first = (active = await gardenRun(transport));
  await first.child("three");
  first.runtime.stop();
  const replay = (active = await gardenRun(transport));
  await vi.advanceTimersByTimeAsync(5_000);
  expect(replay.runtime.snapshot().runtime?.nodeId).toBe(ids[0]);
  expect(replay.runtime.snapshot().runtime?.visitOutcomes).toEqual([]);
  expect(successes(replay)).toEqual([]);
});

it("keeps a revised same-turn answer authoritative over the earlier guess", () => {
  const h = createReducerHarness("correction", { lesson: GARDEN_RESCUE_LESSON, quietDrainMs: 250 });
  const old = prepareLearnerClassification(h, 1);
  h.send({ type: "transcript.updated", source: runtimeSource(h.state), speaker: "child", revision: 2 });
  const stale = h.send({
    type: "proposal.received",
    source: old,
    proposal: classifierProposal(old, {
      answerOutcome: "correct",
      answerCommitment: "committed",
      tutorState: "acknowledging",
    }),
    transcriptSnapshot: "Child: three",
  });
  expect(stale.effects).not.toContainEqual(expect.objectContaining({ type: "render.requested" }));
  expect(h.state.answerAccepted).toBe(false);
  const revised = classificationSource(h.state)!;
  h.send({
    type: "proposal.received",
    source: revised,
    proposal: classifierProposal(revised, {
      answerOutcome: "incorrect",
      answerCommitment: "committed",
      tutorState: "acknowledging",
    }),
    transcriptSnapshot: "Child: three... no, four",
  });
  expect(h.state.answerAccepted).toBe(false);
  expect(h.state.visitOutcomes).toEqual([]);
});

it("cancels success when the child interrupts tutor feedback with a wrong answer", async () => {
  const run = (active = await gardenRun(transport));
  await run.child("three");
  transport.receive!({ type: "output.activity", state: "active", sourceId: 1 });
  await run.child("no, two");
  transport.receive!({ type: "output.activity", state: "quiet", sourceId: 1 });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(run.runtime.snapshot().runtime?.nodeId).toBe(ids[0]);
  expect(run.runtime.snapshot().runtime?.visitOutcomes).toEqual([]);
  expect(successes(run)).toEqual([]);
});

it("ignores old audio source events and disconnects without committing", async () => {
  const run = (active = await gardenRun(transport));
  await run.child("three");
  transport.receive!({ type: "output.activity", state: "active", sourceId: 99 });
  transport.receive!({ type: "output.activity", state: "quiet", sourceId: 99 });
  transport.receive!({ type: "session.closed", sourceId: 1 });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(run.runtime.snapshot().runtime?.visitOutcomes).toEqual([]);
  expect(successes(run)).toEqual([]);
});

// An in-flight classification from a retired transport source must not commit.
it("rejects old-source input after microphone replacement and accepts the new source", async () => {
  const run = (active = await gardenRun(transport));
  const base = vi.mocked(fetch).getMockImplementation()!;
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  let held = false;
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    const response = await base(url, init);
    if (!held) {
      held = true;
      await gate;
    }
    return response;
  });
  transport.receive!({ type: "microphone.activity_started", sourceId: 1 });
  transport.receive!({ type: "transcript", sourceId: 1, speaker: "child", delta: "three", startMs: 500, endMs: 600 });
  transport.receive!({ type: "microphone.speech_stopped", sourceId: 1, quietMs: 900 });
  await vi.advanceTimersByTimeAsync(400);
  expect(held).toBe(true);
  transport.instance!.activeSourceId = 2;
  transport.receive!({ type: "microphone.activity_started", sourceId: 1 });
  transport.receive!({ type: "transcript", sourceId: 1, speaker: "child", delta: "three", startMs: 1000, endMs: 1100 });
  transport.receive!({ type: "microphone.speech_stopped", sourceId: 1, quietMs: 900 });
  release();
  await vi.advanceTimersByTimeAsync(1000);
  expect(run.runtime.snapshot().runtime?.answerAccepted).toBe(false);
  expect(run.runtime.snapshot().runtime?.visitOutcomes).toEqual([]);
  expect(successes(run)).toEqual([]);
  transport.receive!({ type: "microphone.activity_started", sourceId: 2 });
  transport.receive!({ type: "transcript", sourceId: 2, speaker: "child", delta: "three", startMs: 2000, endMs: 2100 });
  transport.receive!({ type: "microphone.speech_stopped", sourceId: 2, quietMs: 900 });
  await vi.advanceTimersByTimeAsync(400);
  transport.receive!({
    type: "transcript",
    sourceId: 2,
    speaker: "sprout",
    delta: "Yes, three!",
    startMs: 3000,
    endMs: 3100,
  });
  transport.receive!({ type: "output.activity", sourceId: 2, state: "active" });
  transport.receive!({ type: "output.activity", sourceId: 2, state: "quiet" });
  await run.advance();
  expect(run.runtime.snapshot().runtime?.visitOutcomes).toHaveLength(1);
  expect(successes(run).map(e => e.type)).toEqual(["quest.succeeded", "world.effect"]);
});

it("accepts a correct answer from the replacement microphone source", async () => {
  const run = (active = await gardenRun(transport));
  transport.instance!.activeSourceId = 2;
  transport.receive!({ type: "microphone.activity_started", sourceId: 1 });
  transport.receive!({ type: "transcript", sourceId: 1, speaker: "child", delta: "three", startMs: 500, endMs: 600 });
  transport.receive!({ type: "microphone.speech_stopped", sourceId: 1, quietMs: 900 });
  await vi.advanceTimersByTimeAsync(400);
  expect(run.runtime.snapshot().runtime?.answerAccepted).toBe(false);
  transport.receive!({ type: "microphone.activity_started", sourceId: 2 });
  transport.receive!({ type: "transcript", sourceId: 2, speaker: "child", delta: "three", startMs: 2000, endMs: 2100 });
  transport.receive!({ type: "microphone.speech_stopped", sourceId: 2, quietMs: 900 });
  await vi.advanceTimersByTimeAsync(400);
  transport.receive!({
    type: "transcript",
    sourceId: 2,
    speaker: "sprout",
    delta: "Yes, three!",
    startMs: 3000,
    endMs: 3100,
  });
  transport.receive!({ type: "output.activity", sourceId: 2, state: "active" });
  transport.receive!({ type: "output.activity", sourceId: 2, state: "quiet" });
  await run.advance();
  expect(run.runtime.snapshot().runtime?.visitOutcomes).toHaveLength(1);
  expect(successes(run).map(e => e.type)).toEqual(["quest.succeeded", "world.effect"]);
});

it("deduplicates delivered transcript events and repeated answers", async () => {
  const run = (active = await gardenRun(transport));
  transport.receive!({ type: "microphone.activity_started" });
  const fragment = {
    type: "transcript" as const,
    eventId: "same-revision",
    speaker: "child" as const,
    delta: "three",
    startMs: 500,
    endMs: 600,
  };
  transport.receive!(fragment);
  transport.receive!(fragment);
  transport.receive!({ type: "microphone.speech_stopped", quietMs: 900, eventId: "same-final" });
  transport.receive!({ type: "microphone.speech_stopped", quietMs: 900, eventId: "same-final" });
  await vi.advanceTimersByTimeAsync(400);
  await run.child("three");
  await run.tutor("Yes, three!");
  await run.advance();
  expect(run.runtime.snapshot().runtime?.visitOutcomes).toHaveLength(1);
  expect(successes(run).map(e => e.type)).toEqual(["quest.succeeded", "world.effect"]);
});

it("commits only when a delayed valid render acknowledgement arrives", async () => {
  const run = (active = await gardenRun(transport));
  await run.child("three");
  await run.tutor("Yes, three!");
  await vi.advanceTimersByTimeAsync(10_000);
  const pending = run.runtime.snapshot().display;
  expect(run.runtime.snapshot().runtime?.phase).toBe("rendering");
  expect(run.runtime.snapshot().runtime?.visitOutcomes).toEqual([]);
  expect(successes(run)).toEqual([]);
  run.runtime.confirmRendered(pending);
  expect(run.runtime.snapshot().runtime?.visitOutcomes).toHaveLength(1);
  expect(successes(run).map(e => e.type)).toEqual(["quest.succeeded", "world.effect"]);
});

/** Keep the real transcript path; script the provider-free classifier's interpretation of corrections. */
function interpretCorrections() {
  const base = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url, init) => {
    const body = JSON.parse(init!.body as string) as { transcript: string };
    body.transcript = body.transcript.replace(/three\.\.\. no, four/gi, "four").replace(/four\s*wait, five/gi, "five");
    return base(url, { ...init, body: JSON.stringify(body) });
  });
}

it("uses the correction in an evolving spoken transcript", async () => {
  const run = (active = await gardenRun(transport));
  interpretCorrections();
  await run.succeed("three");
  await run.succeed("three");
  transport.receive!({ type: "microphone.activity_started" });
  transport.receive!({ type: "transcript", speaker: "child", delta: "three...", startMs: 4500, endMs: 4600 });
  await vi.advanceTimersByTimeAsync(400);
  expect(run.runtime.snapshot().runtime?.visitOutcomes).toHaveLength(2);
  transport.receive!({ type: "transcript", speaker: "child", delta: " no, four", startMs: 4600, endMs: 4700 });
  transport.receive!({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(400);
  await run.tutor("Yes, four!");
  await run.advance();
  expect(run.runtime.snapshot().runtime?.visitOutcomes).toHaveLength(3);
  expect(successes(run).map(e => e.type)).toEqual([
    "quest.succeeded",
    "world.effect",
    "quest.succeeded",
    "world.effect",
    "quest.succeeded",
    "world.effect",
  ]);
});

it("withdraws a correct answer when a later spoken turn changes it to five", async () => {
  const run = (active = await gardenRun(transport));
  interpretCorrections();
  await run.succeed("three");
  await run.succeed("three");
  await run.child("four");
  await run.child("wait, five");
  await run.tutor("Let's count again.");
  await vi.advanceTimersByTimeAsync(5000);
  expect(run.runtime.snapshot().runtime?.nodeId).toBe(ids[2]);
  expect(run.runtime.snapshot().runtime?.visitOutcomes).toHaveLength(2);
  expect(successes(run)).toHaveLength(4);
});
