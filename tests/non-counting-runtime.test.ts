import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import { TEST_PATTERN_LESSON } from "./fixtures/test-lesson";

const transport = vi.hoisted(() => ({
  receive: undefined as ((event: ProviderEvent) => void) | undefined,
  send: vi.fn<(command: ClientCommand) => void>(),
  close: vi.fn(),
  start: vi.fn<(lessonId: string) => void>(),
}));

vi.mock("../lib/browser-transport", () => ({
  BrowserTransport: class {
    activeSourceId = 1;
    setMicrophoneDiagnosticSink() {}
    async start(receive: (event: ProviderEvent) => void, _failed: () => void, lessonId: string) {
      transport.start(lessonId);
      transport.receive = receive;
      // Model the production transport's session request boundary while keeping
      // the real LessonRuntime responsible for choosing and passing lessonId.
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  vi.clearAllMocks();
  transport.receive = undefined;
  fetchMock = vi.fn(async () => Response.json({ proposal: null }));
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
  lesson = new LessonRuntime({} as HTMLAudioElement, () => {}, TEST_PATTERN_LESSON);
  lesson.confirmRendered(lesson.snapshot().display);
  await vi.advanceTimersByTimeAsync(0);
  const initialSteering = transport.send.mock.calls[0]?.[0];
  if (initialSteering?.type !== "session.instructions.append") throw new Error("Expected initial steering");
  emit({
    type: "context.appended",
    name: "session.instructions.appended",
    clientEventId: initialSteering.event_id,
    startMs: 0,
  });
  emit({ type: "output.activity", state: "quiet" });
  return initialSteering;
}

function childTurn(transcript: string, startMs = 100) {
  emit({ type: "microphone.activity_started" });
  emit({ type: "transcript", speaker: "child", delta: transcript, startMs, endMs: startMs + 100 });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
}

function tutorTranscript(transcript: string, startMs = 300) {
  emit({ type: "transcript", speaker: "sprout", delta: transcript, startMs, endMs: startMs + 100 });
  emit({ type: "output.activity", state: "active" });
  emit({ type: "output.activity", state: "quiet" });
}

function proposalFor(input: { nodeId: string; transcriptRevision: number }, tutorState: string) {
  return {
    nodeId: input.nodeId,
    transcriptRevision: input.transcriptRevision,
    childActivity: "unknown",
    answerOutcome: "correct",
    supportState: "none",
    tutorState,
  };
}

function classifierInputs() {
  return fetchMock.mock.calls
    .filter(([url]) => url === "/api/classify")
    .map(([, init]) => JSON.parse((init as RequestInit).body as string));
}

it("passes the selected lesson through startup and classification, steers authored context, and honors progression gates", async () => {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/live") return Response.json({ ok: true });
    const input = JSON.parse(init?.body as string);
    return Response.json({
      proposal: proposalFor(input, input.transcript.includes("Tutor:") ? "acknowledging" : "unknown"),
    });
  });

  const steering = await start();
  expect(transport.start).toHaveBeenCalledWith(TEST_PATTERN_LESSON.id);
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/live",
    expect.objectContaining({
      body: JSON.stringify({ sdp: "mock-offer", lessonId: TEST_PATTERN_LESSON.id }),
    }),
  );
  expect(steering.content).toContain('"nodeId":"pattern-a"');
  expect(steering.content).toContain('"scene":{"id":"pattern-card","symbol":"circle","sequenceLength":4}');
  expect(steering.content).toContain("Describe the repeated symbol in the displayed pattern.");
  expect(steering.content).toContain("Ask what repeats in the pattern; let the learner explain in their own words.");
  expect(steering.content).not.toContain("pattern-b");

  childTurn("Circle repeats.");
  await vi.advanceTimersByTimeAsync(300);
  expect(classifierInputs()).toEqual([
    {
      lessonId: TEST_PATTERN_LESSON.id,
      nodeId: "pattern-a",
      transcriptRevision: 1,
      transcript: "Child: Circle repeats.",
    },
  ]);
  expect(lesson.snapshot().runtime).toMatchObject({
    phase: "active",
    answerAccepted: true,
    acknowledgmentObserved: false,
  });
  expect(lesson.snapshot().display.nodeId).toBe("pattern-a");

  tutorTranscript("Yes, circle repeats each time.");
  await vi.advanceTimersByTimeAsync(600);
  expect(classifierInputs()).toHaveLength(2);
  expect(classifierInputs()[1]).toMatchObject({
    lessonId: TEST_PATTERN_LESSON.id,
    nodeId: "pattern-a",
    transcript: "Child: Circle repeats.\nTutor: Yes, circle repeats each time.",
  });
  expect(lesson.snapshot().runtime).toMatchObject({ phase: "rendering", nodeId: "pattern-b", visitId: 2 });
  expect(transport.send).toHaveBeenCalledOnce(); // A new node waits for its render confirmation.

  lesson.confirmRendered(lesson.snapshot().display);
  const nextSteering = transport.send.mock.calls.at(-1)?.[0];
  expect(nextSteering?.type).toBe("session.instructions.append");
  if (nextSteering?.type !== "session.instructions.append") throw new Error("Expected next-node steering");
  expect(nextSteering.content).toContain('"nodeId":"pattern-b"');
  expect(nextSteering.content).toContain('"scene":{"id":"pattern-card-next","symbol":"triangle","sequenceLength":5}');
  expect(nextSteering.content).toContain("Explain what changes in the next pattern.");
  expect(nextSteering.content).not.toContain("pattern-a");
});

it("holds unresolved help without scheduling the inactive support clarification path", async () => {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/live") return Response.json({ ok: true });
    const input = JSON.parse(init?.body as string);
    return Response.json({
      proposal: { ...proposalFor(input, "clarifying"), supportState: "needs_help" },
    });
  });
  await start();
  childTurn("I don't know.");
  await vi.advanceTimersByTimeAsync(300);
  tutorTranscript("Could you say what you notice again?");
  await vi.advanceTimersByTimeAsync(600);
  expect(classifierInputs()).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(4_000);

  // Preserve the existing runtime policy: proposals hold the scene, but do not
  // arm SupportClarification.consider or send an additional recovery prompt.
  expect(transport.send).toHaveBeenCalledOnce();
  expect(lesson.snapshot()).toMatchObject({
    status: "live",
    runtime: { phase: "active", nodeId: "pattern-a", answerAccepted: false },
  });
  expect(lesson.report().events).not.toContainEqual(expect.objectContaining({ type: "clarification.scheduled" }));
  expect(lesson.report().events).not.toContainEqual(expect.objectContaining({ type: "clarification.requested" }));
});

