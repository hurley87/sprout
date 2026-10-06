import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import trace from "./fixtures/butterfly-filler-confirmation.json";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import type { ConversationStateClassifierInput } from "../lib/lesson-runtime/conversation-state-classifier";
import {
  mapConversationObservation,
  type ConversationStateOutputs,
} from "../lib/lesson-runtime/conversation-observer-contract";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import { COUNTING_LESSON } from "../lib/lesson-runtime/counting-lesson";
import {
  classificationSource,
  reduceLessonRuntime,
  runtimeSource,
  type LessonRuntimeEvent,
  type LessonRuntimeState,
} from "./helpers/counting-runtime";

const recordedMapping = trace.steps.find(step => "mapping" in step)!.mapping!;
const outputs = recordedMapping.outputs as ConversationStateOutputs;
const transport = vi.hoisted(() => ({
  receive: undefined as ((event: ProviderEvent) => void) | undefined,
  send: vi.fn<(command: ClientCommand) => void>(),
}));
vi.mock("../lib/browser-transport", () => ({
  BrowserTransport: class {
    activeSourceId = 1;
    setMicrophoneDiagnosticSink() {}
    async start(receive: (event: ProviderEvent) => void) {
      transport.receive = receive;
      receive({ type: "session.started", sourceId: 1 });
    }
    openInput() {
      return true;
    }
    send = transport.send;
    close() {}
  },
}));

function replayReducer() {
  let state = trace.initialState as LessonRuntimeState;
  for (const step of trace.steps) {
    if ("event" in step) {
      const result = reduceLessonRuntime(state, step.event as LessonRuntimeEvent);
      expect(result.effects).toEqual([]);
      state = result.state;
    } else {
      expect(classificationSource(state)).toEqual({
        ...runtimeSource(state),
        nodeId: trace.classifierInput.nodeId,
        transcriptRevision: 55,
      });
      const mapped = mapConversationObservation({ ...trace.classifierInput, lesson: COUNTING_LESSON } as ConversationStateClassifierInput, outputs);
      expect(mapped).toMatchObject({ status: "abstained", reason: "objectiveState_no_winner", proposal: null });
      // A null proposal does not enter the reducer or restore old authority.
    }
  }
  return state;
}

describe("saved butterfly filler-confirmation evidence (provider-free)", () => {
  it("replays the production reducer transitions and exact final held state", () => {
    expect(replayReducer()).toEqual(trace.expectedState);
  });

  it("still needs a fresh tutor revision if the child-ending snapshot hypothetically classifies correct", () => {
    let state = replayReducer();
    const proposal = {
      nodeId: state.nodeId,
      transcriptRevision: state.transcriptRevision,
      childActivity: "unknown",
      answerOutcome: "correct",
      supportState: "none",
      tutorState: "acknowledging",
    };
    const held = reduceLessonRuntime(state, {
      type: "proposal.received",
      source: classificationSource(state)!,
      proposal,
      atMs: state.nowMs + 1,
    });
    expect(held.effects).toEqual([]);
    expect(held.state).toMatchObject({ answerAccepted: true, acknowledgmentObserved: false, phase: "active" });
    state = reduceLessonRuntime(held.state, {
      type: "transcript.updated",
      source: runtimeSource(held.state),
      revision: 56,
      speaker: "tutor",
      atMs: state.nowMs + 2,
    }).state;
    const fresh = reduceLessonRuntime(state, {
      type: "proposal.received",
      source: classificationSource(state)!,
      proposal: { ...proposal, transcriptRevision: 56 },
      atMs: state.nowMs + 1,
    });
    expect(fresh.effects).toEqual([{ type: "render.requested", identity: fresh.state.pendingRender!.identity }]);
    expect(fresh.state).toMatchObject({ phase: "rendering", lessonComplete: true });
    const confirmed = reduceLessonRuntime(fresh.state, {
      type: "render.confirmed",
      runtimeId: state.runtimeId,
      identity: fresh.state.pendingRender!.identity,
      atMs: fresh.state.nowMs + 1,
    });
    expect(confirmed.state.phase).toBe("complete");
    expect(confirmed.effects).toHaveLength(1);
    expect(confirmed.effects[0].type).toBe("lesson.completed");
  });
});

