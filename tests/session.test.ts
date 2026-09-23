import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseProviderEvent } from "../lib/events";
import { LessonSession, type Transport } from "../lib/session";
import { GOODBYE_PHRASE, LAST_SCENE, SCENES, TIMING, objectName, sceneAt, sceneContext } from "../lib/lesson";
import { TranscriptWindow, UTTERANCE_GAP_MS, WINDOW_CHARS, requestsStop, saidGoodbye } from "../lib/transcript";

function setup(active = true) {
  const transport: Transport = { start: vi.fn(async () => {}), send: vi.fn(), stopMedia: vi.fn(), close: vi.fn() };
  const session = new LessonSession(transport, vi.fn());
  void session.start();
  if (active) {
    deliver(session, { type: "session.started" });
    session.displayed(0);
  }
  return { session, transport };
}
/** Tests send provider-shaped JSON so the parser boundary is exercised too. */
function deliver(session: LessonSession, raw: unknown) {
  const event = parseProviderEvent(raw);
  if (event) session.receive(event);
  return event;
}
const advance = (id: string) => ({ type: "session.delegation.created", delegation: { id, target: "client" } });
const speech = (delta: string, start_ms = 0, output = false) => ({
  type: `session.${output ? "output" : "input"}_transcript.delta`,
  delta,
  start_ms,
  end_ms: start_ms + 500,
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("application lifecycle", () => {
  it("does not start the lesson clock or greet before session.started and display", () => {
    const { session, transport } = setup(false);
    vi.advanceTimersByTime(15_000);
    expect(transport.send).not.toHaveBeenCalled();
    deliver(session, { type: "session.started" });
    expect(transport.send).not.toHaveBeenCalled();
    session.displayed(0);
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
    deliver(session, advance("late"));
    expect(session.snapshot.sceneIndex).toBe(0);
    vi.advanceTimersByTime(TIMING.goodbye - TIMING.wrap);
    expect(session.snapshot.status).toBe("goodbye");
    deliver(session, speech(GOODBYE_PHRASE, 300_000, true));
    expect(session.snapshot.status).toBe("goodbye");
    vi.advanceTimersByTime(TIMING.finish - TIMING.goodbye);
    expect(session.snapshot.reason).toBe("wrap_up");
    expect(transport.stopMedia).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1500);
    expect(transport.close).toHaveBeenCalledOnce();
  });
  it("ends as model_goodbye when the model says goodbye before the app asks", () => {
    const { session } = setup();
    vi.advanceTimersByTime(TIMING.wrap);
    expect(session.snapshot.status).toBe("wrapping");
    deliver(session, speech(GOODBYE_PHRASE, 280_000, true));
    expect(session.snapshot.reason).toBe("model_goodbye");
  });
  it("hard-stops before applying a delayed event after six minutes", () => {
    const { session, transport } = setup();
    vi.setSystemTime(Date.now() + TIMING.hard);
    deliver(session, advance("too-late"));
    expect(session.snapshot.reason).toBe("time_limit");
    expect(session.snapshot.sceneIndex).toBe(0);
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
    deliver(session, advance("late"));
    deliver(session, speech("continue"));
    session.displayed(1);
    deliver(session, { type: "session.closed", reason: "close_requested", usage: { seconds: 2 } });
    session.end("parent_stop");
    vi.runAllTimers();
    expect(transport.close).toHaveBeenCalledOnce();
    expect(session.events.filter(e => e.type === "lesson.ended")).toHaveLength(1);
    expect(session.events.at(-1)?.type).toBe("connection.finalized");
  });
  it("releases immediately when the ending was not chosen by a healthy session", () => {
    const { session, transport } = setup();
    session.end("page_hidden");
    expect(transport.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "session.close" }));
    expect(transport.close).toHaveBeenCalledOnce();
  });
  it("stops while starting and ignores late session.started", () => {
    const { session, transport } = setup(false);
    session.end("parent_stop");
    deliver(session, { type: "session.started" });
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
    deliver(session, speech("one"));
    session.fail("Disconnected");
    expect(session.snapshot.error).toBe("Disconnected");
    expect(transport.close).toHaveBeenCalledOnce();
    const report = session.report("test-agent");
    expect(report.browser).toBe("test-agent");
    expect(report.events.some(e => e.type === "transcript.child_or_nearby_speaker")).toBe(true);
    expect(report.events.some(e => e.type === "scene.displayed")).toBe(true);
  });
  it("fails closed on rejected provider commands and unsolicited close", () => {
    const a = setup();
    deliver(a.session, { type: "error", error: { code: "not_allowed", message: "private detail" } });
    expect(a.session.snapshot.reason).toBe("connection_failure");
    expect(JSON.stringify(a.session.report("test"))).not.toContain("private detail");
    const b = setup();
    deliver(b.session, { type: "session.closed", reason: "connection_lost" });
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
    deliver(session, advance("a"));
    expect(session.snapshot.sceneIndex).toBe(1);
    expect(transport.send).not.toHaveBeenCalled();
    session.displayed(4);
    expect(transport.send).not.toHaveBeenCalled();
    session.displayed(1);
    expect(transport.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "session.thinking.append", delegation_id: "a" }),
    );
    deliver(session, advance("a"));
    expect(session.snapshot.sceneIndex).toBe(1);
  });
  it("rejects another request while a display is pending", () => {
    const { session } = setup();
    deliver(session, advance("a"));
    deliver(session, advance("b"));
    expect(session.snapshot.sceneIndex).toBe(1);
    expect(session.events.some(e => e.type === "action.rejected")).toBe(true);
  });
  it("cannot invent scenes, change quantity through arguments, or advance past five", () => {
    const { session } = setup();
    for (let i = 0; i < 20; i++) {
      deliver(session, { ...advance(`id-${i}`), arguments: { quantity: 100, jsx: "bad" } });
      session.displayed(session.snapshot.sceneIndex);
      expect(session.snapshot.sceneIndex).toBeLessThanOrEqual(LAST_SCENE);
    }
    expect(session.snapshot.sceneIndex).toBe(LAST_SCENE);
    expect(sceneAt(session.snapshot.sceneIndex).quantity).toBe(5);
    deliver(session, { type: "session.delegation.created", delegation: { id: "wrong", target: "responses" } });
    expect(session.snapshot.sceneIndex).toBe(LAST_SCENE);
  });
  it("keeps every scene within the 1-5 boundary and names objects correctly", () => {
    expect(SCENES.every(scene => Number.isInteger(scene.quantity) && scene.quantity >= 1 && scene.quantity <= 5)).toBe(
      true,
    );
    expect(objectName({ id: "x", object: "butterfly", quantity: 3 })).toBe("butterflies");
    expect(objectName({ id: "x", object: "strawberry", quantity: 3 })).toBe("strawberries");
    expect(objectName({ id: "x", object: "duck", quantity: 1 })).toBe("duck");
    expect(sceneContext({ id: "x", object: "butterfly", quantity: 3 })).toContain("exactly 3 butterflies");
  });
});