it("sends the fixture's answer recovery instruction when a confirmed child turn has no transcript", async () => {
  await start();
  emit({ type: "microphone.activity_started" });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(4_000);

  const recovery = transport.send.mock.calls
    .map(([command]) => command)
    .find(
      command =>
        command.type === "session.instructions.append" &&
        command.content === TEST_PATTERN_LESSON.recovery.answerRecoveryInstruction,
    );
  expect(recovery).toMatchObject({ content: TEST_PATTERN_LESSON.recovery.answerRecoveryInstruction });
  if (recovery?.type !== "session.instructions.append") throw new Error("Expected answer recovery instruction");
  expect(recovery.content).not.toMatch(/count|total|duck|butterfl|number|object/i);
  expect(fetchMock).not.toHaveBeenCalledWith("/api/classify", expect.anything());
  expect(lesson.report().events).toContainEqual(
    expect.objectContaining({
      type: "answer_recovery.requested",
      detail: { waitMs: 4_000, reason: "missing_transcript" },
    }),
  );
});

it("ignores an unrelated steering acknowledgment and keeps queued transcript isolated", async () => {
  const initial = await start();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/live") return Response.json({ ok: true });
    const input = JSON.parse(init?.body as string);
    return Response.json({
      proposal: proposalFor(input, input.transcript.includes("Tutor:") ? "acknowledging" : "unknown"),
    });
  });
  childTurn("Circle repeats.");
  await vi.advanceTimersByTimeAsync(300);
  tutorTranscript("Yes, circle repeats each time.");
  await vi.advanceTimersByTimeAsync(600);
  expect(lesson.snapshot().runtime?.phase).toBe("rendering");
  lesson.confirmRendered(lesson.snapshot().display);
  const next = transport.send.mock.calls.at(-1)?.[0];
  expect(next?.type).toBe("session.instructions.append");
  if (next?.type !== "session.instructions.append") throw new Error("Expected next-node steering");
  expect(initial.event_id).not.toBe(next.event_id);
  const requestsBeforeQueuedChild = classifierInputs().length;

  emit({ type: "microphone.activity_started" });
  emit({ type: "transcript", speaker: "child", delta: "Stale answer.", startMs: 600, endMs: 700 });
  emit({
    type: "context.appended",
    name: "session.instructions.appended",
    clientEventId: initial.event_id,
    startMs: 500,
  });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(lesson.snapshot().awaitingSteering).toBe(true);
  expect(lesson.snapshot().transcript).toBe("");
  expect(classifierInputs()).toHaveLength(requestsBeforeQueuedChild);

  emit({
    type: "context.appended",
    name: "session.instructions.appended",
    clientEventId: next.event_id,
    startMs: 500,
  });
  await vi.advanceTimersByTimeAsync(300);
  expect(lesson.snapshot().awaitingSteering).toBe(false);
  expect(lesson.snapshot().transcript).toBe("Child: Stale answer.");
});

it("does not apply an in-flight classifier response after the runtime is stopped", async () => {
  let resolveClassification!: (response: Response) => void;
  let classificationSignal!: AbortSignal;
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url === "/api/live") return Promise.resolve(Response.json({ ok: true }));
    classificationSignal = init?.signal as AbortSignal;
    return new Promise(resolve => {
      resolveClassification = resolve;
    });
  });
  await start();
  childTurn("Circle repeats.");
  await vi.advanceTimersByTimeAsync(300);
  expect(classificationSignal.aborted).toBe(false);
  lesson.stop();
  expect(classificationSignal.aborted).toBe(true);
  resolveClassification(Response.json({ proposal: proposalFor(classifierInputs()[0], "acknowledging") }));
  await vi.advanceTimersByTimeAsync(0);

  expect(lesson.snapshot()).toMatchObject({ status: "ended", runtime: { phase: "stopped", nodeId: "pattern-a" } });
  expect(lesson.report().events).not.toContainEqual(expect.objectContaining({ type: "render.requested" }));
});
