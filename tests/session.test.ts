import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LessonSession, type LiveEvent, type Transport } from "../lib/session";
import { SCENES, TIMING, validScene, requestsStop } from "../lib/lesson";

function setup(active = true) {
  const transport: Transport = { start: vi.fn(async () => {}), send: vi.fn(), stopMedia: vi.fn(), close: vi.fn() };
  const session = new LessonSession(transport, vi.fn());
  void session.start();
  if (active) { session.receive({ type: "session.started" }); session.displayed(SCENES[0].id); }
  return { session, transport };
}
const advance = (id: string): LiveEvent => ({ type: "session.delegation.created", delegation: { id, target: "client" } });
const speech = (delta: string, start_ms = 0, output = false): LiveEvent => ({ type: `session.${output ? "output" : "input"}_transcript.delta`, delta, start_ms, end_ms: start_ms + 500 });
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("application lifecycle", () => {
  it("does not start the lesson clock or greet before session.started and display", () => {
    const { session, transport } = setup(false);
    vi.advanceTimersByTime(15_000);
    expect(transport.send).not.toHaveBeenCalled();
    session.receive({ type: "session.started" });
    expect(transport.send).not.toHaveBeenCalled();
    session.displayed(SCENES[0].id);
    expect(transport.send).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(TIMING.wrap - 1);
    expect(session.snapshot.status).toBe("active");
    vi.advanceTimersByTime(1);
    expect(session.snapshot.status).toBe("wrapping");
  });
  it("wraps at 4:30, requests goodbye at 5:00, stops at 5:08 without model cooperation", () => {
    const { session, transport } = setup();
    vi.advanceTimersByTime(TIMING.wrap);
    expect(session.snapshot.status).toBe("wrapping");
    session.receive(advance("late"));
    expect(session.snapshot.scene).toEqual(SCENES[0]);
    vi.advanceTimersByTime(TIMING.goodbye - TIMING.wrap);
    expect(session.snapshot.status).toBe("goodbye");
    session.receive(speech("Bye for now!", 300_000, true));
    expect(session.snapshot.status).toBe("goodbye");
    vi.advanceTimersByTime(TIMING.finish - TIMING.goodbye);
    expect(session.snapshot.reason).toBe("wrap_up");
    expect(transport.stopMedia).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1500);
    expect(transport.close).toHaveBeenCalledOnce();
  });
  it("hard-stops before applying a delayed event after six minutes", () => {
    const { session, transport } = setup();
    vi.setSystemTime(Date.now() + TIMING.hard);
    session.receive(advance("too-late"));
    expect(session.snapshot.reason).toBe("time_limit");
    expect(session.snapshot.scene).toEqual(SCENES[0]);
    expect(transport.close).toHaveBeenCalledOnce();
  });
  it("does not extend the hard limit for graceful close", () => {
    const { session, transport } = setup();
    vi.setSystemTime(Date.now() + TIMING.hard - 100);
    session.end("parent_stop");
    vi.advanceTimersByTime(100);
    expect(transport.close).toHaveBeenCalledOnce();
  });
  it("immediately stops media on parent stop, accepts finalization, ignores late actions", () => {
    const { session, transport } = setup();
    session.end("parent_stop");
    expect(transport.stopMedia).toHaveBeenCalledOnce();
    session.receive(advance("late"));
    session.receive(speech("continue"));
    session.displayed(SCENES[1].id);
    session.receive({ type: "session.closed", reason: "close_requested", usage: { seconds: 2 } });
    session.end("parent_stop");
    vi.runAllTimers();
    expect(transport.close).toHaveBeenCalledOnce();
    expect(session.events.filter(e => e.type === "lesson.ended")).toHaveLength(1);
    expect(session.events.at(-1)?.type).toBe("connection.finalized");
  });
  it("stops while starting and ignores late session.started", () => {
    const { session, transport } = setup(false);
    session.end("parent_stop");
    session.receive({ type: "session.started" });
    expect(session.snapshot.status).toBe("ended");
    expect(transport.close).toHaveBeenCalledOnce();
    expect(transport.send).not.toHaveBeenCalled();
  });
  it("fails stalled microphone/startup without reconnecting", () => {
    const { session, transport } = setup(false);
    vi.advanceTimersByTime(TIMING.startup);
    expect(session.snapshot.reason).toBe("connection_failure");
    expect(transport.close).toHaveBeenCalledOnce();
    expect(transport.start).toHaveBeenCalledOnce();
  });
  it("preserves completed transcript and scene on connection failure", () => {
    const { session, transport } = setup();
    session.receive(speech("one"));
    session.fail("Disconnected");
    expect(session.snapshot.error).toBe("Disconnected");
    expect(transport.close).toHaveBeenCalledOnce();
    expect(session.report().events.some(e => e.type === "transcript.child_or_nearby_speaker")).toBe(true);
    expect(session.report().events.some(e => e.type === "scene.displayed")).toBe(true);
  });
  it("fails closed on rejected provider commands and unsolicited close", () => {
    const a = setup();
    a.session.receive({ type: "error", error: { code: "not_allowed", message: "private detail" } });
    expect(a.session.snapshot.reason).toBe("connection_failure");
    expect(JSON.stringify(a.session.report())).not.toContain("private detail");
    const b = setup();
    b.session.receive({ type: "session.closed", reason: "connection_lost" });
    expect(b.session.snapshot.reason).toBe("connection_failure");
  });
  it("leaving the page immediately closes microphone and transport", () => {
    const { session, transport } = setup();
    session.dispose();
    expect(session.snapshot.reason).toBe("page_hidden");
    expect(transport.close).toHaveBeenCalledOnce();
  });
});

