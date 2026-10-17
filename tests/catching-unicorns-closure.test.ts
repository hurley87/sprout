import { afterEach, expect, it, vi } from "vitest";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import { CATCHING_UNICORNS_LESSON as lesson } from "../lib/lesson-runtime/catching-unicorns-lesson";
import { createLiveSessionConfig, teachingInstruction } from "../lib/lesson-runtime/live-context";
import { currentNodeContext } from "../lib/lesson-runtime/lesson-definition";
import { transcriptMessages } from "../lib/lesson-runtime/tutor-observation";
import {
  classificationSource,
  createLessonRuntime,
  reduceLessonRuntime,
  runtimeSource,
  type LessonRuntimeState,
  type LessonRuntimeEvent,
} from "../lib/lesson-runtime/lesson-runtime-reducer";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { useRuntimeFakeTimers, providerEvents } from "./helpers/runtime-harness";
import trace from "./fixtures/catching-unicorns-closure-oct16.json";

const transport = vi.hoisted(() => ({
  receive: undefined as ((event: ProviderEvent) => void) | undefined,
  send: vi.fn<(command: ClientCommand) => void>(),
  close: vi.fn(),
}));
vi.mock("../lib/browser-transport", async () => {
  const { mockBrowserTransport } = await import("./helpers/runtime-harness");
  return { BrowserTransport: mockBrowserTransport(transport) };
});
const definition = { ...lesson, initialNodeId: "exographics" };
const events = providerEvents(event => transport.receive!(event));
let runtime: LessonRuntime | undefined;
afterEach(() => {
  runtime?.stop();
  runtime = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});

function harness() {
  let state = createLessonRuntime("closure", { lesson: definition, quietDrainMs: 500 });
  const send = (event: Record<string, unknown>, delta = 1) => {
    const result = reduceLessonRuntime(
      state,
      { ...event, atMs: state.nowMs + delta } as LessonRuntimeEvent,
      definition,
    );
    state = result.state;
    return result;
  };
  send({ type: "child.turn.started", source: runtimeSource(state) });
  send({ type: "transcript.updated", source: runtimeSource(state), revision: 1, speaker: "child" });
  send({ type: "child.turn.ended", source: runtimeSource(state) });
  send({ type: "output.activity", source: runtimeSource(state), state: "active" });
  send({ type: "transcript.updated", source: runtimeSource(state), revision: 2, speaker: "tutor" });
  return {
    get state() {
      return state;
    },
    send,
    close() {
      return send({
        type: "proposal.received",
        source: classificationSource(state),
        transcriptSnapshot: trace.initialTranscript + "\nTutor: That makes sense. We can move on.",
        proposal: { ...trace.closureProposal, transcriptRevision: 2 },
      });
    },
  };
}

it("reproduces the recorded Question 4 stall from exact reducer events", () => {
  let state = trace.initialState as LessonRuntimeState;
  let renderedAt: number | undefined;
  for (const event of trace.recordedReducerEvents) {
    const result = reduceLessonRuntime(
      state,
      {
        ...event,
        ...("source" in event ? { source: { ...event.source, ...runtimeSource(state) } } : {}),
      } as LessonRuntimeEvent,
      lesson,
    );
    state = result.state;
    if (result.effects.some(effect => effect.type === "render.requested")) renderedAt = event.atMs;
  }
  expect(renderedAt).toBeCloseTo(trace.recordedRenderRequestedAtMs, 0);
  expect(state.nodeId).toBe("recap");
  expect(trace.recordedReducerEvents.filter(event => event.type === "conversation.advance.requested")).toHaveLength(0);
});

