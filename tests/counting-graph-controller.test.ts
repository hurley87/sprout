import { describe, expect, it, vi } from "vitest";
import { CountingGraphController, type GraphClock, type GraphTransport } from "../lib/counting-graph-controller";
import type { ProviderEvent } from "../lib/events";

class Clock implements GraphClock {
  now = 0;
  tasks: { at: number; callback: () => void; cancelled: boolean }[] = [];
  setTimeout(callback: () => void, ms: number) {
    const task = { at: this.now + ms, callback, cancelled: false };
    this.tasks.push(task);
    return task;
  }
  clearTimeout(handle: unknown) {
    (handle as (typeof this.tasks)[number]).cancelled = true;
  }
  tick(ms: number) {
    const until = this.now + ms;
    while (true) {
      const task = this.tasks.filter(t => !t.cancelled && t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!task) break;
      this.now = task.at;
      task.cancelled = true;
      task.callback();
    }
    this.now = until;
  }
}
function fixture(childTurn = true) {
  const clock = new Clock();
  const transport = { send: vi.fn<GraphTransport["send"]>(() => true), retireSource: vi.fn() };
  const controller = new CountingGraphController(transport, clock, { quietMs: 100, failureMs: 1000 });
  let sourceId = 0;
  let sink: (event: ProviderEvent) => void;
  const start = () => {
    sink = controller.startSource(++sourceId)!;
    expect(sink).toBeTypeOf("function");
    controller.confirmRender(controller.pendingRender!);
    if (childTurn) sink({ type: "microphone.speech_started", sourceId });
  };
  const emit = (event: ProviderEvent) => sink({ ...event, sourceId: event.sourceId ?? sourceId });
  const activity = (state: "active" | "quiet" | "unavailable") => emit({ type: "output.activity", state });
  const delegate = (id = `d-${sourceId}`) => emit({ type: "delegation", id });
  const drain = () => {
    activity("active");
    delegate();
    activity("quiet");
    clock.tick(100);
  };
  start();
  return { controller, clock, transport, start, emit, activity, delegate, drain, sink: () => sink };
}