describe("bounded scene control", () => {
  it("acknowledges the actual display and deduplicates delegation IDs", () => {
    const { session, transport } = setup();
    vi.mocked(transport.send).mockClear();
    session.receive(advance("a"));
    expect(session.snapshot.scene).toEqual(SCENES[1]);
    expect(transport.send).not.toHaveBeenCalled();
    session.displayed("invented");
    expect(transport.send).not.toHaveBeenCalled();
    session.displayed(SCENES[1].id);
    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ type: "session.thinking.append", delegation_id: "a" }));
    session.receive(advance("a"));
    expect(session.snapshot.scene).toEqual(SCENES[1]);
  });
  it("rejects another request while a display is pending", () => {
    const { session } = setup();
    session.receive(advance("a"));
    session.receive(advance("b"));
    expect(session.snapshot.scene).toEqual(SCENES[1]);
    expect(session.events.some(e => e.type === "action.rejected")).toBe(true);
  });
  it("cannot invent scenes, change quantity through arguments, or advance past five", () => {
    const { session } = setup();
    for (let i = 0; i < 20; i++) {
      session.receive({ ...advance(`id-${i}`), arguments: { quantity: 100, jsx: "bad" } });
      session.displayed(session.snapshot.scene.id);
      expect(validScene(session.snapshot.scene)).toBe(true);
    }
    expect(session.snapshot.scene.quantity).toBe(5);
    expect(validScene({ ...SCENES[0], quantity: 6 })).toBe(false);
    expect(validScene({ ...SCENES[0], object: "<script>" })).toBe(false);
    session.receive({ type: "session.delegation.created", delegation: { id: "wrong", target: "responses" } });
    expect(session.snapshot.scene.quantity).toBe(5);
  });
});

describe("transcripts and stop requests", () => {
  it.each(["stop", "Please stop.", "I'm done!", "all done", "I want to go", "no more", "I don't want to play anymore", "Don't stop. Stop!"])("ends on %s", text => {
    const { session } = setup();
    session.receive(speech(text));
    expect(session.snapshot.reason).toBe("child_stop");
  });
  it.each(["don't stop", "do not stop", "not stop", "one, um, two", "three... no, two", "a dinosaur!"])("does not classify %s as stop", text => {
    expect(requestsStop(text)).toBe(false);
  });
  it("recognizes fragmented requests, keeps exact transcript and does not claim audio delivery", () => {
    const { session } = setup();
    session.receive(speech("I want to "));
    session.receive(speech("go", 500));
    expect(session.snapshot.reason).toBe("child_stop");
    expect(session.events.filter(e => e.type.startsWith("transcript.")).map(e => e.detail)).toEqual([
      expect.objectContaining({ delta: "I want to ", playbackVerified: false }),
      expect.objectContaining({ delta: "go", start_ms: 500 }),
    ]);
  });
  it("does not let a previous negated request mask a later stop", () => {
    const { session } = setup();
    session.receive(speech("don't stop"));
    session.receive(speech("stop", 5000));
    expect(session.snapshot.reason).toBe("child_stop");
  });
  it("does not auto-grade, advance, or fill a thinking pause", () => {
    const { session, transport } = setup();
    const count = vi.mocked(transport.send).mock.calls.length;
    session.receive(speech("um, I think"));
    vi.advanceTimersByTime(25_000);
    expect(session.snapshot.scene).toEqual(SCENES[0]);
    expect(transport.send).toHaveBeenCalledTimes(count);
  });
});