it("replays the recorded microphone/output sequence through the scheduler without losing a closure request to discarded energy", async () => {
  useRuntimeFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== "/api/classify") return Response.json({ ok: true });
      const input = JSON.parse(init!.body as string);
      await new Promise(resolve => setTimeout(resolve, trace.classifierLatencyMs));
      return Response.json({ proposal: { ...trace.closureProposal, transcriptRevision: input.transcriptRevision } });
    }),
  );
  runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, definition);
  runtime.confirmRendered(runtime.snapshot().display);
  await vi.advanceTimersByTimeAsync(0);
  const start = transport.send.mock.calls[0][0];
  if (start.type !== "session.instructions.append") throw Error("Expected steering");
  events.acknowledgeSteering(start.event_id, 0);
  await vi.advanceTimersByTimeAsync(trace.startAtMs);
  transport.receive!({ type: "output.activity", state: "quiet" });
  transport.receive!({ type: "microphone.speech_started" });
  const messages = transcriptMessages(trace.initialTranscript)!;
  messages.forEach((message, index) =>
    transport.receive!({
      type: "transcript",
      speaker: message.speaker === "Child" ? "child" : "sprout",
      delta: message.text,
      startMs: index * 100,
      endMs: index === messages.length - 1 ? 201600 : index * 100 + 100,
    }),
  );
  for (const item of trace.providerEvents) {
    await vi.advanceTimersByTimeAsync(item.atMs - performance.now());
    if (runtime.snapshot().runtime?.phase === "rendering") break;
    transport.receive!(item.event as ProviderEvent);
  }
  await vi.advanceTimersByTimeAsync(Math.max(0, 217900 - performance.now()));
  const report = runtime.report();
  const render = report.events.find(event => event.type === "render.requested");
  expect(render?.atMs).toBeCloseTo(200302.9, 0);
  expect(runtime.snapshot().runtime).toMatchObject({ nodeId: "recap", phase: "rendering" });
  // A real confirmed turn at 191402 has no text: retain bounded missing-text
  // recovery. The later 200101 energy burst must not abort that recheck.
  expect(
    report.events.some(event => event.type === "classifier.cancelled" && event.atMs > 199801 && event.atMs < 200303),
  ).toBe(false);
  expect(
    report.events.some(
      event => event.type === "runtime.event.proposal.received" && event.atMs > 200101 && event.atMs < 200303,
    ),
  ).toBe(true);
  const frozen = runtime.snapshot().recapText;
  expect(frozen).not.toMatch(/unresolved or skipped/i);
  runtime.confirmRendered(runtime.snapshot().display);
  const close = transport.send.mock.calls.at(-1)![0];
  expect(close).toMatchObject({ content: expect.stringContaining(JSON.stringify(frozen)) });
  runtime.report();
  expect(runtime.snapshot().recapText).toBe(frozen);
});

it("preserves closure and sustained audio quiet across discarded candidates", () => {
  const h = harness();
  h.close();
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
  const quiet = h.state.quietSinceMs;
  const turn = h.state.childTurnId;
  h.send({ type: "child.candidate.started", source: runtimeSource(h.state) });
  h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 1000);
  expect(h.state.phase).toBe("active");
  h.send({ type: "child.candidate.discarded", source: runtimeSource(h.state) });
  expect(h.state).toMatchObject({ nodeId: "recap", phase: "rendering", childTurnId: turn });
  expect(quiet).not.toBeNull();
});
it("accepts an in-flight exact closure during a candidate, then waits for audio drain", () => {
  const h = harness();
  const source = classificationSource(h.state)!;
  h.send({ type: "child.candidate.started", source: runtimeSource(h.state) });
  h.send({
    type: "proposal.received",
    source,
    transcriptSnapshot: trace.initialTranscript,
    proposal: { ...trace.closureProposal, transcriptRevision: 2 },
  });
  expect(h.state.conversationAdvanceRequested).toBe("tutor");
  h.send({ type: "child.candidate.discarded", source: runtimeSource(h.state) });
  h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 1000);
  expect(h.state.phase).toBe("active"); // Tutor audio is still active.
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
  h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 499);
  expect(h.state.phase).toBe("active");
  h.send({ type: "clock.tick", source: runtimeSource(h.state) });
  expect(h.state.phase).toBe("rendering");
});
it.each(["child.turn.confirmed", "transcript.updated"])(
  "revokes closure on genuine interruption via %s and rejects stale proposals",
  type => {
    const h = harness();
    h.close();
    const old = classificationSource(h.state)!;
    h.send({ type: "child.candidate.started", source: runtimeSource(h.state) });
    h.send({ type, source: runtimeSource(h.state), speaker: "child", revision: 3 });
    expect(h.state.childTurnId).toBe(old.childTurnId + 1);
    expect(h.state.conversationAdvanceRequested).toBe(false);
    h.send({ type: "child.turn.ended", source: runtimeSource(h.state) });
    const before = h.state.conceptEvidence;
    h.send({
      type: "proposal.received",
      source: old,
      transcriptSnapshot: trace.initialTranscript,
      proposal: { ...trace.closureProposal, transcriptRevision: 2 },
    });
    h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
    h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 1000);
    expect(h.state.phase).toBe("active");
    expect(h.state.conceptEvidence).toBe(before);
  },
);
it("keeps ambiguous answers open for clarification without changing mastery", () => {
  const h = harness();
  h.send({
    type: "proposal.received",
    source: classificationSource(h.state),
    transcriptSnapshot: trace.initialTranscript,
    proposal: { ...trace.closureProposal, transcriptRevision: 2, tutorState: "clarifying", conceptObservations: [] },
  });
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
  h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 1000);
  expect(h.state).toMatchObject({ phase: "active", conversationAdvanceRequested: false, conceptEvidence: {} });
});
it("makes scene-specific sufficiency and accurate acknowledgment explicit in live instructions", () => {
  for (const id of ["exogram", "compare", "exographics"]) {
    const instruction = teachingInstruction(currentNodeContext(lesson, id), lesson);
    expect(instruction).toContain("signal closure");
  }
  const instructions = createLiveSessionConfig(lesson).instructions;
  expect(instructions).toContain("Acknowledge only the accurate part");
  expect(instructions).toContain("Assessment uncertainty does not require more answers");
});

