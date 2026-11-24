import { expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { DINO_CAR_CRUNCH_LESSON } from "../lib/lesson-runtime/dino-car-crunch-lesson";
import { ANSWER_RECOVERY_WAIT_MS } from "../lib/lesson-runtime/answer-recovery";
import { runtimeSource } from "../lib/lesson-runtime/lesson-runtime-reducer";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import trace from "./fixtures/dino-wordless-turn.json";
import { classifierProposal } from "./helpers/runtime-classifier";
import {
  createReducerHarness,
  prepareLearnerClassification,
  providerEvents,
  useRuntimeFakeTimers,
} from "./helpers/runtime-harness";

const transport = vi.hoisted(() => ({
  receive: undefined as ((event: ProviderEvent) => void) | undefined,
  send: vi.fn<(command: ClientCommand) => void>(),
  close: vi.fn(),
}));
vi.mock("../lib/browser-transport", async () => {
  const { mockBrowserTransport } = await import("./helpers/runtime-harness");
  return { BrowserTransport: mockBrowserTransport(transport) };
});

it("advances after the recorded wordless turn and discarded mic bursts", async () => {
  useRuntimeFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: RequestInit) => {
      const input = JSON.parse(init.body as string);
      expect(input.transcript).toContain("six, seven");
      return Response.json({
        proposal: classifierProposal(input, {
          answerOutcome: "correct",
          answerCommitment: "committed",
          tutorState: "acknowledging",
        }),
      });
    }),
  );
  const runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, DINO_CAR_CRUNCH_LESSON);
  const emit = (event: ProviderEvent) => transport.receive!(event);
  const acknowledge = (atMs: number) =>
    providerEvents(emit).acknowledgeSteering(transport.send.mock.calls.at(-1)![0].event_id, atMs);
  try {
    runtime.confirmRendered(runtime.snapshot().display);
    acknowledge(0);
    expect(runtime.snapshot().runtime?.nodeId).toBe(trace.nodeId);
    // Replay the recorded mic/output ordering through the burst at 36.96 s.
    // Consolidate transcript fragments and allow a final quiet interval for the render.
    for (const step of trace.timeline) {
      await vi.advanceTimersByTimeAsync(step.atMs - performance.now());
      if (step.atMs === 27691) expect(runtime.snapshot().runtime?.answerAccepted).toBe(true);
      emit(step.event as ProviderEvent);
      if (step.atMs === 29725)
        expect(runtime.snapshot().runtime).toMatchObject({ hasChildTranscript: false, answerAccepted: false });
    }
    await vi.advanceTimersByTimeAsync(trace.endMs - performance.now());
    expect(runtime.snapshot().display.nodeId).toBe("twenty-three");
    expect(runtime.snapshot().runtime?.phase).toBe("rendering");
    runtime.confirmRendered(runtime.snapshot().display);
    acknowledge(trace.endMs);
    expect(runtime.snapshot().runtime).toMatchObject({ phase: "active", nodeId: "twenty-three" });
  } finally {
    runtime.stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

function renewedTurn() {
  const lesson = DINO_CAR_CRUNCH_LESSON;
  const harness = createReducerHarness("dino-wordless-turn", { lesson, quietDrainMs: lesson.transitionQuietMs });
  const source = () => runtimeSource(harness.state);
  const answer = prepareLearnerClassification(harness, 1);
  harness.send({
    type: "proposal.received",
    source: answer,
    proposal: classifierProposal(answer, {
      answerOutcome: "correct",
      answerCommitment: "committed",
      tutorState: "asking",
    }),
    transcriptSnapshot: "Child: seven",
  });
  harness.send({ type: "output.activity", source: source(), state: "active" });
  harness.send({ type: "output.activity", source: source(), state: "quiet" });
  harness.send({ type: "child.candidate.started", source: source() });
  harness.send({ type: "child.turn.confirmed", source: source() });
  expect(harness.state).toMatchObject({ answerAccepted: false, hasChildTranscript: false });
  const resolve = (elapsedMs: number) =>
    harness.send(
      {
        type: "textless.turn.resolved",
        source: { ...source(), nodeId: harness.state.nodeId, transcriptRevision: harness.state.transcriptRevision },
      },
      elapsedMs,
    );
  return { harness, source, resolve };
}

it("restores the original revision after a wordless turn and waits for fresh quiet", () => {
  const { harness, source, resolve } = renewedTurn();
  harness.send({ type: "child.turn.ended", source: source() });
  const restored = resolve(ANSWER_RECOVERY_WAIT_MS);
  expect(restored.state).toMatchObject({ answerAccepted: true, acceptedAnswerRevision: 1, phase: "active" });
  expect(restored.effects).toEqual([]);
  const quiet = DINO_CAR_CRUNCH_LESSON.transitionQuietMs!;
  expect(harness.send({ type: "clock.tick", source: source() }, quiet - 1).effects).toEqual([]);
  expect(harness.send({ type: "clock.tick", source: source() }, 1).effects).toMatchObject([
    { type: "render.requested", identity: { nodeId: "twenty-three" } },
  ]);
});

it("keeps the scene held during child or tutor activity and drops the saved answer on new text", () => {
  const { harness, source, resolve } = renewedTurn();
  expect(resolve(ANSWER_RECOVERY_WAIT_MS).effects).toEqual([]);
  expect(harness.state.answerAccepted).toBe(false);
  harness.send({ type: "child.turn.ended", source: source() });
  harness.send({ type: "output.activity", source: source(), state: "active" });
  expect(resolve(ANSWER_RECOVERY_WAIT_MS).effects).toEqual([]);
  expect(harness.state.answerAccepted).toBe(false);
  harness.send({ type: "transcript.updated", source: source(), speaker: "child", revision: 2 });
  harness.send({ type: "output.activity", source: source(), state: "quiet" });
  expect(resolve(ANSWER_RECOVERY_WAIT_MS).effects).toEqual([]);
  expect(harness.state).toMatchObject({
    hasChildTranscript: true,
    answerAccepted: false,
    acceptedAnswerRevision: null,
    textlessTurnPrior: null,
    phase: "active",
  });
});
