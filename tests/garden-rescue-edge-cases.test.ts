// Existing coverage: ordinary correct/incorrect/unclear answers, explicit help, separate-turn
// correction, transfer reporting and render-confirmed progression are covered by garden-evidence-
// summary, garden-bounded-support and garden-rescue-game-state tests. Success-hold covers renewed speech.
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
  const proposal = classifierProposal(source, { answerOutcome: "correct", answerCommitment: "committed", tutorState: "acknowledging" });
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
  const stale = h.send({ type: "proposal.received", source: old, proposal: classifierProposal(old, {
    answerOutcome: "correct", answerCommitment: "committed", tutorState: "acknowledging",
  }), transcriptSnapshot: "Child: three" });
  expect(stale.effects).not.toContainEqual(expect.objectContaining({ type: "render.requested" }));
  expect(h.state.answerAccepted).toBe(false);
  const revised = classificationSource(h.state)!;
  h.send({ type: "proposal.received", source: revised, proposal: classifierProposal(revised, {
    answerOutcome: "incorrect", answerCommitment: "committed", tutorState: "acknowledging",
  }), transcriptSnapshot: "Child: three... no, four" });
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
