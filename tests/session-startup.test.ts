import { immediateAcknowledgment } from "./helpers/immediate-acknowledgment";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LessonSession, type Transport } from "../lib/session";
import { OBJECTS, sceneAt, sceneContext, TIMING } from "../lib/lesson";
import type { ProviderEvent } from "../lib/events";
import type { SessionRecorder } from "../lib/session-recorder";
import type { StartupStage } from "../lib/startup-diagnostics";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(recorder?: SessionRecorder) {
  let ready!: (event: ProviderEvent) => void;
  let fail!: (message: string) => void;
  let diagnostic!: (stage: StartupStage) => void;
  let complete!: () => void;
  let reject!: (error: Error) => void;
  const transport: Transport = {
    start: vi.fn((onEvent, onFailure) => {
      ready = onEvent;
      fail = onFailure;
      return new Promise<void>((resolve, rejectStart) => {
        complete = resolve;
        reject = rejectStart;
      });
    }),
    setStartupDiagnosticSink: sink => {
      diagnostic = sink;
    },
    startRecording: vi.fn(),
    send: vi.fn(),
    setOutputBlocked: vi.fn(),
    stopMedia: vi.fn(),
    close: vi.fn(),
  };
  const changed = vi.fn();
  const evaluate = vi.fn();
  immediateAcknowledgment(transport, () => session.snapshot.choreographyPhase);
  const session = new LessonSession(transport, evaluate, changed, undefined, recorder);
  const starting = session.start();
  return { session, transport, changed, evaluate, starting, ready, fail, diagnostic, complete, reject };
}

it.each(["scene-first", "live-first"])("joins startup once with %s, preserving the greeting", async order => {
  const { session, transport, starting, ready, complete, evaluate } = setup();
  expect(session.snapshot).toMatchObject({ status: "starting", sceneIndex: 0 });
  expect(session.events).toContainEqual(expect.objectContaining({ type: "startup.lesson_state_ready", at: 0 }));
  await session.start();
  expect(transport.start).toHaveBeenCalledOnce();
  if (order === "scene-first") {
    vi.advanceTimersByTime(16);
    session.displayed(0, session.snapshot.displayToken);
    session.displayed(0, session.snapshot.displayToken);
    expect(session.snapshot.status).toBe("starting");
  } else ready({ type: "session.started" });
  expect(transport.send).not.toHaveBeenCalled();
  vi.advanceTimersByTime(200);
  if (order === "scene-first") ready({ type: "session.started" });
  else session.displayed(0, session.snapshot.displayToken);
  complete();
  await starting;
  session.displayed(0, session.snapshot.displayToken);
  ready({ type: "session.started" });
  const scene = sceneAt(0);
  expect(transport.send).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      type: "session.instructions.append",
      content: `Start the lesson now in English. Say only: "Hi! How many ${OBJECTS[scene.object].plural} do you see?" Do not introduce yourself or ask to play a game. ${sceneContext(scene)} Then pause and listen.`,
    }),
  );
  expect(transport.startRecording).toHaveBeenCalledOnce();
  expect(evaluate).not.toHaveBeenCalled();
  for (const type of ["scene.displayed", "lesson.started", "startup.initial_instruction_sent"])
    expect(session.events.filter(event => event.type === type)).toHaveLength(1);
  expect(session.report("test").startup.live_ready_to_instruction_ms).toBe(order === "scene-first" ? 0 : 200);
  session.dispose();
});

it.each(["failure", "timeout", "stop", "rejection", "send-failure"])(
  "ends a partially initialized lesson on %s and ignores late startup callbacks",
  async failure => {
    const { session, transport, starting, ready, fail, complete, reject, diagnostic } = setup();
    session.displayed(0, session.snapshot.displayToken);
    if (failure === "failure") fail("Connection failed");
    else if (failure === "timeout") vi.advanceTimersByTime(TIMING.startup);
    else if (failure === "stop") session.end("parent_stop");
    else if (failure === "send-failure") {
      vi.mocked(transport.send).mockImplementation(() => {
        throw new Error("closed");
      });
      ready({ type: "session.started" });
    } else reject(new Error("Media failed"));
    complete();
    await starting;
    expect(session.snapshot.status).toBe("ended");
    expect(session.report("test").startup.initial_instruction_sent_at).toBeNull();
    expect(session.report("test").startup.attempt_to_first_output_ms).toBeNull();
    const events = session.events.length;
    ready({ type: "session.started" });
    diagnostic("startup.media_ready");
    session.displayed(0, session.snapshot.displayToken);
    await session.start();
    vi.advanceTimersByTime(TIMING.hard);
    expect(session.events).toHaveLength(events);
    expect(transport.start).toHaveBeenCalledOnce();
    expect(transport.send).toHaveBeenCalledTimes(failure === "send-failure" ? 1 : 0);
    expect(transport.stopMedia).toHaveBeenCalledOnce();
    expect(transport.close).toHaveBeenCalledOnce();
  },
);

