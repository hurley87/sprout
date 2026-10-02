import { immediateAcknowledgment } from "./helpers/immediate-acknowledgment";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LessonSession, RESPONSE_GATE_RECOVERY_MS, type Transport } from "../lib/session";
import { CORRECTION_WINDOW_MS, MICROPHONE_QUIET_MS, TRANSCRIPT_FALLBACK_MS } from "../lib/answer";
import type { ProviderEvent } from "../lib/events";
import { UTTERANCE_GAP_MS } from "../lib/transcript";
import { ResponseSourceContract } from "./helpers/response-source-contract";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const transcript = (delta: string, speaker: "child" | "sprout" = "child"): ProviderEvent => ({
  type: "transcript",
  speaker,
  delta,
  startMs: 0,
  endMs: 500,
});
const settle = () => vi.advanceTimersByTimeAsync(TRANSCRIPT_FALLBACK_MS + CORRECTION_WINDOW_MS);

function fixture(probability = 0.99) {
  const contract = new ResponseSourceContract();
  const playback: Record<string, boolean> = { A: false, B: false, C: false };
  const history: { epoch: string; blocked: boolean; a: boolean; b: boolean; c: boolean }[] = [];
  const ports = Object.fromEntries(
    ["A", "B", "C"].map(epoch => [
      epoch,
      {
        block: vi.fn((blocked: boolean) => {
          playback[epoch] = !blocked;
          history.push({ epoch, blocked, a: playback.A, b: playback.B, c: playback.C });
        }),
        stop: vi.fn(),
      },
    ]),
  );
  for (const epoch of ["A", "B", "C"]) contract.add(epoch, ports[epoch]);
  contract.ready("A");
  contract.begin("A", "greeting", RESPONSE_GATE_RECOVERY_MS, vi.fn());
  contract.activate("A");
  contract.permit("greeting");
  let identity = "greeting";
  // This adapter is a reference oracle layered over the unchanged session.
  // Production currently requests global unmute; here it means app permission
  // only, and cannot select a source or bypass readiness/child arbitration.
  const transport: Transport = {
    start: vi.fn(async () => {}),
    send: vi.fn(),
    setOutputBlocked: vi.fn(blocked => (blocked ? contract.block() : contract.permit(identity))),
    stopMedia: vi.fn(() => contract.end()),
    close: vi.fn(),
  };
  const evaluate = vi.fn(async () => ({ status: "evaluated" as const, probability, model: "test", latencyMs: 0 }));
  immediateAcknowledgment(transport, () => session.snapshot.choreographyPhase);
  const session = new LessonSession(transport, evaluate, vi.fn());
  void session.start();
  session.receive({ type: "session.started" });
  session.displayed(0, session.snapshot.displayToken);
  function answer(delta: string, epoch = "B") {
    session.receive({ ...transcript(delta), sourceId: transport.activeSourceId });
    const gate = session.events.findLast(e =>
      ["answer.response_gate_started", "answer.response_gate_updated"].includes(e.type),
    )!;
    const detail = gate.detail as { answer_version: string; transcript_revision: number };
    identity = `${detail.transcript_revision}:${detail.answer_version}`;
    contract.begin(epoch, identity, RESPONSE_GATE_RECOVERY_MS, () => session.fail("replacement unavailable"));
    return identity;
  }
  function late(epoch = "A") {
    for (const event of [
      transcript("One", "sprout"),
      transcript("One"),
      { type: "output.activity", state: "quiet" },
      { type: "output.activity", state: "active" },
      { type: "context.appended", name: "session.instructions.appended" },
      { type: "session.closed" },
      { type: "provider.error" },
    ] as ProviderEvent[]) {
      contract.accept(epoch, () => session.receive(event));
    }
  }
  return { contract, ports, history, session, transport, evaluate, answer, late };
}

