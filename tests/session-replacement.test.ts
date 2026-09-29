import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LessonSession, RESPONSE_GATE_RECOVERY_MS, STALE_OUTPUT_REPLACEMENT_MS, type Transport } from "../lib/session";
import {
  advanceContext,
  stayContext,
  evaluationUnavailableContext,
  sceneAt,
  type ReplacementSeed,
} from "../lib/lesson";
import type { AnswerResult } from "../lib/answer";
import { UTTERANCE_GAP_MS } from "../lib/transcript";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
const result = (decision: ReplacementSeed["decision"]): AnswerResult =>
  decision === "UNAVAILABLE"
    ? { status: "unavailable", reason: "timeout", latencyMs: 1 }
    : { status: "evaluated", probability: decision === "ADVANCE" ? 1 : 0, model: "test", latencyMs: 1 };

function setup(decision: ReplacementSeed["decision"] = "ADVANCE", evaluate?: () => Promise<AnswerResult>) {
  let resolve!: (id: number) => void;
  let reject!: (error: Error) => void;
  const order: string[] = [];
  const transport: Transport = {
    activeSourceId: 1,
    start: vi.fn(async () => {}),
    send: vi.fn(() => order.push("instruction")),
    setOutputBlocked: vi.fn(blocked => order.push(blocked ? "blocked" : "permitted")),
    stopMedia: vi.fn(),
    close: vi.fn(),
    prepareReplacement: vi.fn(
      () =>
        new Promise<number>((yes, no) => {
          resolve = yes;
          reject = no;
        }),
    ),
    activateSource: vi.fn(id => {
      order.push("promoted");
      Object.assign(transport, { activeSourceId: id });
      return true;
    }),
    retireSource: vi.fn(),
  };
  const session = new LessonSession(transport, vi.fn(evaluate ?? (async () => result(decision))), vi.fn());
  void session.start();
  session.receive({ type: "session.started" });
  session.displayed(0);
  vi.mocked(transport.send).mockClear();
  vi.mocked(transport.setOutputBlocked).mockClear();
  order.length = 0;
  const transcript = (speaker: "child" | "sprout", delta: string, startMs = 0) =>
    session.receive({ type: "transcript", speaker, delta, startMs, endMs: startMs + 100 });
  const child = (text = "One", startMs = 0) => {
    session.receive({ type: "microphone.speech_started" });
    transcript("child", text, startMs);
    session.receive({ type: "microphone.speech_stopped", quietMs: 900 });
  };
  const fragments = () => setInterval(() => transcript("sprout", "hidden ", Date.now()), 500);
  return {
    session,
    transport,
    order,
    child,
    transcript,
    fragments,
    ready: () => resolve(2),
    fail: () => reject(new Error("startup failed")),
  };
}
async function held(decision: ReplacementSeed["decision"] = "ADVANCE") {
  const f = setup(decision);
  f.child();
  f.transcript("sprout", "old ");
  const hidden = f.fragments();
  await vi.advanceTimersByTimeAsync(251);
  if (decision === "ADVANCE") f.session.displayed(1);
  return { ...f, hidden };
}
const event = (s: LessonSession, type: string) => s.events.filter(e => e.type === type);
const trigger = () => vi.advanceTimersByTimeAsync(STALE_OUTPUT_REPLACEMENT_MS + 1);

it("normal output quiet finishes on A without a replacement", async () => {
  const f = setup();
  f.child();
  f.transcript("sprout", "short");
  await vi.advanceTimersByTimeAsync(251);
  f.session.displayed(1);
  await vi.advanceTimersByTimeAsync(2500);
  expect(f.transport.prepareReplacement).not.toHaveBeenCalled();
  expect(event(f.session, "answer.response_gate_released")[0].detail).toMatchObject({
    reason: "output_transcript_quiet",
  });
});

