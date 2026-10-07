import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import { TEST_CONCEPT_LESSON } from "./fixtures/concept-lesson";
import {
  CLASSIFIER_VERSION,
  CONVERSATION_CLASSIFICATION_THRESHOLDS,
  mapConversationObservation,
} from "../lib/lesson-runtime/conversation-observer-contract";

const transport = vi.hoisted(() => ({
  receive: undefined as ((event: ProviderEvent) => void) | undefined,
  send: vi.fn<(command: ClientCommand) => void>(),
  close: vi.fn(),
}));

vi.mock("../lib/browser-transport", () => ({
  BrowserTransport: class {
    activeSourceId = 1;
    setMicrophoneDiagnosticSink() {}
    async start(receive: (event: ProviderEvent) => void, _failed: () => void, lessonId: string) {
      transport.receive = receive;
      await fetch("/api/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sdp: "mock-offer", lessonId }),
      });
      receive({ type: "session.started", sourceId: 1 });
    }
    openInput() {
      return true;
    }
    send = transport.send;
    close = transport.close;
  },
}));

let lesson: LessonRuntime;
let fetchMock: ReturnType<typeof vi.fn>;
let proposals: Array<{
  answerOutcome: "correct" | "unclear";
  tutorState: "acknowledging" | "unknown";
  conceptObservations: Array<{ criterionId: string; observation: "partial" | "demonstrated_independent" }>;
}>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  vi.clearAllMocks();
  transport.receive = undefined;
  proposals = [];
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/live") return Response.json({ ok: true });
    if (url !== "/api/classify") throw new Error(`Unexpected fetch: ${url}`);
    const input = JSON.parse(init?.body as string);
    const next = proposals.shift();
    if (!next) throw new Error("No classifier proposal queued");
    return Response.json({
      proposal: {
        nodeId: input.nodeId,
        transcriptRevision: input.transcriptRevision,
        childActivity: "unknown",
        answerOutcome: next.answerOutcome,
        supportState: "none",
        tutorState: next.tutorState,
        conceptObservations: next.conceptObservations,
      },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  lesson?.stop();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function emit(event: ProviderEvent) {
  transport.receive?.(event);
}

async function start() {
  lesson = new LessonRuntime({} as HTMLAudioElement, () => {}, TEST_CONCEPT_LESSON);
  lesson.confirmRendered(lesson.snapshot().display);
  await vi.advanceTimersByTimeAsync(0);
  const steering = transport.send.mock.calls[0]?.[0];
  if (steering?.type !== "session.instructions.append") throw new Error("Expected initial steering");
  acknowledgeSteering(steering.event_id, 0);
}

function acknowledgeSteering(eventId: string, startMs: number) {
  emit({
    type: "context.appended",
    name: "session.instructions.appended",
    clientEventId: eventId,
    startMs,
  });
}

function childTurn(transcript: string, startMs: number) {
  emit({ type: "microphone.activity_started" });
  emit({ type: "transcript", speaker: "child", delta: transcript, startMs, endMs: startMs + 100 });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
}

function tutorTurn(transcript: string, startMs: number) {
  emit({ type: "transcript", speaker: "sprout", delta: transcript, startMs, endMs: startMs + 100 });
  emit({ type: "output.activity", state: "active" });
  emit({ type: "output.activity", state: "quiet" });
}

const observation = (criterionId: string, value: "partial" | "demonstrated_independent") => ({
  criterionId,
  observation: value,
});

it("retains tentative partial diagnostics and requests bounded answer recovery without revealing", async () => {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/live") return Response.json({ ok: true });
    const input = JSON.parse(init?.body as string);
    const decision = mapConversationObservation(
      { ...input, lesson: TEST_CONCEPT_LESSON },
      {
        objectiveState: {
          choice: "unclear_or_incomplete",
          confidence: 0.5,
          probabilities: {
            completed: 0.2,
            incorrect: 0.1,
            unclear_or_incomplete: 0.5,
            unresolved_help: 0.1,
            no_attempt: 0.1,
          },
        },
        tutorState: {
          choice: "other",
          confidence: 0.5,
          probabilities: { confirmed_completion: 0.1, clarifying: 0.1, helping: 0.1, asking: 0.2, other: 0.5 },
        },
        concepts: {
          concept_repetition: {
            choice: "partial",
            confidence: 0.5,
            probabilities: { not_yet: 0.2, partial: 0.5, demonstrated_independent: 0.2, demonstrated_prompted: 0.1 },
          },
        },
      },
    );
    expect(decision.outcome).toBe("hold_scene");
    return Response.json({
      proposal: decision.proposal,
      diagnostic: {
        classifierVersion: CLASSIFIER_VERSION,
        decision: decision.status,
        outcome: decision.outcome,
        reason: decision.reason,
        outputs: decision.outputs,
        labelCompletionEligible: decision.labelCompletionEligible,
        thresholds: CONVERSATION_CLASSIFICATION_THRESHOLDS,
        nodeId: input.nodeId,
        transcriptRevision: input.transcriptRevision,
        elapsedMs: 1,
      },
    });
  });
  await start();
  emit({ type: "output.activity", state: "quiet" });
  childTurn("I see some shapes...", 1_000);
  await vi.advanceTimersByTimeAsync(300);
  expect(lesson.report().events).toContainEqual(
    expect.objectContaining({
      type: "classifier.mapping",
      detail: expect.objectContaining({ outcome: "hold_scene" }),
    }),
  );
  await vi.advanceTimersByTimeAsync(4_000);
  expect(transport.send.mock.calls.map(([command]) => command)).toContainEqual(
    expect.objectContaining({
      type: "session.instructions.append",
      content: expect.stringContaining("Ask one non-leading question"),
    }),
  );
  expect(lesson.snapshot()).toMatchObject({
    status: "live",
    runtime: { phase: "active", nodeId: "concept-a", conceptEvidence: { "concept-a:repetition": { status: "partial", tentative: true } } },
  });
  expect(lesson.report().events).not.toContainEqual(expect.objectContaining({ type: "concept.revealed" }));
  await vi.advanceTimersByTimeAsync(4_000);
  expect(transport.send).toHaveBeenCalledTimes(2); // Initial steering plus one recovery request.
});

