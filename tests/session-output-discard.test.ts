import { immediateAcknowledgment } from "./helpers/immediate-acknowledgment";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LessonSession, RESPONSE_GATE_RECOVERY_MS, type Transport } from "../lib/session";
import { EVALUATION_TIMEOUT_MS, TRANSCRIPT_TAIL_MS, type AnswerResult, type EvaluateAnswer } from "../lib/answer";
import type { ClientCommand } from "../lib/events";
import { UTTERANCE_GAP_MS } from "../lib/transcript";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
const advance: AnswerResult = { status: "evaluated", probability: 1, model: "test", latencyMs: 1 };

function setup(result: AnswerResult = advance) {
  let resolveEvaluation!: (result: AnswerResult) => void;
  let resolveReplacement!: (id: number) => void;
  const evaluate = vi.fn<EvaluateAnswer>(
    () =>
      new Promise(resolve => {
        resolveEvaluation = resolve;
      }),
  );
  const order: string[] = [];
  const sent: { source: number | undefined; command: ClientCommand }[] = [];
  const transport: Transport = {
    activeSourceId: 1,
    start: vi.fn(async () => {}),
    send: vi.fn(command => {
      order.push("instruction");
      sent.push({ source: transport.activeSourceId, command });
    }),
    setOutputBlocked: vi.fn(blocked => order.push(blocked ? "blocked" : "permitted")),
    discardOutput: vi.fn(() => {
      order.push("discarded");
      return true;
    }),
    prepareReplacement: vi.fn(
      () =>
        new Promise<number>(resolve => {
          resolveReplacement = resolve;
        }),
    ),
    activateSource: vi.fn(id => {
      order.push("promoted");
      Object.assign(transport, { activeSourceId: id });
      return true;
    }),
    retireSource: vi.fn(),
    stopMedia: vi.fn(),
    close: vi.fn(),
  };
  immediateAcknowledgment(transport, () => session.snapshot.choreographyPhase);
  const session = new LessonSession(transport, evaluate, vi.fn());
  void session.start();
  session.receive({ type: "session.started" });
  session.displayed(0, session.snapshot.displayToken);
  sent.length = 0;
  order.length = 0;
  vi.mocked(transport.setOutputBlocked).mockClear();
  const transcript = (speaker: "child" | "sprout", delta: string, startMs = 1000) =>
    session.receive({ type: "transcript", speaker, delta, startMs, endMs: startMs + 100, sourceId: 1 });
  const child = () => {
    session.receive({ type: "microphone.speech_started" });
    transcript("child", "One");
    session.receive({ type: "microphone.speech_stopped", quietMs: 900 });
  };
  const decide = async () => {
    await vi.advanceTimersByTimeAsync(251);
    expect(evaluate).toHaveBeenCalledWith({ sceneIndex: 0, utterance: "One" }, expect.any(AbortSignal));
    resolveEvaluation(result);
    await vi.advanceTimersByTimeAsync(0);
  };
  return {
    session,
    transport,
    order,
    sent,
    transcript,
    child,
    decide,
    evaluate,
    finishEvaluation: () => resolveEvaluation(result),
    ready: () => resolveReplacement(2),
  };
}
const events = (session: LessonSession, type: string) => session.events.filter(event => event.type === type);

it("discards in-flight output at answer gating and releases ADVANCE without the old quiet timeout", async () => {
  const f = setup();
  f.session.receive({ type: "output.activity", state: "active", sourceId: 1 });
  f.transcript("sprout", "Okay, let's see");
  f.child();
  expect(f.order).toEqual(["blocked", "discarded"]);
  expect(f.transport.discardOutput).toHaveBeenCalledOnce();
  expect(f.transport.prepareReplacement).not.toHaveBeenCalled();
  expect(f.sent).toEqual([]);
  f.transcript("sprout", " old response", 1200);
  await f.decide();
  expect(f.session.snapshot.sceneIndex).toBe(1);
  expect(f.transport.prepareReplacement).not.toHaveBeenCalled();
  f.session.displayed(1, f.session.snapshot.displayToken);
  expect(f.transport.prepareReplacement).toHaveBeenCalledOnce();
  f.ready();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.order).toEqual(["blocked", "discarded", "blocked", "promoted", "instruction", "permitted"]);
  expect(f.sent).toEqual([
    expect.objectContaining({
      source: 2,
      command: expect.objectContaining({ content: expect.stringContaining("currently displayed: 2 ducks") }),
    }),
  ]);
  expect(events(f.session, "answer.response_gate_released")[0].detail).toMatchObject({
    decision: "ADVANCE",
    reason: "replacement_source",
    wait_ms: 251,
    output_transcript_quiet_blocked_release: false,
  });
  expect(events(f.session, "answer.output_cancellation_requested")).toHaveLength(1);
  expect(events(f.session, "answer.output_cancellation_completed")[0].detail).toMatchObject({
    completion_basis: "local_output_isolated",
    provider_acknowledged: false,
  });
  expect(events(f.session, "answer.stale_output_discarded")[0].detail).toMatchObject({
    received_after_cancellation: true,
  });
  expect(events(f.session, "answer.response_gate_deadline_updated")).toHaveLength(0);
});