it.each(["ADVANCE", "STAY", "UNAVAILABLE"] as const)(
  "%s replaces only after provider-only hold and sends current authoritative context exactly once",
  async decision => {
    const f = await held(decision);
    await vi.advanceTimersByTimeAsync(STALE_OUTPUT_REPLACEMENT_MS - 2);
    expect(f.transport.prepareReplacement).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3);
    expect(f.transport.prepareReplacement).toHaveBeenCalledExactlyOnceWith(
      { sceneIndex: decision === "ADVANCE" ? 1 : 0, decision, childUtterance: "One" },
      expect.any(AbortSignal),
    );
    expect(f.transport.send).not.toHaveBeenCalled();
    f.ready();
    await Promise.resolve();
    await Promise.resolve();
    const context =
      decision === "ADVANCE"
        ? advanceContext(sceneAt(1))
        : decision === "STAY"
          ? stayContext(sceneAt(0))
          : evaluationUnavailableContext(sceneAt(0));
    expect(f.transport.send).toHaveBeenCalledOnce();
    expect(f.transport.send).toHaveBeenCalledWith(expect.objectContaining({ content: context }));
    expect(f.order.slice(-4)).toEqual(["blocked", "promoted", "instruction", "permitted"]);
    expect(event(f.session, "replacement.promoted")).toHaveLength(1);
    expect(event(f.session, "answer.response_gate_released")[0].detail).toMatchObject({
      reason: "replacement_source",
      decision,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.transport.send).toHaveBeenCalledOnce();
    expect(event(f.session, "answer.response_gate_released")).toHaveLength(1);
    expect(event(f.session, "advance.committed")).toHaveLength(decision === "ADVANCE" ? 1 : 0);
  },
);

it.each(["ADVANCE", "STAY"] as const)(
  "new transcript cancels pending %s; late resolution cannot promote or instruct",
  async decision => {
    const f = await held(decision);
    await trigger();
    const signal = vi.mocked(f.transport.prepareReplacement!).mock.calls[0][1];
    f.transcript("child", "Two", 4000);
    expect(signal.aborted).toBe(true);
    expect(event(f.session, "replacement.cancelled")[0].detail).toMatchObject({ reason: "newer_transcript" });
    f.ready();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.transport.retireSource).toHaveBeenCalledWith(2);
    expect(f.transport.activateSource).not.toHaveBeenCalled();
    expect(f.transport.send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1800);
    expect(event(f.session, "answer.evaluated").at(-1)?.detail).toMatchObject({ utterance: "Two", stale: false });
  },
);

it.each(["microphone.activity_started", "microphone.speech_started"] as const)(
  "%s cancels B and preserves blocking",
  async type => {
    const f = await held();
    await trigger();
    f.session.receive({ type });
    f.ready();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(3000);
    expect(event(f.session, "replacement.cancelled")[0].detail).toMatchObject({ reason: "child_speech" });
    expect(f.transport.activateSource).not.toHaveBeenCalled();
    expect(f.transport.setOutputBlocked).not.toHaveBeenCalledWith(false);
  },
);

it("startup failure keeps A blocked and expires at the original 15s deadline", async () => {
  const f = await held("STAY");
  const elapsed = 251 + STALE_OUTPUT_REPLACEMENT_MS + 1;
  await trigger();
  f.fail();
  await Promise.resolve();
  await Promise.resolve();
  expect(event(f.session, "replacement.cancelled")[0].detail).toMatchObject({ reason: "startup_failure" });
  expect(f.transport.setOutputBlocked).not.toHaveBeenCalledWith(false);
  await vi.advanceTimersByTimeAsync(RESPONSE_GATE_RECOVERY_MS - elapsed - 1);
  expect(f.session.snapshot.status).toBe("active");
  await vi.advanceTimersByTimeAsync(1);
  expect(f.session.snapshot.reason).toBe("connection_failure");
  expect(f.transport.stopMedia).toHaveBeenCalledOnce();
  expect(f.transport.close).toHaveBeenCalledOnce();
});