it("shares one personalized frozen recap across display, steering and completion verification", async () => {
  useRuntimeFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== "/api/classify") return Response.json({ ok: true });
      const input = JSON.parse(init!.body as string);
      return Response.json({
        proposal: {
          ...trace.closureProposal,
          transcriptRevision: input.transcriptRevision,
          conceptObservations: [
            { criterionId: "cultural-agreement", observation: "demonstrated_independent", childMessageIndex: 1 },
          ],
        },
      });
    }),
  );
  runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, definition);
  runtime.confirmRendered(runtime.snapshot().display);
  await vi.advanceTimersByTimeAsync(0);
  const start = transport.send.mock.calls[0][0];
  if (start.type !== "session.instructions.append") throw Error("Expected steering");
  events.acknowledgeSteering(start.event_id, 0);
  events.tutorTurn("What does exographics mean?", 100);
  events.childTurn(trace.acceptedLearnerEvidence.source.childTranscript, 300);
  events.tutorTurn("That makes sense. We can move on.", 500);
  await vi.advanceTimersByTimeAsync(1200);
  const frozen = runtime.snapshot().recapText!;
  expect(frozen).toContain("shared understanding");
  runtime.confirmRendered(runtime.snapshot().display);
  const close = transport.send.mock.calls.at(-1)![0];
  if (close.type !== "session.instructions.append") throw Error("Expected recap steering");
  expect(close.content).toContain(JSON.stringify(frozen));
  events.acknowledgeSteering(close.event_id, 1000);
  events.tutorTurn(frozen, 1100);
  await vi.advanceTimersByTimeAsync(1600);
  expect(runtime.snapshot().recapText).toBe(frozen);
  expect(runtime.snapshot().runtime).toMatchObject({ terminalTranscriptComplete: true, phase: "rendering" });
  runtime.confirmRendered(runtime.snapshot().display);
  expect(runtime.snapshot()).toMatchObject({ status: "ended", recapText: frozen, runtime: { phase: "complete" } });
});

it("does not let a duplicate classification revoke an accepted closure", () => {
  const h = harness();
  h.close();
  const source = classificationSource(h.state)!;
  h.send({
    type: "proposal.received",
    source,
    transcriptSnapshot: trace.initialTranscript,
    proposal: { ...trace.closureProposal, transcriptRevision: 2, tutorState: "clarifying", conceptObservations: [] },
  });
  expect(h.state.conversationAdvanceRequested).toBe("tutor");
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
  h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 500);
  expect(h.state.phase).toBe("rendering");
});

it("keeps a learner navigation request across discarded energy without granting mastery", () => {
  const h = harness();
  h.send({
    type: "conversation.advance.requested",
    source: classificationSource(h.state),
    transcriptSnapshot: "Child: Next question, then",
  });
  h.send({ type: "child.candidate.started", source: runtimeSource(h.state) });
  h.send({ type: "child.candidate.discarded", source: runtimeSource(h.state) });
  expect(h.state.conversationAdvanceRequested).toBe("learner");
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
  h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 500);
  expect(h.state).toMatchObject({ nodeId: "recap", phase: "rendering", conceptEvidence: {} });
});
