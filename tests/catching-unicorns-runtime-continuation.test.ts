import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { CATCHING_UNICORNS_LESSON } from "../lib/lesson-runtime/catching-unicorns-lesson";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";

const transport = vi.hoisted(() => ({
  receive: undefined as ((event: ProviderEvent) => void) | undefined,
  send: vi.fn<(command: ClientCommand) => void>(),
  close: vi.fn(),
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
    close = transport.close;
  },
}));

let runtime: LessonRuntime;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  vi.clearAllMocks();
  transport.receive = undefined;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/live") return Response.json({ ok: true });
    if (url !== "/api/classify") throw new Error(`Unexpected fetch: ${url}`);
    const input = JSON.parse(init?.body as string);
    const node = CATCHING_UNICORNS_LESSON.nodes[input.nodeId];
    return Response.json({
      proposal: {
        nodeId: input.nodeId,
        transcriptRevision: input.transcriptRevision,
        childActivity: "unknown",
        answerOutcome: "correct",
        supportState: "none",
        tutorState: input.transcript.includes("Tutor:") ? "acknowledging" : "unknown",
        conceptObservations: (node.concepts ?? []).map(concept => ({
          criterionId: concept.id,
          observation: "demonstrated_independent",
        })),
      },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  runtime?.stop();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function emit(event: ProviderEvent) {
  transport.receive?.(event);
}

async function start() {
  runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, CATCHING_UNICORNS_LESSON);
  runtime.confirmRendered(runtime.snapshot().display);
  await vi.advanceTimersByTimeAsync(0);
  const steering = transport.send.mock.calls[0]?.[0];
  if (steering?.type !== "session.instructions.append") throw new Error("Expected initial steering");
  emit({
    type: "context.appended",
    name: "session.instructions.appended",
    clientEventId: steering.event_id,
    startMs: 0,
  });
  emit({ type: "output.activity", state: "quiet" });
}

function childTurn() {
  emit({ type: "microphone.activity_started" });
  emit({
    type: "transcript",
    speaker: "child",
    delta: "It is memory carried inside a person.",
    startMs: 100,
    endMs: 200,
  });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
}

function tutorTranscript(delta: string, startMs: number) {
  emit({ type: "transcript", speaker: "sprout", delta, startMs, endMs: startMs + 100 });
  emit({ type: "output.activity", state: "active" });
  emit({ type: "output.activity", state: "quiet" });
}

it("rejects continuation after a new tutor revision until the real runtime reclassifies it", async () => {
  await start();
  childTurn();
  await vi.advanceTimersByTimeAsync(300);
  tutorTranscript("Yes, that is internal biological memory.", 300);
  await vi.advanceTimersByTimeAsync(600);

  expect(runtime.snapshot().runtime).toMatchObject({
    phase: "active",
    nodeId: "engram",
    transitionReady: true,
    answerAccepted: true,
    acknowledgmentObserved: true,
  });

  tutorTranscript("One more detail about the idea.", 500);
  expect(runtime.snapshot().runtime).toMatchObject({
    phase: "active",
    nodeId: "engram",
    transitionReady: false,
    answerAccepted: false,
    acknowledgmentObserved: false,
  });
  runtime.continueAfterPresentation();
  expect(runtime.snapshot().runtime?.nodeId).toBe("engram");
  expect(runtime.snapshot().runtime?.phase).toBe("active");

  await vi.advanceTimersByTimeAsync(600);
  expect(runtime.snapshot().runtime?.transitionReady).toBe(true);
  runtime.continueAfterPresentation();
  expect(runtime.snapshot().runtime).toMatchObject({ phase: "rendering", nodeId: "exogram" });
});