it("publishes concept reveals in the live visit, waits for completion gates and render confirmation, then stops on completion", async () => {
  proposals = [
    {
      answerOutcome: "correct",
      tutorState: "unknown",
      conceptObservations: [observation("repetition", "demonstrated_independent")],
    },
    {
      answerOutcome: "correct",
      tutorState: "acknowledging",
      conceptObservations: [observation("repetition", "demonstrated_independent")],
    },
    {
      answerOutcome: "unclear",
      tutorState: "unknown",
      conceptObservations: [observation("repetition", "demonstrated_independent"), observation("change", "partial")],
    },
    {
      answerOutcome: "correct",
      tutorState: "unknown",
      conceptObservations: [observation("change", "demonstrated_independent")],
    },
    {
      answerOutcome: "correct",
      tutorState: "acknowledging",
      conceptObservations: [observation("change", "demonstrated_independent")],
    },
  ];
  await start();

  childTurn("The same shape comes back again and again.", 1_000);
  await vi.advanceTimersByTimeAsync(300);
  expect(lesson.snapshot()).toMatchObject({
    status: "live",
    runtime: {
      phase: "active",
      nodeId: "concept-a",
      visitId: 1,
      conceptEvidence: {
        "concept-a:repetition": { status: "demonstrated", understanding: "independent" },
      },
    },
  });
  expect(lesson.report().events).toContainEqual(
    expect.objectContaining({
      type: "concept.revealed",
      detail: { type: "concept.revealed", nodeId: "concept-a", criterionId: "repetition" },
    }),
  );
  expect(lesson.report().events).not.toContainEqual(expect.objectContaining({ type: "render.requested" }));
  expect(transport.close).not.toHaveBeenCalled();

  tutorTurn("That is right; the same shape comes back.", 2_000);
  await vi.advanceTimersByTimeAsync(650);
  expect(lesson.snapshot()).toMatchObject({
    status: "live",
    runtime: { phase: "rendering", nodeId: "concept-b", visitId: 2 },
  });
  expect(lesson.snapshot().display).toMatchObject({ nodeId: "concept-b", sceneId: "concept-card-next" });
  expect(transport.close).not.toHaveBeenCalled();

  const nextSteering = transport.send.mock.calls.at(-1)?.[0];
  // A render request does not steer until React confirms that exact scene.
  expect(nextSteering?.type).toBe("session.instructions.append");
  if (nextSteering?.type !== "session.instructions.append") throw new Error("Expected initial steering command");
  const steeringCount = transport.send.mock.calls.length;
  lesson.confirmRendered(lesson.snapshot().display);
  expect(transport.send).toHaveBeenCalledTimes(steeringCount + 1);
  const conceptBSteering = transport.send.mock.calls.at(-1)?.[0];
  if (conceptBSteering?.type !== "session.instructions.append") throw new Error("Expected concept-b steering");
  acknowledgeSteering(conceptBSteering.event_id, 2_500);

  const renderRequestsBeforeAdditionalCriteria = lesson
    .report()
    .events.filter(event => event.type === "render.requested").length;
  childTurn("The circle appears in both, and the second sequence adds a triangle.", 3_000);
  await vi.advanceTimersByTimeAsync(300);
  expect(lesson.snapshot()).toMatchObject({
    status: "live",
    runtime: {
      phase: "active",
      nodeId: "concept-b",
      visitId: 2,
      conceptEvidence: {
        "concept-b:repetition": { status: "demonstrated", understanding: "independent" },
        "concept-b:change": { status: "partial", understanding: null },
      },
    },
  });
  expect(lesson.report().events.filter(event => event.type === "render.requested")).toHaveLength(
    renderRequestsBeforeAdditionalCriteria,
  );

  childTurn("The circle repeats, and the next sequence adds a triangle.", 4_000);
  await vi.advanceTimersByTimeAsync(300);
  expect(lesson.snapshot()).toMatchObject({
    status: "live",
    runtime: {
      phase: "active",
      nodeId: "concept-b",
      visitId: 2,
      conceptEvidence: {
        "concept-b:repetition": { status: "demonstrated", understanding: "independent" },
        "concept-b:change": { status: "demonstrated", understanding: "independent" },
      },
    },
  });

  tutorTurn("Yes, you noticed what repeats and what was added.", 5_000);
  await vi.advanceTimersByTimeAsync(650);
  expect(lesson.snapshot()).toMatchObject({ status: "live", runtime: { phase: "rendering", lessonComplete: true } });
  expect(lesson.snapshot().display).toMatchObject({ nodeId: null, sceneId: null });
  expect(transport.close).not.toHaveBeenCalled();

  lesson.confirmRendered(lesson.snapshot().display);
  expect(lesson.snapshot()).toMatchObject({ status: "ended", runtime: { phase: "complete", lessonComplete: true } });
  expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ type: "session.close" }));
  expect(transport.close).toHaveBeenCalledOnce();
  expect(proposals).toEqual([]);
});