describe("response-source isolation reference contract (production replacement deferred)", () => {
  it("requires readiness, retirement, authority and application permission in that order", () => {
    const { contract, ports, history, answer, session } = fixture();
    const identity = answer("One");
    expect(contract.activate("B")).toBe(false);
    contract.permit(identity);
    expect(contract.eligible("A")).toBe(false);
    expect(contract.eligible("B")).toBe(false);
    contract.ready("B");
    expect(contract.eligible("B")).toBe(false);
    expect(ports.A.stop).not.toHaveBeenCalled();
    const pendingCallback = vi.fn();
    contract.accept("B", pendingCallback);
    expect(pendingCallback).not.toHaveBeenCalled();
    ports.A.stop.mockImplementation(() => {
      // Synchronous teardown callbacks see A invalidated and B still blocked.
      expect(contract.eligible("A")).toBe(false);
      expect(contract.eligible("B")).toBe(false);
      contract.accept("A", pendingCallback);
    });
    contract.activate("B");
    expect(pendingCallback).not.toHaveBeenCalled();
    expect(contract.trace.slice(-4)).toEqual(["ready:B", "retired:A", "authority:B", "permitted:B"]);
    expect(ports.A.stop).toHaveBeenCalledOnce();
    expect(contract.eligible("B")).toBe(true);
    expect(history.every(row => [row.a, row.b, row.c].filter(Boolean).length <= 1)).toBe(true);
    expect(history.filter(row => !row.blocked && row.epoch === "A")).toHaveLength(1);
    session.dispose();
  });

  it("ADVANCE evaluates, commits exactly once, displays, then permits only B despite late A output", async () => {
    const { contract, session, answer, late, evaluate } = fixture();
    answer("One");
    contract.ready("B");
    contract.activate("B");
    await settle();
    expect(evaluate).toHaveBeenCalledOnce();
    expect(session.snapshot.sceneIndex).toBe(1);
    expect(contract.eligible("B")).toBe(false);
    const before = session.events.length;
    late();
    expect(session.events).toHaveLength(before);
    session.displayed(1, session.snapshot.displayToken);
    await vi.advanceTimersByTimeAsync(0);
    expect(contract.eligible("B")).toBe(true);
    const order = session.events.map(e => e.type);
    expect(order.indexOf("answer.evaluated")).toBeLessThan(order.indexOf("advance.committed"));
    expect(order.indexOf("advance.committed")).toBeLessThan(order.lastIndexOf("scene.displayed"));
    expect(order.lastIndexOf("scene.displayed")).toBeLessThan(order.indexOf("answer.response_gate_released"));
    const snapshot = { ...session.snapshot };
    await vi.advanceTimersByTimeAsync(UTTERANCE_GAP_MS + 1);
    contract.ready("A");
    expect(contract.activate("A")).toBe(false);
    late();
    session.displayed(1, session.snapshot.displayToken);
    expect(session.snapshot).toEqual(snapshot);
    expect(session.events.filter(e => e.type === "advance.committed")).toHaveLength(1);
    expect(contract.eligible("A")).toBe(false);
    session.dispose();
  });

  it.each([0.1, 0.79])(
    "STAY (%s) supersedes answer identity and waits for correction arbitration",
    async probability => {
      const { contract, session, answer, late, ports } = fixture(probability);
      const earlier = answer("Five");
      await vi.advanceTimersByTimeAsync(TRANSCRIPT_FALLBACK_MS);
      const revised = answer(" no two", "C");
      expect(revised).not.toBe(earlier);
      expect(ports.B.stop).toHaveBeenCalledOnce();
      contract.ready("C");
      contract.activate("C");
      contract.permit(earlier);
      expect(contract.eligible("C")).toBe(false);
      await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS - 1);
      expect(contract.eligible("C")).toBe(false);
      await settle();
      expect(session.snapshot.sceneIndex).toBe(0);
      expect(session.events.filter(e => e.type === "advance.committed")).toHaveLength(0);
      expect(session.events.findLast(e => e.type === "answer.response_gate_released")?.detail).toMatchObject({
        decision: "STAY",
        transcript_revision: 2,
        answer_version: "0:Five no two",
      });
      expect(contract.eligible("C")).toBe(true);
      const before = session.events.length;
      late();
      late("B");
      expect(session.events).toHaveLength(before);
      expect(contract.eligible("A")).toBe(false);
      session.dispose();
    },
  );

  it("child speech wins when B becomes ready during the handoff", async () => {
    const { contract, session, answer } = fixture(0.1);
    answer("Five");
    contract.child(true);
    session.receive({ type: "microphone.activity_started" });
    contract.ready("B");
    contract.activate("B");
    await settle();
    expect(contract.eligible("B")).toBe(false);
    expect(session.events.filter(e => e.type === "answer.response_gate_released")).toHaveLength(0);
    session.receive({ type: "microphone.speech_started" });
    await settle();
    // The existing bounded VAD grace may finish; the source contract must
    // still reject playback while actual child activity remains asserted.
    expect(contract.eligible("B")).toBe(false);
    session.receive({ type: "microphone.speech_stopped", quietMs: MICROPHONE_QUIET_MS });
    contract.child(false);
    await settle();
    expect(contract.eligible("B")).toBe(true);
    // A second child interruption mutes even an already permitted source.
    contract.child(true);
    expect(contract.eligible("B")).toBe(false);
    session.dispose();
  });

  it.each(["parent_stop", "wrap_up"] as const)("%s stops current and pending sources before late callbacks", reason => {
    const { contract, session, answer, late, ports } = fixture();
    const identity = answer("One");
    ports.A.stop.mockImplementation(() => late());
    session.end(reason);
    expect(ports.A.stop).toHaveBeenCalledOnce();
    expect(ports.B.stop).toHaveBeenCalledOnce();
    const before = session.events.length;
    contract.ready("B");
    contract.activate("B");
    contract.permit(identity);
    late();
    late("B");
    expect(session.events).toHaveLength(before);
    expect(session.snapshot.reason).toBe(reason);
    expect(contract.eligible("A")).toBe(false);
    expect(contract.eligible("B")).toBe(false);
    session.dispose();
  });

  it.each(["never-ready", "setup-failed"])(
    "%s fails closed within the original 15-second budget even after revision",
    async mode => {
      const { contract, session, answer, late, ports } = fixture(0.1);
      answer("Five");
      const started = Date.now();
      if (mode === "setup-failed") contract.fail("B");
      await settle(); // Application release alone cannot open either source.
      expect(contract.eligible("A")).toBe(false);
      expect(contract.eligible("B")).toBe(false);
      await vi.advanceTimersByTimeAsync(1000);
      answer(" no two", "C");
      await vi.advanceTimersByTimeAsync(started + RESPONSE_GATE_RECOVERY_MS - Date.now() - 1);
      expect(session.snapshot.status).toBe("active");
      await vi.advanceTimersByTimeAsync(1);
      expect(RESPONSE_GATE_RECOVERY_MS).toBe(15_000);
      expect(session.snapshot.reason).toBe("connection_failure");
      expect(ports.A.stop).toHaveBeenCalledOnce();
      expect(ports.B.stop).toHaveBeenCalledOnce();
      expect(ports.C.stop).toHaveBeenCalledOnce();
      const before = session.events.length;
      contract.ready("C");
      contract.activate("C");
      late();
      late("B");
      late("C");
      expect(session.events).toHaveLength(before);
      expect(contract.eligible("A")).toBe(false);
      expect(contract.eligible("C")).toBe(false);
      session.dispose();
    },
  );
});
