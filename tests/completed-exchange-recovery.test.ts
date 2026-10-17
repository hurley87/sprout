import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import { CATCHING_UNICORNS_LESSON } from "../lib/lesson-runtime/catching-unicorns-lesson";
import { providerEvents, useRuntimeFakeTimers } from "./helpers/runtime-harness";
import { classifierProposal } from "./helpers/runtime-classifier";
import trace from "./fixtures/catching-unicorns-recovery-oct17.json";

const transport = vi.hoisted(() => ({
  receive: undefined as ((event: ProviderEvent) => void) | undefined,
  send: vi.fn<(command: ClientCommand) => void>(),
  close: vi.fn(),
}));
vi.mock("../lib/browser-transport", async () => {
  const { mockBrowserTransport } = await import("./helpers/runtime-harness");
  return { BrowserTransport: mockBrowserTransport(transport) };
});
let runtime: LessonRuntime;
let fetchMock: ReturnType<typeof vi.fn>;
const emit = (event: ProviderEvent) => transport.receive!(event);
const events = providerEvents(emit);
const recoveries = () =>
  transport.send.mock.calls.filter(([command]) => command.event_id.includes(":answer-recovery:"));
const renders = () => runtime.report().events.filter(event => event.type === "render.requested");
const response = (init: RequestInit, closed = true) =>
  Response.json({
    proposal: classifierProposal(JSON.parse(init.body as string), {
      answerOutcome: "unclear",
      tutorState: closed ? "acknowledging" : "asking",
      conceptObservations: [],
    }),
  });
beforeEach(async () => {
  useRuntimeFakeTimers();
  vi.clearAllMocks();
  fetchMock = vi.fn(async (_url: string, init: RequestInit) => response(init));
  vi.stubGlobal("fetch", fetchMock);
  runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, {
    ...CATCHING_UNICORNS_LESSON,
    initialNodeId: "exographics",
  });
  runtime.confirmRendered(runtime.snapshot().display);
  await vi.advanceTimersByTimeAsync(0);
  events.acknowledgeSteering(transport.send.mock.calls[0][0].event_id, 0);
  emit({ type: "output.activity", state: "quiet" });
});
afterEach(() => {
  runtime.stop();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function exchange(ack = true) {
  events.childTurn(trace.answer, 100);
  events.tutorTurn(trace.close, 300);
  if (ack) events.childTurn(trace.acknowledgment, 500);
}
function missingTurn() {
  emit({ type: "microphone.activity_started" });
  emit({ type: "microphone.speech_started" });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
}

it("Commit 1 resolves the reported close → Great sequence without recovery", async () => {
  exchange();
  await vi.advanceTimersByTimeAsync(6000);
  expect(runtime.snapshot().runtime).toMatchObject({ nodeId: "recap", phase: "rendering" });
  expect(recoveries()).toHaveLength(0);
  expect(renders()).toHaveLength(1);
});

it("cancels pending recovery when closure classification completes", async () => {
  exchange(false);
  missingTurn();
  fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
    await new Promise(resolve => setTimeout(resolve, 1500));
    return response(init);
  });
  await vi.advanceTimersByTimeAsync(7000);
  expect(runtime.report().events.some(event => event.type === "answer_recovery.scheduled")).toBe(true);
  expect(runtime.snapshot().runtime?.nodeId).toBe("recap");
  expect(recoveries()).toHaveLength(0);
  expect(renders()).toHaveLength(1);
});