it("original recovery expires while B is pending; late B resolution is retired", async () => {
  const f = await held();
  await trigger();
  await vi.advanceTimersByTimeAsync(RESPONSE_GATE_RECOVERY_MS - 251 - STALE_OUTPUT_REPLACEMENT_MS - 1);
  expect(f.session.snapshot.reason).toBe("connection_failure");
  expect(event(f.session, "replacement.cancelled")[0].detail).toMatchObject({ reason: "recovery_expired" });
  expect(vi.mocked(f.transport.prepareReplacement!).mock.calls[0][1].aborted).toBe(true);
  expect(f.transport.stopMedia).toHaveBeenCalledOnce();
  expect(f.transport.close).toHaveBeenCalledOnce();
  f.ready();
  await Promise.resolve();
  await Promise.resolve();
  expect(f.transport.retireSource).toHaveBeenCalledWith(2);
  expect(f.transport.activateSource).not.toHaveBeenCalled();
});

it("promotion failure fails closed without permitting media", async () => {
  const f = await held();
  await trigger();
  vi.mocked(f.transport.activateSource!).mockReturnValue(false);
  f.ready();
  await Promise.resolve();
  await Promise.resolve();
  expect(f.session.snapshot.reason).toBe("connection_failure");
  expect(f.transport.send).not.toHaveBeenCalled();
  expect(event(f.session, "answer.response_gate_released")).toHaveLength(0);
  expect(f.order.indexOf("permitted")).toBeGreaterThan(f.order.indexOf("blocked")); // End cancels only after physical stop.
  expect(f.transport.stopMedia).toHaveBeenCalledOnce();
  expect(f.transport.retireSource).toHaveBeenCalledWith(2);
});

it("no replacement before scene display, during evaluation, or active child speech", async () => {
  const f = setup();
  f.child();
  f.fragments();
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.session.snapshot.sceneIndex).toBe(1);
  expect(f.transport.prepareReplacement).not.toHaveBeenCalled();
  f.session.displayed(1);
  f.session.receive({ type: "microphone.speech_started" });
  await vi.advanceTimersByTimeAsync(3000);
  expect(f.transport.prepareReplacement).not.toHaveBeenCalled();
});

it("normal quiet wins while replacement prepares and aborts B", async () => {
  const f = setup("STAY");
  f.child();
  f.transcript("sprout", "old");
  const fragments = f.fragments();
  await vi.advanceTimersByTimeAsync(251);
  await trigger();
  clearInterval(fragments);
  await vi.advanceTimersByTimeAsync(2500);
  expect(event(f.session, "answer.response_gate_released")[0].detail).toMatchObject({
    reason: "output_transcript_quiet",
  });
  f.ready();
  await Promise.resolve();
  await Promise.resolve();
  expect(f.transport.activateSource).not.toHaveBeenCalled();
  expect(f.transport.retireSource).toHaveBeenCalledWith(2);
});

