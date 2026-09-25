import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADVANCE_THRESHOLD,
  CORRECTION_WINDOW_MS,
  MICROPHONE_QUIET_MS,
  TRANSCRIPT_FALLBACK_MS as SETTLE_MS,
  TRANSCRIPT_TAIL_MS,
  shouldAdvance,
  type AnswerResult,
  type EvaluateAnswer,
} from "../lib/answer";
import { parseProviderEvent } from "../lib/events";
import { LessonSession, type Transport } from "../lib/session";
import {
  GOODBYE_PHRASE,
  INSTRUCTIONS,
  LAST_SCENE,
  PROMPT_VERSION,
  SCENES,
  TIMING,
  advanceContext,
  evaluationUnavailableContext,
  objectName,
  sceneAt,
  sceneContext,
  stayContext,
} from "../lib/lesson";
import {
  TranscriptWindow,
  UTTERANCE_GAP_MS,
  WINDOW_CHARS,
  mentionsNumber,
  requestsStop,
  saidGoodbye,
} from "../lib/transcript";

const evaluated = (probability: number): AnswerResult => ({
  status: "evaluated",
  probability,
  model: "jev-test",
  latencyMs: 12,
});
/** Answers every evaluation the same way, which is what most tests need. */
const answering = (probability: number): EvaluateAnswer => vi.fn(async () => evaluated(probability));
const CONFIDENT = ADVANCE_THRESHOLD;
const UNSURE = ADVANCE_THRESHOLD - 0.01;

function setup(active = true, evaluateAnswer: EvaluateAnswer = answering(UNSURE)) {
  const transport: Transport = { start: vi.fn(async () => {}), send: vi.fn(), stopMedia: vi.fn(), close: vi.fn() };
  const session = new LessonSession(transport, evaluateAnswer, vi.fn());
  void session.start();
  if (active) {
    deliver(session, { type: "session.started" });
    session.displayed(0);
  }
  return { session, transport, evaluateAnswer };
}
/** Lets the utterance settle and any resulting evaluation resolve. */
const settle = (extra = 0) => vi.advanceTimersByTimeAsync(SETTLE_MS + extra);
/** Tests send provider-shaped JSON so the parser boundary is exercised too. */
function deliver(session: LessonSession, raw: unknown) {
  const event = parseProviderEvent(raw);
  if (event) session.receive(event);
  return event;
}
const delegation = (id: string) => ({ type: "session.delegation.created", delegation: { id, target: "client" } });
const speech = (delta: string, start_ms = 0, output = false) => ({
  type: `session.${output ? "output" : "input"}_transcript.delta`,
  delta,
  start_ms,
  end_ms: start_ms + 500,
});
const mic = (session: LessonSession, type: "microphone.speech_started" | "microphone.speech_stopped") =>
  session.receive(type === "microphone.speech_stopped" ? { type, quietMs: MICROPHONE_QUIET_MS } : { type });
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
    deliver(session, delegation("late"));
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
    deliver(session, delegation("too-late"));
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
    deliver(session, delegation("late"));
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

