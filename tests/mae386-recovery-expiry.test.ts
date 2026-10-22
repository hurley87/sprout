import { afterEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import { MAE386_LESSON } from "../lib/lesson-runtime/mae386-lesson";
import { COUNTING_LESSON } from "../lib/lesson-runtime/counting-lesson";
import { CATCHING_UNICORNS_LESSON } from "../lib/lesson-runtime/catching-unicorns-lesson";
import { missingAnswerCheckInstruction, supersedeAnswerCheckInstruction } from "../lib/lesson-runtime/live-context";
import { providerEvents, useRuntimeFakeTimers as installRuntimeFakeTimers } from "./helpers/runtime-harness";

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
const emit = (event: ProviderEvent) => transport.receive!(event);
const commands = () => transport.send.mock.calls.map(([command]) => command);
const checks = () =>
  commands().filter(
    command => command.event_id.includes(":answer-recovery:") && !command.event_id.endsWith(":expired"),
  );
const expiries = () => commands().filter(command => command.event_id.endsWith(":expired"));
function start(lesson = { ...MAE386_LESSON, initialNodeId: "q12" }) {
  installRuntimeFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ proposal: null })),
  );
  runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, lesson);
  runtime.confirmRendered(runtime.snapshot().display);
  const events = providerEvents(emit);
  events.acknowledgeSteering(commands()[0].event_id, 0);
  emit({ type: "output.activity", state: "quiet" });
  return events;
}
function missingTurn() {
  emit({ type: "microphone.activity_started" });
  emit({ type: "microphone.speech_started" });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
}
function text(delta = "Personnel read written orders and calculate supplies.", startMs = 100) {
  emit({ type: "transcript", speaker: "child", delta, startMs, endMs: startMs + 100 });
}
async function sentCheck() {
  missingTurn();
  await vi.advanceTimersByTimeAsync(4000);
  expect(checks()).toHaveLength(1);
  return checks()[0];
}
afterEach(() => {
  runtime?.stop();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("late Q12 answer text supersedes the sent check once without granting evidence or navigation", async () => {
  const events = start();
  const check = await sentCheck();
  if (check.type !== "session.instructions.append") throw new Error("Expected check");
  expect(check.content).toContain(check.event_id);
  expect(check.content).toBe(missingAnswerCheckInstruction(check.event_id));
  expect(check.content).toContain("this request expires");
  const before = runtime.snapshot().runtime!;
  text();
  text(" Specialists develop new ideas.", 200);
  expect(expiries()).toHaveLength(1);
  const expiry = expiries()[0];
  if (expiry.type !== "session.instructions.append") throw new Error("Expected expiry");
  expect(expiry.content).toContain(check.event_id);
  expect(expiry.content).toBe(supersedeAnswerCheckInstruction(check.event_id));
  expect(expiry.content).toContain("requests no spoken reply");
  expect(runtime.snapshot().runtime).toMatchObject({
    nodeId: "q12",
    visitId: before.visitId,
    conceptEvidence: before.conceptEvidence,
  });
  expect(runtime.snapshot().awaitingSteering).toBe(false);
  // Late provider acknowledgments cannot create a new steering/visit floor.
  events.acknowledgeSteering(check.event_id, 5000);
  events.acknowledgeSteering(expiry.event_id, 5100);
  text(" Education passes on knowledge.", 300);
  expect(runtime.snapshot().transcript).toContain("Education passes on knowledge");
  expect(expiries()).toHaveLength(1);
});

it("confirmed resumed speech expires the check before its transcript; discarded energy does not", async () => {
  start();
  await sentCheck();
  emit({ type: "microphone.activity_started" });
  expect(expiries()).toHaveLength(0);
  emit({ type: "microphone.activity_discarded" });
  expect(expiries()).toHaveLength(0);
  emit({ type: "microphone.activity_started" });
  emit({ type: "microphone.speech_started" });
  expect(expiries()).toHaveLength(1);
  text();
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(5000);
  expect(expiries()).toHaveLength(1);
  expect(checks()).toHaveLength(1);
});

it("text confirming a provisional microphone candidate also supersedes the sent check", async () => {
  start();
  await sentCheck();
  emit({ type: "microphone.activity_started" });
  text();
  expect(expiries()).toHaveLength(1);
  expect(runtime.snapshot().runtime?.hasChildTranscript).toBe(true);
});

it("answer arrival before the recovery deadline sends neither check nor expiry", async () => {
  start();
  missingTurn();
  await vi.advanceTimersByTimeAsync(3999);
  text();
  await vi.advanceTimersByTimeAsync(5000);
  expect(checks()).toHaveLength(0);
  expect(expiries()).toHaveLength(0);
});

it("a committed skip expires the old check before new-screen steering, without crossing visit boundaries", async () => {
  const events = start();
  const check = await sentCheck();
  emit({ type: "output.activity", state: "active" });
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(600);
  runtime.skipScene("subpart");
  expect(runtime.snapshot().runtime?.nodeId).toBe("q14");
  expect(expiries()).toHaveLength(1);
  runtime.confirmRendered(runtime.snapshot().display);
  const steer = commands().at(-1)!;
  expect(steer.event_id).not.toBe(expiries()[0].event_id);
  events.acknowledgeSteering(steer.event_id, 1000);
  emit({ type: "output.activity", state: "quiet" });
  // A pre-boundary old-visit transcript cannot expire a later check.
  missingTurn();
  await vi.advanceTimersByTimeAsync(4000);
  expect(checks()).toHaveLength(2);
  text("Old visit answer", 100);
  expect(expiries()).toHaveLength(1);
  text("Current argument", 1100);
  expect(expiries()).toHaveLength(2);
  expect(expiries()[1].event_id).not.toContain(check.event_id);
});

it("Stop closes immediately without an expiry append or work from late callbacks", async () => {
  start();
  await sentCheck();
  runtime.stop();
  expect(transport.close).toHaveBeenCalledOnce();
  const before = commands().length;
  text();
  emit({ type: "microphone.speech_started" });
  await vi.advanceTimersByTimeAsync(5000);
  expect(commands()).toHaveLength(before);
  expect(runtime.snapshot()).toMatchObject({ status: "ended", questionRecap: { label: "Session ended early" } });
});

it("a failed expiry send is logged once and never retried for every transcript delta", async () => {
  start();
  const check = await sentCheck();
  transport.send.mockImplementationOnce(() => {
    throw new Error("closed channel");
  });
  text();
  text(" More answer.", 200);
  expect(expiries()).toHaveLength(1);
  expect(runtime.report().events.filter(event => event.type === "answer_recovery.supersede_failed")).toMatchObject([
    { detail: { supersededEventId: check.event_id } },
  ]);
});

it("authenticated spoken Stop ends without awaiting expiry acknowledgment or classification", async () => {
  const events = start();
  await sentCheck();
  events.childTurn("Stop", 100);
  expect(runtime.snapshot().status).toBe("ended");
  expect(transport.close).toHaveBeenCalledOnce();
  expect(expiries()).toHaveLength(1);
  const count = commands().length;
  events.acknowledgeSteering(expiries()[0].event_id, 300);
  await vi.advanceTimersByTimeAsync(5000);
  expect(commands()).toHaveLength(count);
  expect(runtime.report().events.filter(event => event.type === "lesson.ended")).toMatchObject([
    { detail: { reason: "learner_stop" } },
  ]);
});

it.each(["help", "repeat"] as const)(
  "%s expires an existing check without treating the control as learner evidence",
  async request => {
    start();
    await sentCheck();
    emit({ type: "output.activity", state: "active" });
    emit({ type: "output.activity", state: "quiet" });
    await vi.advanceTimersByTimeAsync(600);
    const before = runtime.snapshot().runtime!;
    runtime.requestSupport(request);
    expect(expiries()).toHaveLength(1);
    expect(runtime.snapshot().awaitingSteering).toBe(true);
    expect(runtime.snapshot().runtime).toMatchObject({
      childTurnId: before.childTurnId,
      transcriptRevision: before.transcriptRevision,
      conceptEvidence: before.conceptEvidence,
    });
  },
);

it("a retired transport's speech cannot expire the active check", async () => {
  start();
  await sentCheck();
  emit({ type: "microphone.speech_started", sourceId: 2 });
  emit({ type: "transcript", sourceId: 2, speaker: "child", delta: "Old source", startMs: 100, endMs: 200 });
  expect(expiries()).toHaveLength(0);
  text();
  expect(expiries()).toHaveLength(1);
});

it("an initial check send failure creates no pending expiry and does not retry the check", async () => {
  start();
  transport.send.mockImplementationOnce(() => {
    throw new Error("closed channel");
  });
  await sentCheck();
  text();
  await vi.advanceTimersByTimeAsync(5000);
  expect(expiries()).toHaveLength(0);
  expect(checks()).toHaveLength(1);
  expect(runtime.report().events.filter(event => event.type === "answer_recovery.send_failed")).toHaveLength(1);
});

it.each([COUNTING_LESSON, CATCHING_UNICORNS_LESSON])(
  "preserves $id recovery without the MAE386 expiry protocol",
  async lesson => {
    start(lesson);
    const check = await sentCheck();
    if (check.type !== "session.instructions.append") throw new Error("Expected check");
    expect(check.content).not.toContain("this request expires");
    text("One");
    expect(expiries()).toHaveLength(0);
  },
);