it("discards output that first races in during evaluation and never releases it on A", async () => {
  const f = setup();
  f.child();
  expect(f.transport.discardOutput).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(100);
  f.transcript("sprout", "Okay, let's see");
  expect(f.transport.discardOutput).toHaveBeenCalledOnce();
  await f.decide();
  f.session.displayed(1, f.session.snapshot.displayToken);
  for (let index = 0; index < 5; index++) {
    f.transcript("sprout", "old filler", 2000 + index * 100);
    await vi.advanceTimersByTimeAsync(100);
  }
  expect(f.sent).toEqual([]);
  expect(f.transport.setOutputBlocked).not.toHaveBeenCalledWith(false);
  f.ready();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.sent.map(item => item.source)).toEqual([2]);
  expect(events(f.session, "answer.response_gate_deadline_updated")).toHaveLength(0);
  expect(
    events(f.session, "answer.stale_output_discarded")
      .slice(1)
      .every(event => (event.detail as { received_after_cancellation: boolean }).received_after_cancellation),
  ).toBe(true);
});

it("quiet output is permanently discarded for acknowledgment and only fresh B asks the next question", async () => {
  const f = setup();
  f.transcript("sprout", "How many?");
  f.session.receive({ type: "output.activity", state: "quiet", sourceId: 1 });
  f.child();
  await f.decide();
  expect(f.session.snapshot.sceneIndex).toBe(1);
  expect(f.transport.discardOutput).toHaveBeenCalledOnce();
  f.session.displayed(1, f.session.snapshot.displayToken);
  expect(f.sent).toEqual([]);
  expect(f.transport.prepareReplacement).toHaveBeenCalledOnce();
  f.ready();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.sent.map(x => x.source)).toEqual([2]);
  expect(events(f.session, "answer.response_gate_released")[0].detail).toMatchObject({
    reason: "replacement_source",
    wait_ms: 251,
  });
});

it.each([
  ["STAY", { status: "evaluated", probability: 0, model: "test", latencyMs: 1 }],
  ["UNAVAILABLE", { status: "unavailable", reason: "timeout", latencyMs: 1 }],
] as const)("resumes %s only on fresh instructed output", async (decision, result) => {
  const f = setup(result);
  f.child();
  f.transcript("sprout", "stale filler");
  await f.decide();
  expect(f.session.snapshot.sceneIndex).toBe(0);
  expect(f.transport.prepareReplacement).toHaveBeenCalledOnce();
  expect(f.sent).toEqual([]);
  f.ready();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.sent.map(item => item.source)).toEqual([2]);
  expect(events(f.session, "answer.response_gate_released")[0].detail).toMatchObject({ decision, wait_ms: 251 });
});

it("recovers the evaluator deadline on fresh neutral output while keeping stale output discarded", async () => {
  const f = setup();
  f.child();
  f.transcript("sprout", "stale correctness praise");
  await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_MS + EVALUATION_TIMEOUT_MS + 1);
  expect(events(f.session, "answer.evaluated").at(-1)?.detail).toMatchObject({
    unavailable: "timeout",
    decision: "UNAVAILABLE",
    latency_ms: EVALUATION_TIMEOUT_MS,
  });
  expect(f.session.snapshot.sceneIndex).toBe(0);
  expect(f.transport.prepareReplacement).toHaveBeenCalledWith(
    expect.objectContaining({ decision: "UNAVAILABLE", sceneIndex: 0, childUtterance: "One" }),
    expect.any(AbortSignal),
  );
  expect(f.sent).toEqual([]);
  expect(f.transport.setOutputBlocked).not.toHaveBeenCalledWith(false);
  f.finishEvaluation(); // Late ADVANCE cannot replace the committed timeout.
  await vi.advanceTimersByTimeAsync(0);
  expect(f.session.snapshot.sceneIndex).toBe(0);
  expect(f.transport.prepareReplacement).toHaveBeenCalledOnce();
  f.ready();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.sent).toHaveLength(1);
  expect(f.sent[0]).toMatchObject({
    source: 2,
    command: { content: expect.stringContaining("Do not judge the answer right or wrong.") },
  });
  expect(f.transport.activeSourceId).toBe(2);
  expect(f.transport.discardOutput).toHaveBeenCalledOnce();
  expect(f.transport.setOutputBlocked).toHaveBeenLastCalledWith(false);
  expect(events(f.session, "answer.response_gate_released").at(-1)?.detail).toMatchObject({
    decision: "UNAVAILABLE",
    timeout_to_release_ms: 1,
  });
});