describe("answer-gated scene advancement", () => {
  it("evaluates a complete short count from microphone turn end, once", async () => {
    const { session, evaluateAnswer } = setup(true, answering(CONFIDENT));
    mic(session, "microphone.speech_started");
    deliver(session, speech("One"));
    expect(evaluateAnswer).not.toHaveBeenCalled();
    mic(session, "microphone.speech_stopped");
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_MS);
    mic(session, "microphone.speech_stopped");
    expect(evaluateAnswer).toHaveBeenCalledOnce();
    expect(session.snapshot.sceneIndex).toBe(0);
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS - TRANSCRIPT_TAIL_MS);
    expect(session.snapshot.sceneIndex).toBe(1);
    expect(session.events.findLast(e => e.type === "advance.released")?.detail).toMatchObject({
      reason: "correction_window",
    });
    expect(session.events.findLast(e => e.type === "answer.requesting")?.detail).toMatchObject({
      signal: "microphone_vad",
    });
  });
  it("evaluates a transcript after the fallback even while VAD stays active", async () => {
    const { session, evaluateAnswer } = setup(true, answering(CONFIDENT));
    mic(session, "microphone.speech_started");
    deliver(session, speech("Two"));

    const scheduled = session.events.findLast(event => event.type === "answer.evaluation_scheduled");
    expect(scheduled?.detail).toMatchObject({ reason: "transcript_fallback", delay_ms: SETTLE_MS });
    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    expect(evaluateAnswer).toHaveBeenCalledOnce();
    expect(evaluateAnswer).toHaveBeenCalledWith({ sceneIndex: 0, utterance: "Two" }, expect.anything());
    expect(session.events.some(event => event.type === "answer.evaluation_proceeding_despite_vad")).toBe(true);
    expect(session.events.findLast(event => event.type === "answer.requesting")?.detail).toMatchObject({
      signal: "transcript_fallback",
    });

    // A later stop can reschedule the tail, but the evaluated transcript must
    // not produce a second Jev request.
    mic(session, "microphone.speech_stopped");
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_MS + CORRECTION_WINDOW_MS);
    expect(evaluateAnswer).toHaveBeenCalledOnce();
    expect(session.snapshot.sceneIndex).toBe(1);
  });
  it("accelerates a pending transcript fallback when clean VAD stop arrives", async () => {
    const { session, evaluateAnswer } = setup(true, answering(UNSURE));
    mic(session, "microphone.speech_started");
    deliver(session, speech("Two"));
    await vi.advanceTimersByTimeAsync(100);

    mic(session, "microphone.speech_stopped");
    const schedules = session.events.filter(event => event.type === "answer.evaluation_scheduled");
    expect(schedules).toHaveLength(2);
    expect(schedules[0]?.detail).toMatchObject({ reason: "transcript_fallback", delay_ms: SETTLE_MS });
    expect(schedules[1]?.detail).toMatchObject({
      reason: "microphone_vad",
      delay_ms: TRANSCRIPT_TAIL_MS,
      restarted_existing_timer: true,
    });

    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_MS);
    expect(evaluateAnswer).toHaveBeenCalledOnce();
    expect(evaluateAnswer).toHaveBeenCalledWith({ sceneIndex: 0, utterance: "Two" }, expect.anything());
  });
  it("takes a transcript tail and final self-correction before judging", async () => {
    const { session, evaluateAnswer } = setup(true, answering(UNSURE));
    mic(session, "microphone.speech_started");
    deliver(session, speech("Two... no,", 0));
    mic(session, "microphone.speech_stopped");
    deliver(session, speech(" one", 600));
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_MS);
    expect(evaluateAnswer).toHaveBeenCalledWith({ sceneIndex: 0, utterance: "Two... no, one" }, expect.anything());
  });
  it("uses the VAD tail for transcript fragments delayed beyond the tail window", async () => {
    const { session, evaluateAnswer } = setup(true, answering(CONFIDENT));
    mic(session, "microphone.speech_started");
    mic(session, "microphone.speech_stopped");
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_MS + 150);
    deliver(session, speech("One", 0));
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_MS - 50);
    deliver(session, speech(" duck", 500));
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_MS - 1);
    expect(evaluateAnswer).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(evaluateAnswer).toHaveBeenCalledOnce();
    expect(evaluateAnswer).toHaveBeenCalledWith({ sceneIndex: 0, utterance: "One duck" }, expect.anything());
    expect(session.events.findLast(e => e.type === "answer.requesting")?.detail).toMatchObject({
      signal: "microphone_vad",
    });
  });
  it("does not commit an incomplete slow phrase during a speech pause", async () => {
    const { session, evaluateAnswer } = setup(true, answering(CONFIDENT));
    mic(session, "microphone.speech_started");
    deliver(session, speech("There are"));
    mic(session, "microphone.speech_stopped");
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_MS);
    expect(evaluateAnswer).not.toHaveBeenCalled();
    mic(session, "microphone.speech_started");
    await vi.advanceTimersByTimeAsync(800);
    deliver(session, speech(" one duck", 800));
    mic(session, "microphone.speech_stopped");
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_MS);
    expect(evaluateAnswer).toHaveBeenCalledWith({ sceneIndex: 0, utterance: "There are one duck" }, expect.anything());
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS - TRANSCRIPT_TAIL_MS);
    expect(session.snapshot.sceneIndex).toBe(1);
  });
  it("does not commit a correct partial count before a later correction", async () => {
    const evaluateAnswer: EvaluateAnswer = vi.fn(async ({ utterance }) =>
      evaluated(utterance.includes("two") ? UNSURE : CONFIDENT),
    );
    const { session } = setup(true, evaluateAnswer);
    mic(session, "microphone.speech_started");
    deliver(session, speech("One"));
    mic(session, "microphone.speech_stopped");
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS - 1);
    expect(evaluateAnswer).toHaveBeenCalledWith({ sceneIndex: 0, utterance: "One" }, expect.anything());
    expect(session.snapshot.sceneIndex).toBe(0);

    mic(session, "microphone.speech_started");
    deliver(session, speech("... no, two", 2000));
    mic(session, "microphone.speech_stopped");
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_MS);
    expect(evaluateAnswer).toHaveBeenLastCalledWith({ sceneIndex: 0, utterance: "One... no, two" }, expect.anything());
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS);
    expect(session.snapshot.sceneIndex).toBe(0);
  });
  it("cancels an approved advance when a correction transcript arrives without VAD", async () => {
    const evaluateAnswer: EvaluateAnswer = vi.fn(async ({ utterance }) =>
      evaluated(utterance.includes("two") ? UNSURE : CONFIDENT),
    );
    const { session } = setup(true, evaluateAnswer);
    deliver(session, speech("One"));
    await settle();
    expect(session.snapshot.sceneIndex).toBe(0);
    deliver(session, speech("... no, two", 600));
    await settle();
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS);
    expect(evaluateAnswer).toHaveBeenCalledTimes(2);
    expect(session.snapshot.sceneIndex).toBe(0);
    expect(session.events.some(event => event.type === "advance.cancelled")).toBe(true);
  });
  it("does not delay an approved advance for a transcriptless microphone spike", async () => {
    const { session, evaluateAnswer } = setup(true, answering(CONFIDENT));
    mic(session, "microphone.speech_started");
    deliver(session, speech("One"));
    mic(session, "microphone.speech_stopped");
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_MS);
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS - TRANSCRIPT_TAIL_MS - 1);
    session.receive({ type: "microphone.activity_started" });
    await vi.advanceTimersByTimeAsync(1);
    expect(session.snapshot.sceneIndex).toBe(1);
    expect(session.events.filter(event => event.type === "advance.committed")).toHaveLength(1);
    session.receive({ type: "microphone.activity_discarded" });
    expect(evaluateAnswer).toHaveBeenCalledOnce();
    expect(session.events.some(event => event.type === "advance.cancelled")).toBe(false);
  });
  it("evaluates a transcript once despite repeated background VAD and advances once", async () => {
    const { session, evaluateAnswer } = setup(true, answering(CONFIDENT));
    mic(session, "microphone.speech_started");
    deliver(session, speech("One"));
    mic(session, "microphone.speech_stopped");
    await vi.advanceTimersByTimeAsync(100);

    session.receive({ type: "microphone.activity_started" });
    mic(session, "microphone.speech_started");
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_MS - 100);
    expect(evaluateAnswer).toHaveBeenCalledOnce();
    expect(evaluateAnswer).toHaveBeenCalledWith({ sceneIndex: 0, utterance: "One" }, expect.anything());
    expect(session.events.some(event => event.type === "answer.evaluation_proceeding_despite_vad")).toBe(true);

    for (let burst = 0; burst < 4; burst++) {
      mic(session, "microphone.speech_stopped");
      session.receive({ type: "microphone.activity_started" });
      mic(session, "microphone.speech_started");
      await vi.advanceTimersByTimeAsync(400);
    }
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS);
    expect(session.snapshot.sceneIndex).toBe(1);
    expect(session.events.filter(event => event.type === "advance.committed")).toHaveLength(1);
    expect(evaluateAnswer).toHaveBeenCalledOnce();
  });
  it("does not schedule the previous scene transcript after an advance", async () => {
    const { session, evaluateAnswer } = setup(true, answering(CONFIDENT));
    deliver(session, speech("One"));
    await settle();
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS);
    expect(session.snapshot.sceneIndex).toBe(1);

    session.displayed(1);
    session.receive({ type: "microphone.activity_started" });
    session.receive({ type: "microphone.activity_discarded" });
    await settle();
    expect(evaluateAnswer).toHaveBeenCalledOnce();
    expect(session.events.filter(event => event.type === "answer.candidate")).toHaveLength(1);
  });
  it("holds an in-flight Jev result through a microphone spike without losing the answer", async () => {
    let resolve!: (result: AnswerResult) => void;
    const evaluateAnswer: EvaluateAnswer = vi.fn(() => new Promise<AnswerResult>(r => (resolve = r)));
    const { session } = setup(true, evaluateAnswer);
    mic(session, "microphone.speech_started");
    deliver(session, speech("One"));
    mic(session, "microphone.speech_stopped");
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_MS);
    session.receive({ type: "microphone.activity_started" });
    resolve(evaluated(CONFIDENT));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.snapshot.sceneIndex).toBe(0);
    session.receive({ type: "microphone.activity_discarded" });
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(session.snapshot.sceneIndex).toBe(0);
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS - TRANSCRIPT_TAIL_MS - SETTLE_MS);
    expect(session.snapshot.sceneIndex).toBe(1);
    expect(evaluateAnswer).toHaveBeenCalledOnce();
  });
  it("resumes an approved answer after confirmed transcriptless microphone activity without asking for a repeat", async () => {
    const { session, transport } = setup(true, answering(CONFIDENT));
    mic(session, "microphone.speech_started");
    deliver(session, speech("One"));
    mic(session, "microphone.speech_stopped");
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_MS);
    session.receive({ type: "microphone.activity_started" });
    mic(session, "microphone.speech_started");
    mic(session, "microphone.speech_stopped");
    await vi.advanceTimersByTimeAsync(SETTLE_MS + CORRECTION_WINDOW_MS);
    expect(session.snapshot.sceneIndex).toBe(1);
    expect(session.events.some(event => event.type === "answer.no_transcript")).toBe(false);
    expect(vi.mocked(transport.send).mock.calls.map(([command]) => command)).not.toContainEqual(
      expect.objectContaining({ content: expect.stringContaining("say it again") }),
    );
  });
  it("does not ask for a repeat when the new transcript arrives during the grace period", async () => {
    const { session } = setup(true, answering(UNSURE));
    mic(session, "microphone.speech_started");
    deliver(session, speech("One"));
    mic(session, "microphone.speech_stopped");
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_MS);
    session.receive({ type: "microphone.activity_started" });
    mic(session, "microphone.speech_started");
    mic(session, "microphone.speech_stopped");
    await vi.advanceTimersByTimeAsync(500);
    deliver(session, speech("... no, two", 2000));
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(session.events.some(event => event.type === "answer.no_transcript")).toBe(false);
  });
  it("judges a correction that arrives during provisional microphone activity", async () => {
    const evaluateAnswer: EvaluateAnswer = vi.fn(async ({ utterance }) =>
      evaluated(utterance.includes("two") ? UNSURE : CONFIDENT),
    );
    const { session } = setup(true, evaluateAnswer);
    mic(session, "microphone.speech_started");
    deliver(session, speech("One"));
    mic(session, "microphone.speech_stopped");
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_MS);
    session.receive({ type: "microphone.activity_started" });
    deliver(session, speech("... no, two", 2000));
    mic(session, "microphone.speech_started");
    mic(session, "microphone.speech_stopped");
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_MS + CORRECTION_WINDOW_MS);
    expect(evaluateAnswer).toHaveBeenLastCalledWith({ sceneIndex: 0, utterance: "One... no, two" }, expect.anything());
    expect(session.snapshot.sceneIndex).toBe(0);
  });
  it("uses transcript fallback when a brief correction never confirms microphone onset", async () => {
    const evaluateAnswer: EvaluateAnswer = vi.fn(async ({ utterance }) =>
      evaluated(utterance.includes("two") ? UNSURE : CONFIDENT),
    );
    const { session } = setup(true, evaluateAnswer);
    mic(session, "microphone.speech_started");
    deliver(session, speech("One"));
    mic(session, "microphone.speech_stopped");
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_MS);
    session.receive({ type: "microphone.activity_started" });
    deliver(session, speech("... no, two", 2000));
    session.receive({ type: "microphone.activity_discarded" });
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(evaluateAnswer).toHaveBeenLastCalledWith({ sceneIndex: 0, utterance: "One... no, two" }, expect.anything());
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS);
    expect(session.snapshot.sceneIndex).toBe(0);
  });
  it("preserves an in-flight approval through confirmed microphone activity without a new transcript", async () => {
    let resolve!: (result: AnswerResult) => void;
    const evaluateAnswer: EvaluateAnswer = vi.fn(() => new Promise<AnswerResult>(r => (resolve = r)));
    const { session, transport } = setup(true, evaluateAnswer);
    mic(session, "microphone.speech_started");
    deliver(session, speech("One"));
    mic(session, "microphone.speech_stopped");
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_MS);
    mic(session, "microphone.speech_started");
    expect(evaluateAnswer).toHaveBeenCalledOnce();
    resolve(evaluated(CONFIDENT));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.snapshot.sceneIndex).toBe(0);
    mic(session, "microphone.speech_stopped");
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);
    expect(session.snapshot.sceneIndex).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(session.snapshot.sceneIndex).toBe(0);
    expect(session.events.findLast(e => e.type === "answer.evaluated")?.detail).toMatchObject({
      decision: "ADVANCE",
      stale: false,
    });
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS);
    expect(session.snapshot.sceneIndex).toBe(1);
    expect(evaluateAnswer).toHaveBeenCalledOnce();
    expect(session.events.filter(e => e.type === "advance.committed")).toHaveLength(1);
    expect(session.events.some(e => e.type === "answer.no_transcript")).toBe(false);
    expect(vi.mocked(transport.send).mock.calls.map(([command]) => command)).not.toContainEqual(
      expect.objectContaining({ content: expect.stringContaining("say it again") }),
    );
  });
  it("invalidates an approved answer when a correction transcript arrives during microphone activity", async () => {
    const evaluateAnswer: EvaluateAnswer = vi.fn(async ({ utterance }) =>
      evaluated(utterance.includes("two") ? UNSURE : CONFIDENT),
    );
    const { session } = setup(true, evaluateAnswer);
    deliver(session, speech("One"));
    await settle();
    expect(session.events.findLast(e => e.type === "answer.evaluated")?.detail).toMatchObject({ decision: "ADVANCE" });

    mic(session, "microphone.speech_started");
    deliver(session, speech("... no, two", 600));
    expect(session.events.some(e => e.type === "advance.cancelled")).toBe(true);
    mic(session, "microphone.speech_stopped");
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_MS + CORRECTION_WINDOW_MS);

    expect(evaluateAnswer).toHaveBeenCalledTimes(2);
    expect(evaluateAnswer).toHaveBeenLastCalledWith({ sceneIndex: 0, utterance: "One... no, two" }, expect.anything());
    expect(session.snapshot.sceneIndex).toBe(0);
    expect(session.events.filter(e => e.type === "advance.committed")).toHaveLength(0);
  });
  it("stopping the lesson aborts a pending turn-end evaluation", async () => {
    let signal!: AbortSignal;
    let resolve!: (result: AnswerResult) => void;
    const { session } = setup(true, (_request, pendingSignal) => {
      signal = pendingSignal;
      return new Promise(r => (resolve = r));
    });
    mic(session, "microphone.speech_started");
    deliver(session, speech("One"));
    mic(session, "microphone.speech_stopped");
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_MS);
    session.end("parent_stop");
    expect(signal.aborted).toBe(true);
    resolve(evaluated(CONFIDENT));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.snapshot.sceneIndex).toBe(0);
  });
  it("does not call Jev for a non-count or uncertain statement without a number", async () => {
    const { session, evaluateAnswer } = setup();
    for (const word of ["Yeah", "I don't know"]) {
      mic(session, "microphone.speech_started");
      deliver(session, speech(word, word === "Yeah" ? 0 : 3000));
      mic(session, "microphone.speech_stopped");
      await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_MS);
    }
    expect(evaluateAnswer).not.toHaveBeenCalled();
  });
  it("treats only a confident answer as a reason to advance", () => {
    expect(shouldAdvance(evaluated(ADVANCE_THRESHOLD))).toBe(true);
    expect(shouldAdvance(evaluated(ADVANCE_THRESHOLD - 0.001))).toBe(false);
    expect(shouldAdvance({ status: "unavailable", reason: "request_failed", latencyMs: 3000 })).toBe(false);
  });
  it("waits for the utterance to settle, evaluates it once, then advances", async () => {
    const { session, evaluateAnswer } = setup(true, answering(CONFIDENT));
    deliver(session, speech("One!"));
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);
    expect(evaluateAnswer).not.toHaveBeenCalled();
    expect(session.snapshot.sceneIndex).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(evaluateAnswer).toHaveBeenCalledOnce();
    expect(evaluateAnswer).toHaveBeenCalledWith({ sceneIndex: 0, utterance: "One!" }, expect.anything());
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS);
    expect(session.snapshot.sceneIndex).toBe(1);
  });
  it("evaluates the whole utterance rather than each fragment", async () => {
    const { session, evaluateAnswer } = setup(true, answering(CONFIDENT));
    deliver(session, speech("One, "));
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 500);
    deliver(session, speech("two!", 600));
    await settle();
    expect(evaluateAnswer).toHaveBeenCalledOnce();
    expect(evaluateAnswer).toHaveBeenCalledWith({ sceneIndex: 0, utterance: "One, two!" }, expect.anything());
  });
  it("does not re-evaluate an unchanged utterance but does judge a revision", async () => {
    const { session, evaluateAnswer } = setup(true, answering(UNSURE));
    deliver(session, speech("Two?"));
    await settle();
    await settle();
    expect(evaluateAnswer).toHaveBeenCalledOnce();
    deliver(session, speech(" No, wait. One!", 600));
    await settle();
    expect(evaluateAnswer).toHaveBeenLastCalledWith(
      { sceneIndex: 0, utterance: "Two? No, wait. One!" },
      expect.anything(),
    );
  });
  it("leaves the scene alone when the answer is uncertain or the evaluation fails", async () => {
    const { session } = setup(true, answering(UNSURE));
    deliver(session, speech("Five!"));
    await settle();
    expect(session.snapshot.sceneIndex).toBe(0);

    const failing: EvaluateAnswer = async () => ({ status: "unavailable", reason: "request_failed", latencyMs: 3000 });
    const offline = setup(true, failing);
    deliver(offline.session, speech("One!"));
    await settle();
    expect(offline.session.snapshot.sceneIndex).toBe(0);
    expect(offline.session.snapshot.status).toBe("active");
  });
  it("discards an answer the child has already spoken over", async () => {
    let answer!: (result: AnswerResult) => void;
    const pending: EvaluateAnswer = () => new Promise<AnswerResult>(resolve => (answer = resolve));
    const { session } = setup(true, pending);
    deliver(session, speech("One!"));
    await settle();
    deliver(session, speech(" No, three!", 600));
    answer(evaluated(0.99));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.snapshot.sceneIndex).toBe(0);
    expect(session.events.at(-1)).toMatchObject({ type: "answer.evaluated", detail: { stale: true } });
  });
  it("discards an answer about a scene that has already been replaced", async () => {
    const answers: ((result: AnswerResult) => void)[] = [];
    const pending: EvaluateAnswer = () => new Promise<AnswerResult>(resolve => answers.push(resolve));
    const { session } = setup(true, pending);
    deliver(session, speech("One!"));
    await settle();
    deliver(session, speech("One duck!", 10_000));
    await settle();
    answers[1](evaluated(0.99));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS);
    session.displayed(1);
    expect(session.snapshot.sceneIndex).toBe(1);
    answers[0](evaluated(0.99));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.snapshot.sceneIndex).toBe(1);
  });
  it("does not evaluate while a scene is waiting to be displayed", async () => {
    const { session, evaluateAnswer } = setup(true, answering(CONFIDENT));
    deliver(session, speech("One!"));
    await settle();
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS);
    expect(session.snapshot.sceneIndex).toBe(1);
    deliver(session, speech("Two!", 10_000));
    await settle();
    expect(evaluateAnswer).toHaveBeenCalledOnce();
  });
  it("does not evaluate once the lesson is wrapping up or over", async () => {
    const { session, evaluateAnswer } = setup(true, answering(CONFIDENT));
    vi.advanceTimersByTime(TIMING.wrap);
    deliver(session, speech("One!", 270_000));
    await settle();
    expect(evaluateAnswer).not.toHaveBeenCalled();
    expect(session.snapshot.sceneIndex).toBe(0);
  });
  it("prefers a stop request over evaluating it as an answer", async () => {
    const { session, evaluateAnswer } = setup(true, answering(CONFIDENT));
    deliver(session, speech("I am all done."));
    await settle();
    expect(session.snapshot.reason).toBe("child_stop");
    expect(evaluateAnswer).not.toHaveBeenCalled();
  });
  it("tells GPT-Live about the new scene only after the app has displayed it", async () => {
    const { session, transport } = setup(true, answering(CONFIDENT));
    vi.mocked(transport.send).mockClear();
    deliver(session, speech("One!"));
    await settle();
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS);
    expect(session.snapshot.sceneIndex).toBe(1);
    expect(transport.send).not.toHaveBeenCalled();
    session.displayed(4);
    expect(transport.send).not.toHaveBeenCalled();
    session.displayed(1);
    expect(transport.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "session.instructions.append", delegation_id: null }),
    );
    expect(vi.mocked(transport.send).mock.calls[0][0]).toMatchObject({ content: expect.stringContaining("2 ducks") });
  });
  it("cannot advance past the last scene however confident the answers are", async () => {
    const { session, evaluateAnswer } = setup(true, answering(1));
    for (let i = 0; i < 20; i++) {
      deliver(session, speech(`Answer ${i}`, i * 10_000));
      await settle();
      await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS);
      session.displayed(session.snapshot.sceneIndex);
      expect(session.snapshot.sceneIndex).toBeLessThanOrEqual(LAST_SCENE);
    }
    expect(session.snapshot.sceneIndex).toBe(LAST_SCENE);
    expect(sceneAt(session.snapshot.sceneIndex).quantity).toBe(5);
    // On the last scene there is nothing to decide, so nothing is asked.
    expect(vi.mocked(evaluateAnswer).mock.calls).toHaveLength(LAST_SCENE);
  });
  it("refuses model delegation without changing the scene", () => {
    const { session, transport } = setup();
    vi.mocked(transport.send).mockClear();
    deliver(session, delegation("a"));
    deliver(session, delegation("a"));
    expect(session.snapshot.sceneIndex).toBe(0);
    expect(transport.send).toHaveBeenCalledOnce();
    expect(transport.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "session.thinking.append", delegation_id: "a" }),
    );
    expect(session.events.some(e => e.type === "action.rejected")).toBe(true);
    deliver(session, { type: "session.delegation.created", delegation: { id: "wrong", target: "responses" } });
    expect(session.snapshot.sceneIndex).toBe(0);
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