let lesson: LessonRuntime | undefined;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  vi.clearAllMocks();
  transport.receive = undefined;
});
afterEach(() => {
  lesson?.stop();
  lesson = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function emit(event: ProviderEvent) {
  transport.receive!(event);
}
function acknowledgeSteering() {
  const command = transport.send.mock.calls.at(-1)![0];
  emit({
    type: "context.appended",
    name: "session.instructions.appended",
    clientEventId: command.event_id,
    startMs: 0,
  });
}

it("reschedules after late filler transcription, preserves the full input, and asks for fresh evidence once on abstention", async () => {
  const finalRequests: ConversationStateClassifierInput[] = [];
  const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
    const input = JSON.parse(init.body as string) as ConversationStateClassifierInput;
    if (input.nodeId === "count-3-butterflies") {
      finalRequests.push(input);
      const decision = mapConversationObservation(input, outputs);
      return Response.json({
        proposal: decision.proposal,
        diagnostic: { ...recordedMapping, transcriptRevision: input.transcriptRevision },
      });
    }
    return Response.json({
      proposal: {
        nodeId: input.nodeId,
        transcriptRevision: input.transcriptRevision,
        childActivity: "unknown",
        answerOutcome: "correct",
        supportState: "none",
        tutorState: "acknowledging",
      },
    });
  });
  vi.stubGlobal("fetch", fetch); // Every request stays in memory; transport is mocked too.
  lesson = new LessonRuntime({} as HTMLAudioElement, () => {}, COUNTING_LESSON);
  lesson.confirmRendered(lesson.snapshot().display);
  acknowledgeSteering();
  // Authored render/steering transitions establish the butterfly visit normally.
  for (const [index, answer] of ["One.", "Two."].entries()) {
    const startMs = 100 + index * 1000;
    emit({ type: "microphone.activity_started" });
    emit({ type: "transcript", speaker: "child", delta: answer, startMs, endMs: startMs + 100 });
    emit({ type: "microphone.speech_stopped", quietMs: 900 });
    emit({
      type: "transcript",
      speaker: "sprout",
      delta: `Yes, ${answer}`,
      startMs: startMs + 200,
      endMs: startMs + 300,
    });
    emit({ type: "output.activity", state: "active" });
    emit({ type: "output.activity", state: "quiet" });
    await vi.advanceTimersByTimeAsync(600);
    expect(lesson.snapshot().runtime?.phase).toBe("rendering");
    lesson.confirmRendered(lesson.snapshot().display);
    acknowledgeSteering();
  }
  expect(lesson.snapshot().runtime?.nodeId).toBe("count-3-butterflies");
  emit({
    type: "transcript",
    speaker: "sprout",
    delta: "How many butterflies do you see?",
    startMs: 26000,
    endMs: 27000,
  });
  emit({ type: "output.activity", state: "quiet" });
  // Use the saved provider ordering and intervals, allowing deterministic timers
  // rather than claiming to reproduce browser/network jitter or actual ASR.
  for (const item of trace.incoming) {
    await vi.advanceTimersByTimeAsync(item.atMs - performance.now());
    emit(item.event as ProviderEvent);
    if (item.event.type === "microphone.speech_stopped" && item.atMs > 35000) {
      expect(finalRequests).toHaveLength(0);
      expect(lesson.snapshot().runtime?.hasChildTranscript).toBe(false);
    }
  }
  await vi.advanceTimersByTimeAsync(8500);
  expect(finalRequests).toHaveLength(1);
  expect(finalRequests[0]).toMatchObject({
    nodeId: "count-3-butterflies",
    transcript: trace.classifierInput.transcript,
  });
  expect(lesson.snapshot()).toMatchObject({
    status: "live",
    runtime: {
      phase: "active",
      answerAccepted: false,
      acknowledgmentObserved: false,
      hasChildTranscript: true,
      tutorOutputObserved: true,
      tutorOutputDrained: true,
      pendingRender: null,
    },
  });
  const events = lesson.report().events;
  expect(events).toContainEqual(expect.objectContaining({ type: "classifier.blocked" }));
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "classifier.scheduled",
      detail: { trigger: "child_transcript_stabilized", delayMs: 300 },
    }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "classifier.mapping",
      detail: expect.objectContaining({ reason: "objectiveState_no_winner" }),
    }),
  );
  expect(events.filter(event => event.type === "render.requested")).toHaveLength(2);
  expect(events.some(event => event.type.startsWith("clarification.") || event.type === "lesson.completed")).toBe(
    false,
  );
  expect(events.filter(event => event.type === "answer_recovery.requested")).toHaveLength(1);
  expect(events).toContainEqual(
    expect.objectContaining({ type: "answer_recovery.requested", detail: { waitMs: 4000, reason: "semantic_hold" } }),
  );
  expect(transport.send).toHaveBeenCalledTimes(4); // Three steering appends and one bounded recovery request.
});