describe("transcripts and stop requests", () => {
  it.each([
    "stop",
    "Please stop.",
    "Stop, please",
    "Stop, I don't like this",
    "I'm done!",
    "all done",
    "I want to go",
    "no more",
    "I don't want to play anymore",
    "Don't stop. Stop!",
  ])("ends on %s", text => {
    const { session } = setup();
    deliver(session, speech(text));
    expect(session.snapshot.reason).toBe("child_stop");
  });
  it.each([
    "don't stop",
    "do not stop",
    "not stop",
    "Please don't stop",
    "No, I don't want to stop, keep going",
    "one, um, two",
    "three... no, two",
    "a dinosaur!",
  ])("does not classify %s as stop", text => {
    expect(requestsStop(text)).toBe(false);
  });
  it("recognizes fragmented requests, keeps exact transcript and does not claim audio delivery", () => {
    const { session } = setup();
    deliver(session, speech("I want to "));
    deliver(session, speech("go", 500));
    expect(session.snapshot.reason).toBe("child_stop");
    expect(session.events.filter(e => e.type.startsWith("transcript.")).map(e => e.detail)).toEqual([
      expect.objectContaining({ delta: "I want to ", playbackVerified: false }),
      expect.objectContaining({ delta: "go", start_ms: 500 }),
    ]);
  });
  it("does not let a previous negated request mask a later stop", () => {
    const { session } = setup();
    deliver(session, speech("don't stop"));
    deliver(session, speech("stop", 5000));
    expect(session.snapshot.reason).toBe("child_stop");
  });
  it("does not auto-grade, advance, or fill a thinking pause", () => {
    const { session, transport } = setup();
    const count = vi.mocked(transport.send).mock.calls.length;
    deliver(session, speech("um, I think"));
    vi.advanceTimersByTime(25_000);
    expect(session.snapshot.sceneIndex).toBe(0);
    expect(transport.send).toHaveBeenCalledTimes(count);
  });
});

describe("transcript window", () => {
  it("starts a new utterance after a silent gap and keeps one within it", () => {
    const window = new TranscriptWindow();
    expect(window.append("one ", 0, 500)).toBe("one ");
    expect(window.append("two", 1000, 1500)).toBe("one two");
    expect(window.append("three", 1500 + UTTERANCE_GAP_MS + 1, 9000)).toBe("three");
  });
  it("keeps only the most recent characters", () => {
    const window = new TranscriptWindow();
    const text = window.append("x".repeat(WINDOW_CHARS + 50) + "end", 0, 500);
    expect(text).toHaveLength(WINDOW_CHARS);
    expect(text.endsWith("end")).toBe(true);
  });
  it("recognizes the exact goodbye phrase the prompt asks for", () => {
    expect(saidGoodbye(`Okay. ${GOODBYE_PHRASE}`)).toBe(true);
    expect(saidGoodbye("Bye for now.")).toBe(true);
    expect(saidGoodbye("Bye for now! How many can you count?")).toBe(false);
  });
});

describe("provider event parsing", () => {
  it("drops malformed and unhandled events", () => {
    expect(parseProviderEvent(null)).toBeNull();
    expect(parseProviderEvent({ type: 7 })).toBeNull();
    expect(parseProviderEvent({ type: "session.pong" })).toBeNull();
    expect(parseProviderEvent({ type: "session.input_transcript.delta", delta: "hi" })).toBeNull();
  });
  it("keeps only the fields the app acts on", () => {
    expect(parseProviderEvent({ type: "error", error: { code: "not_allowed", message: "private detail" } })).toEqual({
      type: "provider.error",
      eventId: undefined,
      code: "not_allowed",
    });
    expect(parseProviderEvent({ ...advance("a"), arguments: { quantity: 100 } })).toEqual({
      type: "delegation",
      eventId: undefined,
      id: "a",
    });
    expect(
      parseProviderEvent({ type: "session.delegation.created", delegation: { id: "a", target: "responses" } })?.type,
    ).toBe("delegation.unsupported");
  });
});