it("keeps an accepted close through a discarded candidate and waits for speech to end", async () => {
  exchange();
  await vi.advanceTimersByTimeAsync(300);
  emit({ type: "microphone.activity_started" });
  await vi.advanceTimersByTimeAsync(6000);
  expect(runtime.snapshot().runtime).toMatchObject({
    phase: "active",
    childSpeaking: true,
    conversationAdvanceRequested: "tutor",
  });
  expect(recoveries()).toHaveLength(0);
  emit({ type: "microphone.activity_discarded" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(runtime.snapshot().runtime?.nodeId).toBe("recap");
  expect(recoveries()).toHaveLength(0);
});

it.each([false, true])(
  "does not reopen an accepted close after microphone-only speech (acknowledgment: %s)",
  async ack => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      await new Promise(resolve => setTimeout(resolve, 100));
      return response(init);
    });
    exchange(ack);
    await vi.advanceTimersByTimeAsync(ack ? 300 : 600);
    emit({ type: "microphone.activity_started" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(runtime.snapshot().runtime?.tutorClosure).toBeTruthy();
    emit({ type: "microphone.speech_started" });
    emit({ type: "microphone.speech_stopped", quietMs: 900 });
    // A cached accepted close must not depend on a second successful classifier call.
    fetchMock.mockImplementation(async () => {
      throw Error("offline");
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(recoveries()).toHaveLength(0);
    expect(runtime.snapshot().runtime?.nodeId).toBe("recap");
    expect(renders()).toHaveLength(1);
  },
);

it("rechecks a close followed by Great when confirmed speech superseded classification", async () => {
  exchange();
  missingTurn();
  await vi.advanceTimersByTimeAsync(6000);
  expect(recoveries()).toHaveLength(0);
  expect(runtime.snapshot().runtime?.nodeId).toBe("recap");
});

it("Commit 2 preserves explicit navigation through a later microphone-only turn", async () => {
  events.childTurn("Let's move on. I've answered the question.", 100);
  missingTurn();
  await vi.advanceTimersByTimeAsync(6000);
  expect(runtime.snapshot().runtime?.nodeId).toBe("recap");
  expect(recoveries()).toHaveLength(0);
});

it.each([false, true])("recovers genuine missing answers, including a follow-up: %s", async followup => {
  fetchMock.mockImplementation(async (_url: string, init: RequestInit) => response(init, false));
  if (followup) {
    events.childTurn(trace.answer, 100);
    events.tutorTurn("Can you give another example?", 300);
  }
  missingTurn();
  await vi.advanceTimersByTimeAsync(10000);
  expect(recoveries()).toHaveLength(1);
  expect(runtime.snapshot().runtime).toMatchObject({ nodeId: "exographics", phase: "active", answerAccepted: false });
});

it.each(["Why do we agree on symbols?", "Actually, I want to revise my answer."])(
  "invalidates a cached close for new substantive words: %s",
  async words => {
    exchange();
    await vi.advanceTimersByTimeAsync(300);
    emit({ type: "microphone.activity_started" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(runtime.snapshot().runtime?.tutorClosure).toBeTruthy();
    events.childTurn(words, 700);
    expect(runtime.snapshot().runtime?.tutorClosure).toBeNull();
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => response(init, false));
    events.tutorTurn("Could you explain that further?", 900);
    missingTurn();
    await vi.advanceTimersByTimeAsync(10000);
    expect(recoveries()).toHaveLength(1);
    expect(renders()).toHaveLength(0);
  },
);

it.each(["failure", "timeout"])("allows bounded recovery after closure classification %s", async kind => {
  // Model the existing 10s AbortSignal timeout using the request's actual signal.
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
    const abort = new AbortController();
    setTimeout(() => abort.abort(new DOMException("Timed out", "TimeoutError")), ms);
    return abort.signal;
  });
  fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
    if (kind === "failure") throw Error("offline");
    return new Promise<Response>((_resolve, reject) =>
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason)),
    );
  });
  exchange();
  missingTurn();
  await vi.advanceTimersByTimeAsync(20000);
  expect(recoveries()).toHaveLength(1);
  expect(renders()).toHaveLength(0);
  timeout.mockRestore();
});

it("rejects a stale closure response instead of suppressing legitimate recovery", async () => {
  let resolve!: (value: Response) => void;
  let captured!: RequestInit;
  fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
    captured = init;
    return new Promise<Response>(done => {
      resolve = done;
    });
  });
  exchange();
  await vi.advanceTimersByTimeAsync(300);
  events.childTurn("Wait, I have a different answer.", 700);
  events.tutorTurn("What is your answer?", 900);
  missingTurn();
  fetchMock.mockImplementation(async (_url: string, init: RequestInit) => response(init, false));
  resolve(response(captured));
  await vi.advanceTimersByTimeAsync(10000);
  expect(recoveries()).toHaveLength(1);
  expect(renders()).toHaveLength(0);
});

it("waits for tutor audio drain even after accepting closure", async () => {
  exchange();
  emit({ type: "output.activity", state: "active" });
  await vi.advanceTimersByTimeAsync(6000);
  expect(runtime.snapshot().runtime?.phase).toBe("active");
  expect(recoveries()).toHaveLength(0);
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(499);
  expect(renders()).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(501);
  expect(renders()).toHaveLength(1);
  expect(recoveries()).toHaveLength(0);
});

it("revokes a cached close when the tutor asks a new follow-up", async () => {
  exchange();
  await vi.advanceTimersByTimeAsync(300);
  emit({ type: "microphone.activity_started" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(runtime.snapshot().runtime?.tutorClosure).toBeTruthy();
  events.tutorTurn("Can you give another example?", 700);
  expect(runtime.snapshot().runtime?.tutorClosure).toBeNull();
  fetchMock.mockImplementation(async (_url: string, init: RequestInit) => response(init, false));
  emit({ type: "microphone.speech_started" });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(10000);
  expect(recoveries()).toHaveLength(1);
  expect(renders()).toHaveLength(0);
});
