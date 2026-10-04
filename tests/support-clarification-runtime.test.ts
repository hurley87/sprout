import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import { classificationDiagnostic, mapConversationClassification } from "../lib/lesson-runtime/classification-decision";
import { conversationProbabilities } from "./fixtures/conversation-classification";

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

let lesson: LessonRuntime;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  vi.clearAllMocks();
  transport.receive = undefined;
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
function start(childAnswer = "One.") {
  lesson = new LessonRuntime({} as HTMLAudioElement, () => {});
  lesson.confirmRendered(lesson.snapshot().display);
  const command = transport.send.mock.calls[0][0];
  emit({
    type: "context.appended",
    name: "session.instructions.appended",
    clientEventId: command.event_id,
    startMs: 0,
  });
  emit({ type: "microphone.activity_started" });
  emit({ type: "transcript", speaker: "child", delta: childAnswer, startMs: 100, endMs: 200 });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
}
function tutor(delta: string, startMs = 300) {
  emit({ type: "transcript", speaker: "sprout", delta, startMs, endMs: startMs + 100 });
}

function ambiguousResponse(init?: RequestInit) {
  const input = JSON.parse(init?.body as string);
  const decision = mapConversationClassification(
    input,
    conversationProbabilities({ needsHelp: 0.17, tutorAcknowledging: 0.97 }),
  );
  return Response.json({ proposal: null, diagnostic: classificationDiagnostic(decision) });
}
async function arm(acknowledgment = false) {
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (!acknowledgment) return ambiguousResponse(init);
    const input = JSON.parse(init?.body as string);
    const decision = mapConversationClassification(
      input,
      conversationProbabilities({ tutorAcknowledging: 0.87, needsHelp: 0.09 }),
    );
    return Response.json({ proposal: null, diagnostic: classificationDiagnostic(decision) });
  });
  vi.stubGlobal("fetch", fetch);
  start(acknowledgment ? "Two. Oh, actually one" : "[breath ]I think [sigh");
  emit({ type: "microphone.activity_started" });
  emit({ type: "transcript", speaker: "child", delta: acknowledgment ? "." : "] One", startMs: 210, endMs: 250 });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  tutor(acknowledgment ? "Yes , there is one duck." : "Yes. One duck.");
  emit({ type: "output.activity", state: "active" });
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(600);
  expect(lesson.report().events).toContainEqual(expect.objectContaining({ type: "clarification.scheduled" }));
  return fetch;
}
it.each([false, true])(
  "requests once after four quiet seconds for acknowledgment uncertainty=%s, holds scene, and never retries",
  async acknowledgment => {
    const fetch = await arm(acknowledgment);
    await vi.advanceTimersByTimeAsync(3999);
    expect(transport.send).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.send).toHaveBeenCalledTimes(2);
    const command = transport.send.mock.calls[1][0];
    expect(command).toMatchObject({
      type: "session.instructions.append",
      content: expect.stringContaining("Ask at most once"),
    });
    expect(JSON.stringify(command)).not.toContain("One duck");
    emit({
      type: "context.appended",
      name: "session.instructions.appended",
      clientEventId: command.event_id,
      startMs: 99999,
    });
    expect(lesson.snapshot().runtime).toMatchObject({ nodeId: "count-1-duck", phase: "active", answerAccepted: false });
    expect(lesson.report().events).toContainEqual(expect.objectContaining({ type: "clarification.acknowledged" }));
    await vi.advanceTimersByTimeAsync(20000);
    expect(fetch).toHaveBeenCalledOnce();
    expect(transport.send).toHaveBeenCalledTimes(2);
    tutor("Would you like help?", 450);
    await vi.advanceTimersByTimeAsync(10000);
    expect(transport.send).toHaveBeenCalledTimes(2); // Visit budget, even on a new ambiguous snapshot.
  },
);
it.each(
  [false, true].flatMap(acknowledgment =>
    ["child", "transcript", "tutor", "output", "unavailable", "stop"].map(change => ({ acknowledgment, change })),
  ),
)("cancels on $change for acknowledgment uncertainty=$acknowledgment", async ({ acknowledgment, change }) => {
  await arm(acknowledgment);
  if (change === "child") emit({ type: "microphone.activity_started" });
  if (change === "transcript")
    emit({ type: "transcript", speaker: "child", delta: " I need help", startMs: 260, endMs: 280 });
  if (change === "tutor") tutor(" Take your time.", 450);
  if (change === "output") emit({ type: "output.activity", state: "active" });
  if (change === "unavailable") emit({ type: "output.activity", state: "unavailable" });
  if (change === "stop") lesson.stop();
  await vi.advanceTimersByTimeAsync(4000);
  expect(transport.send.mock.calls.filter(([command]) => command.event_id?.includes(":clarify:"))).toHaveLength(0);
  expect(lesson.report().events).toContainEqual(expect.objectContaining({ type: "clarification.cancelled" }));
});
it.each([false, true])(
  "invalidates a sent request on child activity for acknowledgment uncertainty=%s",
  async acknowledgment => {
    await arm(acknowledgment);
    await vi.advanceTimersByTimeAsync(4000);
    const command = transport.send.mock.calls[1][0];
    emit({ type: "microphone.activity_started" });
    emit({
      type: "context.appended",
      name: "session.instructions.appended",
      clientEventId: command.event_id,
      startMs: 99999,
    });
    expect(lesson.report().events).toContainEqual(expect.objectContaining({ type: "clarification.invalidated" }));
    expect(lesson.report().events).toContainEqual(
      expect.objectContaining({ type: "clarification.acknowledgment_ignored" }),
    );
    expect(lesson.snapshot().runtime).toMatchObject({
      childSpeaking: true,
      answerAccepted: false,
      nodeId: "count-1-duck",
    });
  },
);
it("does not clarify missing diagnostics", async () => {
  const fetch = vi.fn(async () => Response.json({ proposal: null }));
  vi.stubGlobal("fetch", fetch);
  start();
  tutor("How many ducks?");
  emit({ type: "output.activity", state: "active" });
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(20000);
  expect(transport.send).toHaveBeenCalledOnce();
});
it("does not prompt during initial thinking silence before a child attempt", async () => {
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => ambiguousResponse(init));
  vi.stubGlobal("fetch", fetch);
  lesson = new LessonRuntime({} as HTMLAudioElement, () => {});
  lesson.confirmRendered(lesson.snapshot().display);
  emit({
    type: "context.appended",
    name: "session.instructions.appended",
    clientEventId: transport.send.mock.calls[0][0].event_id,
    startMs: 0,
  });
  tutor("How many ducks do you see?");
  emit({ type: "output.activity", state: "active" });
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(20000);
  expect(fetch).not.toHaveBeenCalled();
  expect(transport.send).toHaveBeenCalledOnce();
});
it("does not turn a classifier failure into a clarification request", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("unavailable", { status: 500 })),
  );
  start();
  tutor("Yes. One duck.");
  emit({ type: "output.activity", state: "active" });
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(20000);
  expect(transport.send).toHaveBeenCalledOnce();
  expect(lesson.report().events).toContainEqual(expect.objectContaining({ type: "classifier.error" }));
});
it("spends the visit budget on send failure and does not retry", async () => {
  await arm();
  transport.send.mockImplementationOnce(() => {
    throw new Error("offline");
  });
  await vi.advanceTimersByTimeAsync(4000);
  expect(lesson.report().events).toContainEqual(expect.objectContaining({ type: "clarification.send_failed" }));
  tutor("Would you like help?", 450);
  await vi.advanceTimersByTimeAsync(10000);
  expect(transport.send).toHaveBeenCalledTimes(2);
});
it.each([
  { reply: "One... can you help?", values: { needsHelp: 0.97 } },
  { reply: "One or two?", values: { answerCorrect: 0.01, answerUnclear: 0.97, needsHelp: 0.97 } },
  { reply: "Maybe one... I am not finished", values: { answerCorrect: 0.01, answerUnclear: 0.97 } },
])("never appends a forced success acknowledgment after $reply (mock observations)", async ({ reply, values }) => {
  const fetch = await arm();
  await vi.advanceTimersByTimeAsync(4000);
  const clarification = transport.send.mock.calls[1][0];
  tutor(" Are you finished, or would you like help?", 450);
  fetch.mockImplementation(async (_url: unknown, init?: RequestInit) => {
    const input = JSON.parse(init?.body as string);
    const decision = mapConversationClassification(input, conversationProbabilities(values));
    return Response.json({
      proposal: decision.status === "accepted" ? decision.proposal : null,
      diagnostic: classificationDiagnostic(decision),
    });
  });
  emit({ type: "microphone.activity_started" });
  emit({ type: "transcript", speaker: "child", delta: reply, startMs: 700, endMs: 800 });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  emit({
    type: "context.appended",
    name: "session.instructions.appended",
    clientEventId: clarification.event_id,
    startMs: 99999,
  });
  await vi.advanceTimersByTimeAsync(10000);
  expect(lesson.snapshot().runtime).toMatchObject({
    nodeId: "count-1-duck",
    phase: "active",
    answerAccepted: false,
    acknowledgmentObserved: false,
  });
  expect(transport.send).toHaveBeenCalledTimes(2); // No diagnostics-driven success instruction or second clarification.
  expect(lesson.report().events).toContainEqual(
    expect.objectContaining({ type: "clarification.acknowledgment_ignored" }),
  );
});
it.each([3999, 4000])("protects an interruption at %i ms near clarification send", async elapsed => {
  await arm();
  await vi.advanceTimersByTimeAsync(elapsed);
  emit({ type: "microphone.activity_started" });
  await vi.advanceTimersByTimeAsync(10000);
  expect(transport.send.mock.calls.filter(([command]) => command.event_id?.includes(":clarify:"))).toHaveLength(
    elapsed === 3999 ? 0 : 1,
  );
  expect(lesson.snapshot().runtime).toMatchObject({
    childSpeaking: true,
    answerAccepted: false,
    acknowledgmentObserved: false,
    nodeId: "count-1-duck",
  });
});