it("retains answer corrections after output discard and prepares only the revised outcome", async () => {
  const f = setup();
  f.child();
  f.transcript("sprout", "stale filler");
  f.transcript("child", " no, two", 1100);
  await vi.advanceTimersByTimeAsync(251);
  expect(f.evaluate).toHaveBeenCalledExactlyOnceWith(
    { sceneIndex: 0, utterance: "One no, two" },
    expect.any(AbortSignal),
  );
  expect(f.transport.discardOutput).toHaveBeenCalledOnce();
  expect(f.transport.prepareReplacement).not.toHaveBeenCalled();
  expect(f.sent).toEqual([]);
  expect((f.transport as Transport).activeSourceId).toBe(1);
  expect(f.session.events.findLast(event => event.type === "answer.transcript_revision")?.detail).toMatchObject({
    utterance: "One no, two",
  });
  f.finishEvaluation();
  await vi.advanceTimersByTimeAsync(0);
  f.session.displayed(1, f.session.snapshot.displayToken);
  expect(f.transport.prepareReplacement).toHaveBeenCalledWith(
    expect.objectContaining({ childUtterance: "One no, two" }),
    expect.any(AbortSignal),
  );
  f.ready();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.sent).toHaveLength(1);
  expect(f.sent[0].source).toBe(2);
});

it("discards media that races in during evaluation before any output caption", async () => {
  const f = setup();
  f.child();
  f.session.receive({ type: "output.activity", state: "active", sourceId: 1 });
  expect(f.transport.discardOutput).toHaveBeenCalledOnce();
  await f.decide();
  f.session.displayed(1, f.session.snapshot.displayToken);
  f.ready();
  await vi.advanceTimersByTimeAsync(0);
  expect(events(f.session, "answer.response_gate_released")[0].detail).toMatchObject({
    wait_ms: 251,
    reason: "replacement_source",
  });
});

it("fails closed if output isolation throws, without processing the stale caption further", () => {
  const f = setup();
  vi.mocked(f.transport.discardOutput!).mockImplementation(() => {
    throw new Error("isolation failed");
  });
  f.child();
  expect(() => f.transcript("sprout", "stale filler")).not.toThrow();
  expect(f.session.snapshot).toMatchObject({ status: "ended", reason: "connection_failure" });
  expect(f.transport.stopMedia).toHaveBeenCalled();
  expect(events(f.session, "answer.response_gate_released")).toHaveLength(0);
});

it("cannot fall back to discarded output when replacement fails", async () => {
  const f = setup();
  vi.mocked(f.transport.prepareReplacement!).mockRejectedValue(new Error("setup failed"));
  f.child();
  f.transcript("sprout", "stale filler");
  await f.decide();
  f.session.displayed(1, f.session.snapshot.displayToken);
  await vi.advanceTimersByTimeAsync(UTTERANCE_GAP_MS + 1);
  expect(f.transport.setOutputBlocked).not.toHaveBeenCalledWith(false);
  expect(f.sent).toEqual([]);
  await vi.advanceTimersByTimeAsync(RESPONSE_GATE_RECOVERY_MS);
  expect(f.session.snapshot).toMatchObject({ status: "ended", reason: "connection_failure" });
  expect(f.transport.stopMedia).toHaveBeenCalled();
});

it("fails closed if accepted acknowledgment cannot permanently discard A even when its transcript becomes quiet", async () => {
  const f = setup();
  vi.mocked(f.transport.discardOutput!).mockReturnValue(false);
  f.child();
  f.transcript("sprout", "stale filler");
  await f.decide();
  await vi.advanceTimersByTimeAsync(UTTERANCE_GAP_MS);
  expect(f.session.snapshot.sceneIndex).toBe(0);
  expect(f.session.snapshot.reason).toBe("connection_failure");
  expect(f.sent).toEqual([]);
  expect(events(f.session, "answer.response_gate_released")).toHaveLength(0);
  expect(f.transport.playAcknowledgment).not.toHaveBeenCalled();
});
