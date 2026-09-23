import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANSWER_QUESTION, ADVANCE_THRESHOLD, SETTLE_MS } from "../lib/answer";
import { parseProviderEvent } from "../lib/events";
import { evaluationHistory, safeEvaluationRequest } from "../lib/jev-diagnostics";
import { LessonSession, type Diagnostic, type Transport } from "../lib/session";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function sessionWith(
  answer: (signal: AbortSignal) => Promise<
    | {
        status: "evaluated";
        probability: number;
        model: string;
        latencyMs: number;
      }
    | { status: "unavailable"; reason: string; latencyMs: number }
  >,
) {
  const transport: Transport = { start: async () => {}, send: () => {}, stopMedia: () => {}, close: () => {} };
  const session = new LessonSession(
    transport,
    (_request, signal) => answer(signal),
    () => {},
  );
  void session.start();
  const started = parseProviderEvent({ type: "session.started" });
  if (started) session.receive(started);
  session.displayed(0);
  return session;
}
function say(session: LessonSession, delta: string, speaker: "input" | "output" = "input") {
  const event = parseProviderEvent({ type: `session.${speaker}_transcript.delta`, delta, start_ms: 0, end_ms: 500 });
  if (event) session.receive(event);
}

describe("Jev event timeline", () => {
  it("separates actual settling, request time and decision; keeps only a safe request", async () => {
    const session = sessionWith(async () => {
      await new Promise(resolve => setTimeout(resolve, 243));
      return { status: "evaluated", probability: 0.98, model: "jev-1.13.0", latencyMs: 243 };
    });
    say(session, "One");
    expect(evaluationHistory(session.events)[0].phase).toBe("settling");
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(evaluationHistory(session.events)[0]).toMatchObject({ phase: "requesting Jev", actualSettleMs: 1500 });
    await vi.advanceTimersByTimeAsync(243);
    const trace = evaluationHistory(session.events)[0];
    expect(trace).toMatchObject({
      phase: "evaluated",
      jevMs: 243,
      totalMs: 1743,
      probability: 0.98,
      decision: "ADVANCE",
      stale: false,
      deferred: false,
    });
    expect(safeEvaluationRequest(trace)).toEqual({
      state: { displayed: { object: "duck", quantity: 1, description: "1 duck" }, learnerUtterance: "One" },
      model: "jev-1.13.0",
      question: ANSWER_QUESTION,
      threshold: ADVANCE_THRESHOLD,
    });
    session.displayed(1);
    expect(evaluationHistory(session.events)[0].displayed).toBe(true);
  });

  it("records timeout, stale decision, deferred advance and cancelled deferral", async () => {
    const events: Diagnostic[] = [
      { at: -10, type: "answer.settling", detail: { version: "partial", sceneIndex: 1, utterance: "One" } },
      { at: 0, type: "answer.settling", detail: { version: "a", sceneIndex: 1, utterance: "One, two" } },
      { at: 1500, type: "answer.requesting", detail: { version: "a", actual_settle_ms: 1500 } },
      {
        at: 5500,
        type: "answer.evaluated",
        detail: {
          version: "a",
          latency_ms: 4000,
          total_ms: 5500,
          unavailable: "timeout",
          decision: "UNAVAILABLE",
          stale: false,
        },
      },
      { at: 6000, type: "answer.settling", detail: { version: "b", sceneIndex: 1, utterance: "One, two" } },
      { at: 7500, type: "answer.requesting", detail: { version: "b", actual_settle_ms: 1500 } },
      {
        at: 7700,
        type: "answer.evaluated",
        detail: { version: "b", latency_ms: 200, total_ms: 1700, probability: 0.98, decision: "ADVANCE", stale: false },
      },
      { at: 7700, type: "advance.deferred", detail: { answer_version: "b" } },
      { at: 8200, type: "advance.cancelled", detail: { answer_version: "b", delay_ms: 500 } },
      { at: 8300, type: "answer.settling", detail: { version: "c", sceneIndex: 1, utterance: "Another" } },
      { at: 8500, type: "answer.evaluated", detail: { version: "c", latency_ms: 200, decision: "STALE", stale: true } },
    ];
    const history = evaluationHistory(events);
    expect(history).toHaveLength(3);
    expect(history.map(trace => trace.decision)).toEqual(["UNAVAILABLE", "STALE", "STALE"]);
    expect(history[0]).toMatchObject({ phase: "unavailable", reason: "timeout", jevMs: 4000 });
    expect(history[1]).toMatchObject({ phase: "stale/cancelled", deferred: true, deferredMs: 500 });
    expect(history[2].stale).toBe(true);
  });
});