it("requires a fresh acknowledged response, relevant audio drain, and render after acknowledgment recovery (mock scores)", async () => {
  const fetch = await arm(true);
  await vi.advanceTimersByTimeAsync(4000);
  expect(lesson.snapshot().runtime).toMatchObject({ answerAccepted: false, acknowledgmentObserved: false });
  tutor(" Are you finished, or would you like help?", 450);
  fetch.mockImplementation(async (_url: unknown, init?: RequestInit) => {
    const input = JSON.parse(init?.body as string);
    const decision = mapConversationClassification(
      input,
      conversationProbabilities({
        tutorAcknowledging: input.transcript.endsWith("Yes, one duck.") ? 0.97 : 0.01,
      }),
    );
    return Response.json({
      proposal: decision.status === "accepted" ? decision.proposal : null,
      diagnostic: classificationDiagnostic(decision),
    });
  });
  emit({ type: "microphone.activity_started" });
  emit({ type: "transcript", speaker: "child", delta: "I answered one", startMs: 700, endMs: 800 });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(300);
  expect(lesson.snapshot().runtime).toMatchObject({
    answerAccepted: true,
    acknowledgmentObserved: false,
    nodeId: "count-1-duck",
  });
  tutor("Yes, one duck.", 900);
  emit({ type: "output.activity", state: "active" });
  await vi.advanceTimersByTimeAsync(2000);
  expect(lesson.snapshot().runtime?.nodeId).toBe("count-1-duck");
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(600);
  expect(lesson.snapshot().runtime).toMatchObject({ nodeId: "count-2-ducks", phase: "rendering" });
  expect(transport.send).toHaveBeenCalledTimes(2); // Initial context + clarification; no steering before render.
  lesson.confirmRendered(lesson.snapshot().display);
  expect(transport.send).toHaveBeenCalledTimes(3);
  expect(transport.send.mock.calls[2][0]).toMatchObject({ content: expect.stringContaining("count-2-ducks") });
});
