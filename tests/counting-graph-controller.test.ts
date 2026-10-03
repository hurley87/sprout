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
function fixture() {
  const clock = new Clock();
  const transport = { send: vi.fn<GraphTransport["send"]>(() => true), retireSource: vi.fn() };
  const controller = new CountingGraphController(transport, clock, { quietMs: 100, failureMs: 1000 });
  let sourceId = 0;
  let sink: (event: ProviderEvent) => void;
  const start = () => {
    sink = controller.startSource(++sourceId)!;
    expect(sink).toBeTypeOf("function");
    controller.confirmRender(controller.pendingRender!);
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
    expect(f.controller.snapshot.outputWasActive).toBe(true);
    f.delegate();
    expect(f.controller.snapshot).toMatchObject({ phase: "awaiting audio drain", ackAudioObserved: true });
    f.clock.tick(100);
    expect(f.controller.snapshot.nodeId).toBe(initial.nodeId);
    f.activity("quiet");
    f.clock.tick(99);
    expect(f.controller.snapshot.nodeId).toBe(initial.nodeId);
    f.clock.tick(1);
    expect(f.controller.snapshot).toMatchObject({
      nodeId: "count-2-ducks",
      phase: "awaiting render",
      outputWasActive: false,
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
    f.activity("active");
    f.delegate("too-early");
    f.activity("quiet");
    f.clock.tick(100);
    expect(f.controller.snapshot.phase).toBe("teaching");
    expect(f.controller.snapshot.ackAudioObserved).toBe(false);
    expect(f.controller.delegationHandles.get("too-early")?.state).toBe("retired");
    f.clock.tick(900);
    expect(f.controller.snapshot).toMatchObject({ phase: "failed", nodeId: "count-1-duck" });
  });

  it("pre-existing quiet and duplicate quiet cannot supply a post-delegation transition", () => {
    const f = fixture();
    f.activity("active");
    f.activity("quiet");
    f.delegate();
    f.activity("quiet");
    f.clock.tick(500);
    expect(f.controller.snapshot.phase).toBe("awaiting audio drain");
    f.activity("active");
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
        ackAudioObserved: false,
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
      expect(f.controller.snapshot).toMatchObject({ ackAudioObserved: false, outputWasActive: false });
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