describe("answer-check turn synchronization", () => {
  const sent = (transport: Transport) => vi.mocked(transport.send).mock.calls.map(([command]) => command);
  const released = (transport: Transport) =>
    sent(transport).filter(command => "content" in command && command.content.includes("has not changed"));

  it("keeps a wrong partial count private until the child finishes correcting it", async () => {
    const evaluateAnswer: EvaluateAnswer = vi.fn(async ({ sceneIndex, utterance }) =>
      evaluated(sceneIndex === 0 || utterance.includes("two") ? CONFIDENT : UNSURE),
    );
    const { session, transport } = setup(true, evaluateAnswer);
    deliver(session, speech("One!"));
    await settle();
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS);
    session.displayed(1);
    vi.mocked(transport.send).mockClear();

    mic(session, "microphone.speech_started");
    deliver(session, speech("One", 10_000));
    mic(session, "microphone.speech_stopped");
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_MS);
    expect(session.events.findLast(event => event.type === "answer.evaluated")?.detail).toMatchObject({
      decision: "STAY",
    });
    expect(sent(transport)).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1000);
    mic(session, "microphone.speech_started");
    deliver(session, speech("... two", 11_000));
    mic(session, "microphone.speech_stopped");
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_TAIL_MS + CORRECTION_WINDOW_MS);
    expect(evaluateAnswer).toHaveBeenLastCalledWith({ sceneIndex: 1, utterance: "One... two" }, expect.anything());
    expect(session.snapshot.sceneIndex).toBe(2);
    expect(released(transport)).toHaveLength(0);
    expect(sent(transport)).toHaveLength(0);
  });

  it("restarts the STAY hold for a revised count and releases only the final version", async () => {
    const { session, transport, evaluateAnswer } = setup(true, answering(UNSURE));
    vi.mocked(transport.send).mockClear();
    deliver(session, speech("Five"));
    await settle();
    deliver(session, speech("... no, four", 600));
    await settle();
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS - 1);
    expect(released(transport)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(evaluateAnswer).toHaveBeenCalledTimes(2);
    expect(released(transport)).toHaveLength(1);
    expect(session.events.filter(event => event.type === "answer.release_cancelled")).toHaveLength(1);
  });

  it.each(["Ooh!", "Okay!"])("releases a delayed STAY after neutral acknowledgment %s", async reply => {
    const { session, transport } = setup(true, answering(UNSURE));
    vi.mocked(transport.send).mockClear();
    deliver(session, speech("Five"));
    await settle();
    deliver(session, speech(reply, 800, true));
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS - 1);
    expect(released(transport)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(released(transport)).toHaveLength(1);
  });

  it.each([
    ["STAY", answering(UNSURE)],
    ["unavailable", async () => ({ status: "unavailable" as const, reason: "timeout", latencyMs: 4000 })],
  ])("drops a delayed %s instruction after a short substantive reply", async (_decision, evaluateAnswer) => {
    const { session, transport } = setup(true, evaluateAnswer);
    vi.mocked(transport.send).mockClear();
    deliver(session, speech("Five"));
    await settle();
    expect(sent(transport)).toHaveLength(0);
    deliver(session, speech("Let's count together.", 800, true));
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS);
    expect(sent(transport)).toHaveLength(0);
  });

  it("drops a delayed STAY instruction if Sprout has already begun helping", async () => {
    const { session, transport } = setup(true, answering(UNSURE));
    vi.mocked(transport.send).mockClear();
    deliver(session, speech("Five"));
    await settle();
    deliver(session, speech("Let's count these ducks together.", 800, true));
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS);
    expect(released(transport)).toHaveLength(0);
  });

  it("does not delay a pending STAY for a transcriptless microphone spike", async () => {
    const { session, transport } = setup(true, answering(UNSURE));
    vi.mocked(transport.send).mockClear();
    mic(session, "microphone.speech_started");
    deliver(session, speech("Five"));
    mic(session, "microphone.speech_stopped");
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS - 1);
    session.receive({ type: "microphone.activity_started" });
    await vi.advanceTimersByTimeAsync(1);
    expect(released(transport)).toHaveLength(1);
    session.receive({ type: "microphone.activity_discarded" });
    expect(released(transport)).toHaveLength(1);
  });

  it("cancels an approved ADVANCE when a late correction transcript arrives during VAD grace", async () => {
    const { session, transport, evaluateAnswer } = setup(true, answering(CONFIDENT));
    vi.mocked(transport.send).mockClear();
    deliver(session, speech("One"));
    await settle();
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS - 200);
    mic(session, "microphone.speech_started");
    expect(session.events.filter(event => event.type === "answer.vad_grace_started")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(500);
    deliver(session, speech("... no, two", 600));
    expect(session.events.filter(event => event.type === "advance.cancelled")).toHaveLength(1);
    await settle();
    expect(evaluateAnswer).toHaveBeenCalledTimes(2);
    expect(evaluateAnswer).toHaveBeenLastCalledWith({ sceneIndex: 0, utterance: "One... no, two" }, expect.anything());
    expect(session.snapshot.sceneIndex).toBe(0);
    expect(session.events.filter(event => event.type === "advance.committed")).toHaveLength(0);
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("does not let early no-op VAD consume grace needed by a later correction", async () => {
    const { session, transport, evaluateAnswer } = setup(true, answering(CONFIDENT));
    vi.mocked(transport.send).mockClear();
    deliver(session, speech("One"));
    await settle();

    mic(session, "microphone.speech_started");
    mic(session, "microphone.speech_stopped");
    expect(session.events.filter(event => event.type === "answer.vad_grace_started")).toHaveLength(0);
    expect(session.events.findLast(event => event.type === "answer.vad_grace_ignored")?.detail).toMatchObject({
      reason: "too_early",
    });

    const earlyIgnore = session.events.findLast(event => event.type === "answer.vad_grace_ignored");
    const normalReleaseAt =
      session.createdAt + (earlyIgnore?.detail as { normal_release_at_ms: number }).normal_release_at_ms;
    await vi.advanceTimersByTimeAsync(normalReleaseAt - Date.now() - 100);
    mic(session, "microphone.speech_started");
    expect(session.events.filter(event => event.type === "answer.vad_grace_started")).toHaveLength(1);
    expect(session.events.findLast(event => event.type === "answer.vad_grace_started")?.detail).toMatchObject({
      decision: "ADVANCE",
    });

    await vi.advanceTimersByTimeAsync(500);
    deliver(session, speech("... no, two", 600));
    expect(session.events.filter(event => event.type === "advance.cancelled")).toHaveLength(1);
    await settle();
    expect(evaluateAnswer).toHaveBeenCalledTimes(2);
    expect(evaluateAnswer).toHaveBeenLastCalledWith({ sceneIndex: 0, utterance: "One... no, two" }, expect.anything());
    expect(session.snapshot.sceneIndex).toBe(0);
    expect(session.events.filter(event => event.type === "advance.committed")).toHaveLength(0);
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("bounds ADVANCE grace at the first confirmed speech event despite repeated VAD bursts", async () => {
    const { session } = setup(true, answering(CONFIDENT));
    deliver(session, speech("One"));
    await settle();
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS - 200);
    mic(session, "microphone.speech_started");
    const graceStarted = session.events.findLast(event => event.type === "answer.vad_grace_started");
    expect(graceStarted).toBeDefined();
    const releaseAt = (graceStarted?.detail as { release_at_ms: number }).release_at_ms;
    await vi.advanceTimersByTimeAsync(400);
    mic(session, "microphone.speech_stopped");
    mic(session, "microphone.speech_started");
    mic(session, "microphone.speech_stopped");
    mic(session, "microphone.speech_started");
    expect(session.events.filter(event => event.type === "answer.vad_grace_started")).toHaveLength(1);
    expect(session.events.filter(event => event.type === "answer.vad_grace_ignored")).toHaveLength(2);
    expect((graceStarted?.detail as { release_at_ms: number }).release_at_ms).toBe(releaseAt);
    await vi.advanceTimersByTimeAsync(releaseAt - (Date.now() - session.createdAt) - 1);
    expect(session.snapshot.sceneIndex).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(session.snapshot.sceneIndex).toBe(1);
    expect(session.events.filter(event => event.type === "advance.committed")).toHaveLength(1);
    expect(session.events.filter(event => event.type === "answer.vad_grace_expired")).toHaveLength(1);
  });

  it("gives deferred STAY the same bounded grace and cancels it for a late correction", async () => {
    const { session, transport, evaluateAnswer } = setup(true, answering(UNSURE));
    vi.mocked(transport.send).mockClear();
    deliver(session, speech("Five"));
    await settle();
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS - 200);
    mic(session, "microphone.speech_started");
    await vi.advanceTimersByTimeAsync(500);
    deliver(session, speech("... no, one", 600));
    expect(session.events.filter(event => event.type === "answer.release_cancelled")).toHaveLength(1);
    await settle();
    expect(evaluateAnswer).toHaveBeenCalledTimes(2);
    expect(session.snapshot.sceneIndex).toBe(0);
    expect(released(transport)).toHaveLength(0);
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("releases deferred STAY after grace expires without a transcript", async () => {
    const { session, transport } = setup(true, answering(UNSURE));
    vi.mocked(transport.send).mockClear();
    deliver(session, speech("Five"));
    await settle();
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS - 200);
    mic(session, "microphone.speech_started");
    const graceStarted = session.events.findLast(event => event.type === "answer.vad_grace_started");
    const releaseAt = (graceStarted?.detail as { release_at_ms: number }).release_at_ms;
    mic(session, "microphone.speech_stopped");
    mic(session, "microphone.speech_started");
    expect(released(transport)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(releaseAt - (Date.now() - session.createdAt));
    expect(released(transport)).toHaveLength(1);
    expect(session.events.filter(event => event.type === "answer.vad_grace_expired")).toHaveLength(1);
  });

  it.each(["", "Oh!", "Ooh!", "Okay!"])(
    "advances after the correction window with silence or neutral acknowledgment %s",
    async reply => {
      const { session, transport } = setup(true, answering(CONFIDENT));
      vi.mocked(transport.send).mockClear();
      deliver(session, speech("One!"));
      if (reply) deliver(session, speech(reply, 800, true));
      await settle();
      expect(session.snapshot.sceneIndex).toBe(0);
      await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS);
      expect(session.snapshot.sceneIndex).toBe(1);
      expect(transport.send).not.toHaveBeenCalled();
      session.displayed(1);
      expect(sent(transport)).toEqual([expect.objectContaining({ content: advanceContext(sceneAt(1)) })]);
    },
  );

  it("holds an approved advance until the output transcript goes quiet, without evaluating again", async () => {
    const { session, transport, evaluateAnswer } = setup(true, answering(CONFIDENT));
    vi.mocked(transport.send).mockClear();
    deliver(session, speech("One!"));
    deliver(session, speech("Let's count this duck together", 800, true));
    await settle();
    expect(session.snapshot.sceneIndex).toBe(0);
    expect(transport.send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    deliver(session, speech(". There is one duck.", 1800, true));
    await vi.advanceTimersByTimeAsync(UTTERANCE_GAP_MS - 1);
    expect(session.snapshot.sceneIndex).toBe(0);
    expect(evaluateAnswer).toHaveBeenCalledOnce();
    expect(released(transport)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(session.snapshot.sceneIndex).toBe(1);
    expect(transport.send).not.toHaveBeenCalled();
    session.displayed(1);
    session.displayed(1);
    expect(sent(transport)).toEqual([expect.objectContaining({ content: advanceContext(sceneAt(1)) })]);
    expect(session.events.filter(event => event.type === "advance.deferred")).toHaveLength(1);
    expect(session.events.filter(event => event.type === "advance.released")).toHaveLength(1);
    expect(session.events.findLast(event => event.type === "advance.released")?.detail).toMatchObject({
      reason: "output_transcript_quiet",
    });
  });

  it.each(["child_stop", "parent_stop", "wrapping", "goodbye", "time_limit"])(
    "cancels a deferred advance on %s",
    async ending => {
      const { session, transport } = setup(true, answering(CONFIDENT));
      vi.mocked(transport.send).mockClear();
      deliver(session, speech("One!"));
      deliver(session, speech("Let us count slowly.", 800, true));
      await settle();
      if (ending === "child_stop") deliver(session, speech("I want to stop", 10_000));
      if (ending === "parent_stop") session.end("parent_stop");
      if (ending === "wrapping") (session as unknown as { wrap: () => void }).wrap();
      if (ending === "goodbye") (session as unknown as { goodbye: () => void }).goodbye();
      if (ending === "time_limit") {
        vi.setSystemTime(Date.now() + TIMING.hard);
        deliver(session, { type: "session.usage.updated", usage: {} });
      }
      await vi.advanceTimersByTimeAsync(UTTERANCE_GAP_MS + 1);
      expect(session.snapshot.sceneIndex).toBe(0);
      expect(session.events.filter(event => event.type === "advance.released")).toHaveLength(0);
      expect(
        sent(transport).filter(command => "content" in command && command.content === advanceContext(sceneAt(1))),
      ).toHaveLength(0);
    },
  );

  it("ignores stale decisions and stays while an approved advance is deferred", async () => {
    const answers: ((result: AnswerResult) => void)[] = [];
    const pending: EvaluateAnswer = vi.fn(() => new Promise<AnswerResult>(resolve => answers.push(resolve)));
    const { session, transport, evaluateAnswer } = setup(true, pending);
    vi.mocked(transport.send).mockClear();
    deliver(session, speech("One!"));
    await settle();
    deliver(session, speech(" One duck!", 600));
    await settle();
    deliver(session, speech("Let us count the duck together.", 1200, true));
    answers[1](evaluated(CONFIDENT));
    await vi.advanceTimersByTimeAsync(0);
    answers[0](evaluated(UNSURE));
    await vi.advanceTimersByTimeAsync(0);
    expect(evaluateAnswer).toHaveBeenCalledTimes(2);
    expect(released(transport)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(UTTERANCE_GAP_MS);
    expect(session.snapshot.sceneIndex).toBe(1);
    session.displayed(1);
    expect(
      sent(transport).filter(command => "content" in command && command.content === advanceContext(sceneAt(1))),
    ).toHaveLength(1);
  });

  it("asks GPT-Live to pause after a count until the app reports the scene decision", () => {
    expect(INSTRUCTIONS).toContain("when the child says a number or counts aloud, the app checks the count");
    expect(INSTRUCTIONS).toContain(
      "Do not praise, correct, recount, count together, offer help, or ask another question until the app tells you either that the screen changed or that it has not changed.",
    );
    // Only counts pause; everything else is answered straight away.
    expect(INSTRUCTIONS).toContain("The pause is only for counts: reply straight away to everything else");
    // The old contract made GPT-Live reply to every answer at once.
    expect(INSTRUCTIONS).not.toContain("after the child answers, always reply");
    expect(PROMPT_VERSION).toBe("counting-jev-3");
  });
  it("sends nothing while the utterance settles or Jev is deciding", async () => {
    let answer!: (result: AnswerResult) => void;
    const pending: EvaluateAnswer = () => new Promise<AnswerResult>(resolve => (answer = resolve));
    const { session, transport } = setup(true, pending);
    vi.mocked(transport.send).mockClear();
    deliver(session, speech("Five!"));
    await settle(5000);
    expect(transport.send).not.toHaveBeenCalled();
    answer(evaluated(0.02));
    await vi.advanceTimersByTimeAsync(0);
    expect(released(transport)).toHaveLength(1);
  });
  it("on a confident answer displays the new scene before new-scene instructions and sends no release", async () => {
    const { session, transport } = setup(true, answering(CONFIDENT));
    vi.mocked(transport.send).mockClear();
    deliver(session, speech("One!"));
    await settle();
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS);
    expect(session.snapshot.sceneIndex).toBe(1);
    expect(transport.send).not.toHaveBeenCalled();
    session.displayed(1);
    expect(sent(transport)).toEqual([
      expect.objectContaining({ type: "session.instructions.append", content: advanceContext(sceneAt(1)) }),
    ]);
    expect(released(transport)).toHaveLength(0);
  });
  it("explicitly releases GPT-Live on the current scene when the answer does not advance", async () => {
    const { session, transport } = setup(true, answering(UNSURE));
    vi.mocked(transport.send).mockClear();
    deliver(session, speech("Five!"));
    await settle();
    expect(session.snapshot.sceneIndex).toBe(0);
    expect(sent(transport)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS);
    expect(sent(transport)).toEqual([
      expect.objectContaining({
        type: "session.instructions.append",
        delegation_id: null,
        content: stayContext(sceneAt(0)),
      }),
    ]);
    expect(stayContext(sceneAt(0))).toContain("still shows 1 duck");
    expect(session.events.findLast(e => e.type === "answer.evaluated")).toMatchObject({
      detail: { advancing: false, releasing: true },
    });
  });
  it.each(["timeout", "request_failed", "http_502", "unreadable_answer"])(
    "releases GPT-Live when the evaluation is unavailable (%s) rather than leaving it waiting",
    async reason => {
      const latencyMs = reason === "timeout" ? 4000 : 3000;
      const failing: EvaluateAnswer = async () => ({ status: "unavailable", reason, latencyMs });
      const { session, transport } = setup(true, failing);
      vi.mocked(transport.send).mockClear();
      deliver(session, speech("One!"));
      await settle();
      expect(session.snapshot).toMatchObject({ sceneIndex: 0, status: "active" });
      expect(sent(transport)).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS);
      expect(sent(transport)).toEqual([
        expect.objectContaining({
          type: "session.instructions.append",
          content: evaluationUnavailableContext(sceneAt(0)),
        }),
      ]);
      expect(released(transport)).toHaveLength(1);
      expect(released(transport)[0]).toMatchObject({ content: expect.stringContaining("could not verify") });
      expect(released(transport)[0]).not.toMatchObject({ content: stayContext(sceneAt(0)) });
      expect(session.events.findLast(e => e.type === "answer.evaluated")).toMatchObject({
        detail: { unavailable: reason, latency_ms: latencyMs, stale: false, advancing: false, releasing: true },
      });
    },
  );
  it("releases each held count once, including a revision", async () => {
    const { session, transport } = setup(true, answering(UNSURE));
    vi.mocked(transport.send).mockClear();
    deliver(session, speech("Five!"));
    await settle();
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS);
    expect(released(transport)).toHaveLength(1);
    deliver(session, speech(" No, four!", 600));
    await settle();
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS);
    expect(released(transport)).toHaveLength(2);
  });
  it("does not release speech GPT-Live was never asked to pause for", async () => {
    const { session, transport } = setup(true, answering(UNSURE));
    vi.mocked(transport.send).mockClear();
    deliver(session, speech("I have a dinosaur! His name is Rex!"));
    await settle();
    deliver(session, speech("Umm... I don't know.", 10_000));
    await settle();
    expect(transport.send).not.toHaveBeenCalled();
  });
  it("does not talk over a reply GPT-Live has already started", async () => {
    const { session, transport } = setup(true, answering(UNSURE));
    vi.mocked(transport.send).mockClear();
    deliver(session, speech("Five!"));
    deliver(session, speech("Hmm, let's count together slowly.", 800, true));
    await settle();
    expect(transport.send).not.toHaveBeenCalled();
    // A brief acknowledgment is still a held turn.
    deliver(session, speech("Three!", 10_000));
    deliver(session, speech("Ooh!", 10_800, true));
    await settle();
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS);
    expect(released(transport)).toHaveLength(1);
  });
  it("does not release a stale result; the newer speech gets its own decision", async () => {
    const answers: ((result: AnswerResult) => void)[] = [];
    const pending: EvaluateAnswer = () => new Promise<AnswerResult>(resolve => answers.push(resolve));
    const { session, transport } = setup(true, pending);
    vi.mocked(transport.send).mockClear();
    deliver(session, speech("Five!"));
    await settle();
    deliver(session, speech(" No, three!", 600));
    answers[0]({ status: "unavailable", reason: "timeout", latencyMs: 4000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.send).not.toHaveBeenCalled();
    await settle();
    answers[1](evaluated(0.02));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(CORRECTION_WINDOW_MS);
    expect(released(transport)).toHaveLength(1);
  });
  it("sends no release after a stop request, wrap-up, or the end of the lesson", async () => {
    let answer!: (result: AnswerResult) => void;
    const pending: EvaluateAnswer = () => new Promise<AnswerResult>(resolve => (answer = resolve));
    const { session, transport } = setup(true, pending);
    vi.mocked(transport.send).mockClear();
    deliver(session, speech("Five!", 260_000));
    await settle();
    vi.advanceTimersByTime(TIMING.wrap);
    answer({ status: "unavailable", reason: "timeout", latencyMs: 4000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(released(transport)).toHaveLength(0);

    const stopped = setup(true, answering(UNSURE));
    vi.mocked(stopped.transport.send).mockClear();
    deliver(stopped.session, speech("Five! Stop."));
    await settle();
    expect(stopped.session.snapshot.reason).toBe("child_stop");
    expect(released(stopped.transport)).toHaveLength(0);
  });
  it("ignores an unavailable evaluation that arrives after the child stops", async () => {
    let answer!: (result: AnswerResult) => void;
    const pending: EvaluateAnswer = () => new Promise<AnswerResult>(resolve => (answer = resolve));
    const { session, transport } = setup(true, pending);
    vi.mocked(transport.send).mockClear();
    deliver(session, speech("One!"));
    await settle();
    deliver(session, speech("I want to stop", 10_000));
    const sentBeforeResult = vi.mocked(transport.send).mock.calls.length;
    answer({ status: "unavailable", reason: "timeout", latencyMs: 4000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(session.snapshot).toMatchObject({ status: "ended", reason: "child_stop", sceneIndex: 0 });
    expect(transport.send).toHaveBeenCalledTimes(sentBeforeResult);
    expect(released(transport)).toHaveLength(0);
    expect(session.events.findLast(e => e.type === "answer.evaluated")).toMatchObject({
      detail: { unavailable: "timeout", stale: true, advancing: false, releasing: false },
    });
  });
  it("tells GPT-Live when no more checks are coming, so it never waits forever", () => {
    expect(sceneContext(sceneAt(LAST_SCENE))).toContain("the screen will not change again");
    expect(sceneContext(sceneAt(0))).not.toContain("will not change again");
    expect(INSTRUCTIONS).toContain("or once it asks you to wrap up");
  });
  it("uses the same count trigger as the prompt", () => {
    expect(["Five!", "1 ,2 ,3", "One duck.", "Two? No, wait. One!", "three butterflies"].every(mentionsNumber)).toBe(
      true,
    );
    expect(["Umm... I don't know.", "Yes! More ducks!", "Okay!", "someone", "A duck!"].some(mentionsNumber)).toBe(
      false,
    );
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
  it("does not advance or fill a thinking pause after an unconvincing answer", async () => {
    const { session, transport } = setup();
    const count = vi.mocked(transport.send).mock.calls.length;
    deliver(session, speech("um, I think"));
    await vi.advanceTimersByTimeAsync(25_000);
    expect(session.snapshot.sceneIndex).toBe(0);
    expect(transport.send).toHaveBeenCalledTimes(count);
  });
});

describe("transcript window", () => {
  it("starts a new utterance after a silent gap and keeps one within it", () => {
    const window = new TranscriptWindow();
    expect(window.append("one ", 0, 500)).toEqual({ text: "one ", startMs: 0 });
    expect(window.append("two", 1000, 1500)).toEqual({ text: "one two", startMs: 0 });
    const fresh = 1500 + UTTERANCE_GAP_MS + 1;
    expect(window.append("three", fresh, 9000)).toEqual({ text: "three", startMs: fresh });
  });
  it("keeps only the most recent characters", () => {
    const window = new TranscriptWindow();
    const { text } = window.append("x".repeat(WINDOW_CHARS + 50) + "end", 0, 500);
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
    expect(parseProviderEvent({ ...delegation("a"), arguments: { quantity: 100 } })).toEqual({
      type: "delegation",
      eventId: undefined,
      id: "a",
    });
    expect(
      parseProviderEvent({ type: "session.delegation.created", delegation: { id: "a", target: "responses" } })?.type,
    ).toBe("delegation.unsupported");
  });
});