describe("experimental graph transition authority", () => {
  it("holds the old node until sustained quiet and releases successor context only after exact render", () => {
    const f = fixture();
    const initial = f.controller.snapshot;
    f.activity("active");
    expect(f.controller.snapshot.ackOutputObserved).toBe(true);
    f.delegate();
    expect(f.controller.snapshot).toMatchObject({
      phase: "awaiting audio drain",
      ackOutputObserved: true,
      ackOutputDrained: false,
    });
    f.clock.tick(100);
    expect(f.controller.snapshot.nodeId).toBe(initial.nodeId);
    f.activity("quiet");
    f.clock.tick(99);
    expect(f.controller.snapshot.nodeId).toBe(initial.nodeId);
    f.clock.tick(1);
    expect(f.controller.snapshot).toMatchObject({
      nodeId: "count-2-ducks",
      phase: "awaiting render",
      ackOutputObserved: false,
    });
    expect(f.transport.send).toHaveBeenCalledTimes(1);
    const render = f.controller.pendingRender!;
    for (const wrong of [
      { ...render, sourceId: 99 },
      { ...render, visitId: initial.visitId },
      { ...render, nodeId: initial.nodeId },
    ])
      expect(f.controller.confirmRender(wrong)).toBe(false);
    expect(f.controller.confirmRender(render)).toBe(true);
    expect(f.transport.send).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({ delegation_id: "d-1", content: expect.stringContaining("count-2-ducks") }),
    );
    expect(f.controller.confirmRender(render)).toBe(false);
    expect(f.controller.snapshot.phase).toBe("awaiting source");
    expect(f.controller.delegationHandles.get("d-1")?.state).toBe("retired");
  });

  it("rejects missing prior activity permanently, even if active output appears later", () => {
    const f = fixture();
    f.delegate("too-early");
    expect(f.controller.snapshot.ackOutputObserved).toBe(false);
    f.activity("active");
    f.delegate("too-early");
    f.activity("quiet");
    f.clock.tick(100);
    expect(f.controller.snapshot.phase).toBe("teaching");
    expect(f.controller.snapshot.ackOutputDrained).toBe(true);
    expect(f.controller.delegationHandles.get("too-early")?.state).toBe("retired");
    f.clock.tick(900);
    expect(f.controller.snapshot).toMatchObject({ phase: "failed", nodeId: "count-1-duck" });
  });

  it("accepts already drained post-child acknowledgment, counting quiet only from delegation", () => {
    const f = fixture();
    f.activity("active");
    f.activity("quiet");
    expect(f.controller.snapshot).toMatchObject({ ackOutputObserved: true, ackOutputDrained: true });
    f.clock.tick(500); // This earlier quiet time must not shorten the gate.
    f.delegate();
    f.clock.tick(70);
    f.delegate(); // A duplicate must not reset the accepted interval.
    f.activity("quiet"); // Nor may a duplicate quiet notification reset it.
    f.clock.tick(29);
    expect(f.controller.snapshot).toMatchObject({ nodeId: "count-1-duck", phase: "awaiting audio drain" });
    f.clock.tick(1);
    expect(f.controller.snapshot.phase).toBe("awaiting render");
  });

  it.each(["microphone.speech_started", "microphone.activity_started"] as const)(
    "%s discards pre-child question audio and prior-turn acknowledgment evidence",
    type => {
      const f = fixture(false);
      f.activity("active");
      f.activity("quiet");
      f.delegate("pre-child");
      expect(f.controller.snapshot).toMatchObject({
        phase: "teaching",
        ackOutputObserved: false,
        ackOutputDrained: false,
      });
      f.emit({ type });
      f.activity("quiet");
      f.delegate("no-ack");
      f.clock.tick(100);
      expect(f.controller.snapshot.phase).toBe("teaching");
      f.activity("active");
      f.activity("quiet");
      expect(f.controller.snapshot).toMatchObject({ ackOutputObserved: true, ackOutputDrained: true });
      f.emit({ type }); // A second child turn on this node must discard the first turn's audio.
      expect(f.controller.snapshot).toMatchObject({ ackOutputObserved: false, ackOutputDrained: false });
      f.delegate("previous-turn");
      f.clock.tick(100);
      expect(f.controller.snapshot.phase).toBe("teaching");
      f.activity("active");
      f.delegate("current-turn");
      f.activity("quiet");
      f.clock.tick(100);
      expect(f.controller.snapshot.phase).toBe("awaiting render");
    },
  );

  it("pre-child active audio ending after the child starts cannot establish acknowledgment evidence", () => {
    const f = fixture(false);
    f.activity("active");
    f.emit({ type: "microphone.speech_started" });
    f.activity("quiet");
    f.delegate();
    f.clock.tick(100);
    expect(f.controller.snapshot).toMatchObject({
      phase: "teaching",
      ackOutputObserved: false,
      ackOutputDrained: false,
    });
  });

  it("quiet without post-child active output cannot advance", () => {
    const f = fixture();
    f.activity("quiet");
    f.delegate();
    f.clock.tick(100);
    expect(f.controller.snapshot).toMatchObject({
      phase: "teaching",
      ackOutputObserved: false,
      ackOutputDrained: false,
    });
  });

  it.each(["active", "unavailable"] as const)("%s resets a gate accepted after already drained audio", state => {
    const f = fixture();
    f.activity("active");
    f.activity("quiet");
    f.delegate();
    f.clock.tick(70);
    const oldTimer = f.clock.tasks.at(-1)!;
    f.activity(state);
    expect(f.controller.snapshot.ackOutputDrained).toBe(false);
    oldTimer.callback();
    f.clock.tick(50);
    expect(f.controller.snapshot.phase).toBe("awaiting audio drain");
    f.activity("quiet");
    f.clock.tick(99);
    expect(f.controller.snapshot.phase).toBe("awaiting audio drain");
    f.clock.tick(1);
    expect(f.controller.snapshot.phase).toBe("awaiting render");
  });

  it("unavailable after drained audio cannot start a quiet interval on delegation", () => {
    const f = fixture();
    f.activity("active");
    f.activity("quiet");
    f.activity("unavailable");
    f.delegate();
    f.clock.tick(100);
    expect(f.controller.snapshot).toMatchObject({ phase: "awaiting audio drain", ackOutputDrained: false });
    f.activity("quiet");
    f.clock.tick(100);
    expect(f.controller.snapshot.phase).toBe("awaiting render");
  });

  it.each(["active", "unavailable"] as const)("%s invalidates quiet and a fresh interval is necessary", state => {
    const f = fixture();
    f.activity("active");
    f.delegate();
    f.activity("quiet");
    f.clock.tick(70);
    const stale = f.clock.tasks.at(-1)!;
    f.activity(state);
    stale.callback();
    f.clock.tick(50);
    expect(f.controller.snapshot.phase).toBe("awaiting audio drain");
    f.activity("quiet");
    f.clock.tick(99);
    expect(f.controller.snapshot.phase).toBe("awaiting audio drain");
    f.clock.tick(1);
    expect(f.controller.snapshot.phase).toBe("awaiting render");
  });

  it("retires duplicate, unsupported, wrong-source and wrong-phase requests without rebinding", () => {
    const f = fixture();
    f.emit({ type: "delegation.unsupported" });
    f.emit({ type: "delegation", id: "wrong-source", sourceId: 99 });
    f.activity("active");
    f.delegate("wrong-source");
    expect(f.controller.snapshot.phase).toBe("teaching");
    f.delegate();
    f.delegate();
    f.delegate("wrong-phase");
    f.activity("quiet");
    f.clock.tick(100);
    f.delegate("render-phase");
    const render = f.controller.pendingRender!;
    f.controller.confirmRender(render);
    f.start();
    f.activity("active");
    f.delegate("wrong-phase");
    f.delegate("render-phase");
    expect(f.controller.snapshot.phase).toBe("teaching");
    expect(f.transport.send).toHaveBeenCalledTimes(3);
  });

  it.each([undefined, 0, 999999])(
    "rejects stale distinct IDs on the same source after node change, regardless of offset %s",
    offsetMs => {
      const f = fixture();
      const oldSink = f.sink();
      f.drain();
      f.controller.confirmRender(f.controller.pendingRender!);
      expect(f.controller.startSource(1)).toBeUndefined();
      f.start();
      f.activity("active");
      oldSink({ type: "delegation", id: "distinct-stale", sourceId: 1, offsetMs });
      f.delegate("distinct-stale");
      oldSink({ type: "output.activity", state: "quiet", sourceId: 1 });
      f.clock.tick(100);
      expect(f.controller.snapshot).toMatchObject({
        nodeId: "count-2-ducks",
        phase: "teaching",
        ackOutputDrained: false,
      });
    },
  );

  it.each(["stop", "disconnect", "dispose", "speech", "activity"])(
    "%s cancels pending work, callbacks and handles",
    action => {
      const f = fixture();
      const oldSink = f.sink();
      f.activity("active");
      f.delegate();
      f.activity("quiet");
      const callbacks = [...f.clock.tasks];
      if (action === "speech") f.emit({ type: "microphone.speech_started" });
      else if (action === "activity") f.emit({ type: "microphone.activity_started" });
      else f.controller[action as "stop" | "disconnect" | "dispose"]();
      callbacks.forEach(t => t.callback());
      expect(f.controller.snapshot.nodeId).toBe("count-1-duck");
      expect(f.controller.snapshot).toMatchObject({ ackOutputDrained: false, ackOutputObserved: false });
      expect(f.controller.delegationHandles.get("d-1")?.state).toBe("retired");
      expect(f.transport.send).toHaveBeenCalledTimes(1);
      if (["speech", "activity", "disconnect"].includes(action)) {
        f.start();
        f.activity("active");
        f.delegate("d-1");
        oldSink({ type: "delegation", id: "late", sourceId: 1 });
        expect(f.controller.snapshot.phase).toBe("teaching");
      } else expect(f.controller.startSource(2)).toBeUndefined();
    },
  );

  it.each(["microphone.speech_started", "microphone.activity_started"] as const)(
    "%s interrupts progression accepted after acknowledgment already drained",
    type => {
      const f = fixture();
      f.activity("active");
      f.activity("quiet");
      f.delegate();
      const oldTimer = f.clock.tasks.at(-1)!;
      f.emit({ type });
      oldTimer.callback();
      f.clock.tick(100);
      expect(f.controller.snapshot).toMatchObject({
        nodeId: "count-1-duck",
        phase: "failed",
        ackOutputObserved: false,
        ackOutputDrained: false,
      });
      expect(f.controller.delegationHandles.get("d-1")?.state).toBe("retired");
      expect(f.transport.send).toHaveBeenCalledTimes(1);
    },
  );

  it("wrong-source child and media events cannot alter the current turn's gate", () => {
    const f = fixture();
    f.activity("active");
    f.activity("quiet");
    f.delegate();
    f.emit({ type: "microphone.speech_started", sourceId: 99 });
    f.emit({ type: "output.activity", state: "active", sourceId: 99 });
    f.emit({ type: "output.activity", state: "unavailable", sourceId: 99 });
    f.clock.tick(100);
    expect(f.controller.snapshot.phase).toBe("awaiting render");
  });

  it("interruption after commit invalidates render and retains the committed scene for recovery", () => {
    const f = fixture();
    f.drain();
    const render = f.controller.pendingRender!;
    // Callback captured for the old teaching visit cannot masquerade as the new render visit.
    f.emit({ type: "microphone.speech_started" });
    expect(f.controller.snapshot.phase).toBe("failed");
    expect(f.controller.confirmRender(render)).toBe(false);
    expect(f.controller.snapshot.nodeId).toBe("count-2-ducks");
    f.start();
    expect(f.controller.snapshot.phase).toBe("teaching");
  });

  it.each(["quiet missing", "media unavailable", "render missing"])(
    "fails recoverably without release when %s",
    kind => {
      const f = fixture();
      f.activity("active");
      f.delegate();
      if (kind === "media unavailable") f.activity("unavailable");
      if (kind === "render missing") {
        f.activity("quiet");
        f.clock.tick(100);
      }
      f.clock.tick(1000);
      expect(f.controller.snapshot.phase).toBe("failed");
      expect(f.controller.snapshot.nodeId).toBe(kind === "render missing" ? "count-2-ducks" : "count-1-duck");
      expect(f.transport.send).toHaveBeenCalledTimes(1);
    },
  );

  it("requires initial render before context and rejects startup-phase delegation", () => {
    const f = fixture();
    f.controller.disconnect();
    const sink = f.controller.startSource(2)!;
    sink({ type: "output.activity", state: "active", sourceId: 2 });
    sink({ type: "delegation", id: "startup", sourceId: 2 });
    expect(f.transport.send).toHaveBeenCalledTimes(1);
    f.controller.confirmRender(f.controller.pendingRender!);
    sink({ type: "microphone.speech_started", sourceId: 2 });
    sink({ type: "output.activity", state: "active", sourceId: 2 });
    sink({ type: "delegation", id: "startup", sourceId: 2 });
    expect(f.controller.snapshot.phase).toBe("teaching");
  });

  it("completes exactly the authored path, retains the final group and answers terminal once", () => {
    const f = fixture();
    for (let i = 0; i < 2; i++) {
      f.drain();
      f.controller.confirmRender(f.controller.pendingRender!);
      f.start();
    }
    f.drain();
    expect(f.controller.snapshot).toMatchObject({ nodeId: "count-3-butterflies", phase: "complete" });
    expect(f.controller.pendingRender).toBeUndefined();
    expect(f.transport.send).toHaveBeenLastCalledWith(
      3,
      expect.objectContaining({ delegation_id: "d-3", content: expect.stringContaining("completed the lesson") }),
    );
    const count = f.transport.send.mock.calls.length;
    f.delegate();
    f.delegate("terminal-late");
    f.activity("active");
    f.activity("quiet");
    f.clock.tick(5000);
    expect(f.transport.send).toHaveBeenCalledTimes(count);
    expect(f.controller.startSource(4)).toBeUndefined();
  });

  it("a cancelled teaching deadline cannot cancel the same visit's accepted progression", () => {
    const f = fixture();
    const oldDeadline = f.clock.tasks.at(-1)!;
    f.clock.tick(900);
    f.activity("active");
    f.delegate();
    oldDeadline.callback();
    expect(f.controller.snapshot.phase).toBe("awaiting audio drain");
    f.activity("quiet");
    f.clock.tick(100);
    expect(f.controller.snapshot.phase).toBe("awaiting render");
  });

  it("appended-context estimates cannot reauthorize a retired source", () => {
    const f = fixture();
    f.drain();
    f.controller.confirmRender(f.controller.pendingRender!);
    const command = f.transport.send.mock.calls.at(-1)![1];
    f.emit({
      type: "context.appended",
      name: "session.instructions.appended",
      clientEventId: command.event_id,
      startMs: 400,
      endMs: 500,
    });
    f.emit({ type: "delegation", id: "after-estimated-fence", offsetMs: 600 });
    expect(f.controller.snapshot.phase).toBe("awaiting source");
    expect(f.controller.delegationHandles.get("after-estimated-fence")?.state).toBe("retired");
  });

  it.each(["session.closed", "provider.error"] as const)(
    "%s from the pending source cancels successor render",
    type => {
      const f = fixture();
      f.drain();
      const render = f.controller.pendingRender!;
      f.emit({ type });
      expect(f.controller.snapshot.phase).toBe("failed");
      expect(f.controller.confirmRender(render)).toBe(false);
    },
  );

  it("failed transport sends retire pending authority without retrying the handle", () => {
    const f = fixture();
    f.drain();
    f.transport.send.mockReturnValue(false);
    const render = f.controller.pendingRender!;
    expect(f.controller.confirmRender(render)).toBe(false);
    expect(f.controller.snapshot.phase).toBe("failed");
    expect(f.controller.confirmRender(render)).toBe(false);
    expect(f.controller.delegationHandles.get("d-1")?.state).toBe("retired");
  });
});