it("records the early visual once at Live origin without blocking on durable creation", async () => {
  let created!: () => void;
  const recorder: SessionRecorder = {
    create: vi.fn(
      () =>
        new Promise<string>(resolve => {
          created = () => resolve("test-session");
        }),
    ),
    activate: vi.fn(async () => {}),
    append: vi.fn(async () => {}),
    appendTimeline: vi.fn(async () => {}),
    finalize: vi.fn(async () => {}),
    attachRecording: vi.fn(async () => {}),
    markIncomplete: vi.fn(async () => {}),
  };
  const { session, transport, ready, complete, starting } = setup(recorder);
  session.displayed(0, session.snapshot.displayToken);
  await Promise.resolve();
  expect(recorder.create).toHaveBeenCalledOnce();
  expect(recorder.append).not.toHaveBeenCalled();
  vi.advanceTimersByTime(500);
  ready({ type: "session.started" });
  complete();
  await starting;
  expect(transport.send).toHaveBeenCalledOnce();
  session.displayed(0, session.snapshot.displayToken);
  ready({ type: "session.started" });
  created();
  await session.recordingSettled();
  expect(recorder.activate).toHaveBeenCalledExactlyOnceWith(session.startedAt);
  expect(recorder.append).toHaveBeenCalledExactlyOnceWith(
    "evidence_1",
    0,
    expect.objectContaining({ type: "scene_displayed", sceneId: "hello-duck" }),
  );
  expect(session.report("test").startup).toMatchObject({ initial_scene_displayed_at: 0, live_ready_at: 500 });
  session.dispose();
  await session.recordingSettled();
});

it("reports startup milestones and durations once, separating provider output, transcript and decoded speech", async () => {
  const { session, diagnostic, ready, complete, starting } = setup();
  diagnostic("startup.media_started");
  vi.advanceTimersByTime(10);
  session.displayed(0, session.snapshot.displayToken);
  vi.advanceTimersByTime(90);
  diagnostic("startup.microphone_ready");
  diagnostic("startup.live_connection_started");
  diagnostic("startup.provider_request_started");
  vi.advanceTimersByTime(50);
  diagnostic("startup.media_ready");
  vi.advanceTimersByTime(850);
  diagnostic("startup.provider_response_received");
  diagnostic("startup.remote_description_applied");
  vi.advanceTimersByTime(200);
  diagnostic("startup.provider_session_started");
  ready({ type: "session.started" });
  complete();
  await starting;
  vi.advanceTimersByTime(300);
  diagnostic("startup.first_provider_output");
  diagnostic("startup.first_provider_output");
  vi.advanceTimersByTime(20);
  ready({ type: "transcript", speaker: "sprout", delta: "Hi!", startMs: 300, endMs: 320 });
  vi.advanceTimersByTime(30);
  ready({ type: "output.activity", state: "active" });
  expect(session.report("test").startup).toMatchObject({
    attempt_started_at: 0,
    media_setup_ms: 150,
    provider_request_ms: 900,
    sdp_to_provider_started_ms: 200,
    attempt_to_live_ready_ms: 1200,
    attempt_to_initial_scene_ms: 10,
    live_ready_to_instruction_ms: 0,
    instruction_to_first_output_ms: 300,
    attempt_to_first_output_ms: 1500,
    attempt_to_first_transcript_ms: 1520,
    attempt_to_first_speech_ms: 1550,
  });
  expect(session.events.filter(event => event.type === "startup.first_provider_output")).toHaveLength(1);
  const timing = session.report("test").startup;
  for (let index = 0; index < 8001; index++) session.log("test.event");
  expect(session.events.some(event => event.type === "attempt.started")).toBe(false);
  expect(session.report("test").startup).toEqual(timing);
  session.dispose();
});