it("no replacement while Jev is pending even with extended hidden output", async () => {
  let finish!: (result: AnswerResult) => void;
  const f = setup(
    "ADVANCE",
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  f.child();
  f.fragments();
  await vi.advanceTimersByTimeAsync(3000);
  expect(f.transport.prepareReplacement).not.toHaveBeenCalled();
  expect(event(f.session, "answer.evaluated")).toHaveLength(0);
  finish(result("ADVANCE"));
  await vi.advanceTimersByTimeAsync(0);
  expect(f.transport.prepareReplacement).not.toHaveBeenCalled();
  expect(f.session.snapshot.sceneIndex).toBe(1);
  f.session.displayed(1);
  await vi.advanceTimersByTimeAsync(STALE_OUTPUT_REPLACEMENT_MS + 1);
  expect(f.transport.prepareReplacement).toHaveBeenCalledOnce();
});

describe("replacement child interruption after displayed ADVANCE", () => {
  it("discarded provisional activity retains the original A quiet fallback", async () => {
    const f = await held();
    await trigger();
    f.session.receive({ type: "microphone.activity_started" });
    expect(event(f.session, "replacement.cancelled")[0].detail).toMatchObject({ reason: "child_speech" });
    expect(event(f.session, "answer.response_gate_released")).toHaveLength(0);
    expect(f.transport.setOutputBlocked).not.toHaveBeenCalledWith(false);
    clearInterval(f.hidden);
    await vi.advanceTimersByTimeAsync(UTTERANCE_GAP_MS + 1);
    expect(event(f.session, "answer.response_gate_released")).toHaveLength(0);
    f.session.receive({ type: "microphone.activity_discarded" });
    expect(event(f.session, "answer.response_gate_released")[0].detail).toMatchObject({
      reason: "output_transcript_quiet",
      decision: "ADVANCE",
    });
    expect(f.transport.send).toHaveBeenCalledOnce();
    expect(event(f.session, "advance.committed")).toHaveLength(1);
    expect(f.transport.prepareReplacement).toHaveBeenCalledOnce();
    f.ready();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.transport.retireSource).toHaveBeenCalledWith(2);
    expect(event(f.session, "replacement.promoted")).toHaveLength(0);
    expect(f.session.snapshot.status).toBe("active");
  });

  it("non-answer child turn preserves the old gate and never exposes stale A on arrival", async () => {
    const f = await held();
    await trigger();
    f.transcript("child", "what?", 4000);
    expect(event(f.session, "replacement.cancelled")[0].detail).toMatchObject({ reason: "newer_transcript" });
    expect(event(f.session, "answer.response_gate_preserved").at(-1)?.detail).toMatchObject({
      reason: "non_answer_child_interruption",
      output_blocked: true,
    });
    expect(event(f.session, "answer.response_gate_cancelled")).toHaveLength(0);
    expect(event(f.session, "answer.response_gate_released")).toHaveLength(0);
    expect(f.transport.setOutputBlocked).not.toHaveBeenCalledWith(false);
    expect(f.transport.send).not.toHaveBeenCalled();
    expect(event(f.session, "transcript.child_or_nearby_speaker").at(-1)?.detail).toMatchObject({
      delta: "what?",
      scene: sceneAt(1).id,
    });
    f.ready();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.transport.retireSource).toHaveBeenCalledWith(2);
    expect(f.transport.activateSource).not.toHaveBeenCalled();
    clearInterval(f.hidden);
    await vi.advanceTimersByTimeAsync(UTTERANCE_GAP_MS + 1);
    expect(event(f.session, "answer.response_gate_released")[0].detail).toMatchObject({
      reason: "output_transcript_quiet",
    });
    expect(f.transport.send).toHaveBeenCalledOnce();
    expect(f.transport.send).toHaveBeenCalledWith(expect.objectContaining({ content: advanceContext(sceneAt(1)) }));
  });

  it("new answer supersedes old ADVANCE gate on displayed scene without unblocking A", async () => {
    const f = await held();
    await trigger();
    f.transcript("child", "Two", 4000);
    expect(event(f.session, "answer.response_gate_superseded")[0].detail).toMatchObject({
      reason: "new_answer_on_displayed_scene",
      scene_index: 1,
      output_blocked: true,
    });
    expect(f.transport.setOutputBlocked).not.toHaveBeenCalledWith(false);
    expect(event(f.session, "answer.response_gate_released")).toHaveLength(0);
    expect(f.transport.send).not.toHaveBeenCalled();
    f.ready();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.transport.retireSource).toHaveBeenCalledWith(2);
    expect(f.transport.activateSource).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1800);
    expect(event(f.session, "answer.evaluated").at(-1)?.detail).toMatchObject({
      sceneIndex: 1,
      utterance: "Two",
      stale: false,
    });
    expect(
      event(f.session, "advance.committed").filter(e => (e.detail as { scene_index: number }).scene_index === 0),
    ).toHaveLength(1);
    expect(f.transport.send).not.toHaveBeenCalled();
  });

  it("child stop retires B, stops media before cleanup, and never permits stale A", async () => {
    const f = await held();
    await trigger();
    f.transcript("child", "stop", 4000);
    expect(f.session.snapshot.reason).toBe("child_stop");
    expect(event(f.session, "lesson.ended")).toHaveLength(1);
    expect(f.transport.stopMedia).toHaveBeenCalledOnce();
    expect(f.transport.setOutputBlocked).not.toHaveBeenCalledWith(false);
    expect(event(f.session, "replacement.cancelled")[0].detail).toMatchObject({ reason: "newer_transcript" });
    f.ready();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.transport.retireSource).toHaveBeenCalledWith(2);
    expect(f.transport.activateSource).not.toHaveBeenCalled();
  });
});
