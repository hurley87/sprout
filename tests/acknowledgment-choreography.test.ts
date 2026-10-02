import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LessonSession, RESPONSE_GATE_RECOVERY_MS, type Transport } from "../lib/session";
import { TRANSCRIPT_FALLBACK_MS, CORRECTION_WINDOW_MS } from "../lib/answer";
import { LAST_SCENE } from "../lib/lesson";
import type { ClientCommand, LocalPlaybackEvent } from "../lib/events";
import type { PlaybackRequest } from "../lib/local-playback";
import type { TimelineEvent, SessionRecorder } from "../lib/session-recorder";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
function fixture() {
  let sink!: (event: LocalPlaybackEvent) => void;
  const requests: PlaybackRequest[] = [];
  const instructions: { source: number; command: ClientCommand }[] = [];
  const timeline: { atMs: number; event: TimelineEvent }[] = [];
  let nextSource = 1;
  const pending: { id: number; finish: () => void; signal: AbortSignal }[] = [];
  const recorder: SessionRecorder = {
    create: vi.fn(async () => "record"),
    activate: vi.fn(async () => {}),
    append: vi.fn(async () => {}),
    appendTimeline: vi.fn(async (_key, atMs, event) => {
      timeline.push({ atMs, event });
    }),
    finalize: vi.fn(async () => {}),
    markIncomplete: vi.fn(async () => {}),
    attachRecording: vi.fn(async () => {}),
  };
  const transport: Transport = {
    activeSourceId: 1,
    start: vi.fn(async () => {}),
    setPlaybackEventSink: callback => {
      sink = callback;
    },
    send: vi.fn(command => instructions.push({ source: transport.activeSourceId!, command })),
    setOutputBlocked: vi.fn(),
    discardOutput: vi.fn(() => true),
    playAcknowledgment: vi.fn(request => {
      requests.push(request);
      const result = new Promise<LocalPlaybackEvent>(() => {});
      return { result, cancel: vi.fn(reason => emit(reason ?? "interrupted", request)) };
    }),
    prepareReplacement: vi.fn(
      (_seed, signal) =>
        new Promise<number>(resolve => {
          const id = ++nextSource;
          pending.push({ id, signal, finish: () => resolve(id) });
        }),
    ),
    activateSource: vi.fn(id => {
      Object.assign(transport, { activeSourceId: id });
      return true;
    }),
    retireSource: vi.fn(),
    stopMedia: vi.fn(),
    close: vi.fn(),
    recording: vi.fn(async () => ({
      blob: new Blob(["synthetic"]),
      mimeType: "audio/webm",
      startOffsetMs: 0,
      durationMs: 10000,
    })),
  };
  const evaluator = vi.fn(async () => ({ status: "evaluated" as const, probability: 1, model: "unit", latencyMs: 1 }));
  const changed = vi.fn();
  const session = new LessonSession(transport, evaluator, changed, undefined, recorder);
  void session.start();
  session.receive({ type: "session.started", sourceId: 1 });
  session.displayed(0, session.snapshot.displayToken);
  instructions.length = 0;
  function child(delta = "One", startMs = 1000) {
    session.receive({
      type: "transcript",
      speaker: "child",
      delta,
      startMs,
      endMs: startMs + 100,
      sourceId: transport.activeSourceId,
    });
  }
  function emit(
    state: LocalPlaybackEvent["state"],
    request = requests.at(-1)!,
    extra: Partial<LocalPlaybackEvent> = {},
  ) {
    const event: LocalPlaybackEvent = {
      type: "local.playback",
      identity: request.identity,
      sourceId: request.identity.owningSourceId,
      assetId: request.asset.id,
      assetSha256: request.asset.sha256,
      state,
      clock: "browser.performance.now",
      observedAt: performance.now(),
      ...(state === "media_ended" || state === "completed" ? { mediaTime: 2, duration: 2, renderFence: 2 } : {}),
      ...(state === "completed" ? { outputTimestamp: { contextTime: 2.1, performanceTime: performance.now() } } : {}),
      ...extra,
    };
    sink(event);
    return event;
  }
  async function accept() {
    child();
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_FALLBACK_MS + CORRECTION_WINDOW_MS + 1);
  }
  function complete(request = requests.at(-1)!) {
    for (const state of ["requested", "ready", "started", "media_ended", "completed"] as const) emit(state, request);
  }
  async function confirm() {
    session.displayed(session.snapshot.sceneIndex, session.snapshot.displayToken);
    await vi.advanceTimersByTimeAsync(0);
  }
  async function ready() {
    pending.at(-1)!.finish();
    await vi.advanceTimersByTimeAsync(0);
  }
  return {
    session,
    changed,
    transport,
    evaluator,
    requests,
    instructions,
    timeline,
    pending,
    child,
    emit,
    accept,
    complete,
    confirm,
    ready,
  };
}

it("accepts without committing, plays on the old display, waits for drain, validates display token, then asks once only on B", async () => {
  const f = fixture();
  await f.accept();
  expect(f.session.snapshot.sceneIndex).toBe(0);
  expect(f.transport.discardOutput).toHaveBeenCalledOnce();
  expect(f.requests).toHaveLength(1);
  f.emit("requested");
  f.emit("ready");
  f.emit("started");
  f.emit("media_ended");
  expect(f.session.snapshot.choreographyPhase).toBe("ack_draining");
  expect(f.session.snapshot.sceneIndex).toBe(0);
  expect(f.transport.prepareReplacement).not.toHaveBeenCalled();
  f.emit("completed");
  expect(f.session.snapshot.sceneIndex).toBe(1);
  const token = f.session.snapshot.displayToken;
  f.session.displayed(1, "old-attempt:same-index");
  expect(f.transport.prepareReplacement).not.toHaveBeenCalled();
  await f.confirm();
  const seed = vi.mocked(f.transport.prepareReplacement!).mock.calls[0][0];
  expect(seed.choreography).toMatchObject({
    phase: "next_question_pending",
    applicationAction: "ADVANCE",
    acknowledgment: "completed",
    display: { sceneId: "duck-friends", token },
  });
  expect(seed.choreography!.responseIdentity).toEqual(f.requests[0].identity.responseIdentity);
  await f.ready();
  f.session.displayed(1, token);
  f.emit("completed", f.requests[0]);
  expect(f.instructions.filter(x => x.command.type === "session.instructions.append")).toHaveLength(1);
  expect(f.instructions.at(-1)).toMatchObject({ source: 2, command: { delegation_id: null } });
  expect(f.instructions.at(-1)!.command).toHaveProperty("content", expect.stringContaining("Ask only"));
  expect(f.session.snapshot.questionStatus).toBe("authorized_delivery_unknown");
  await f.session.recordingSettled();
  const accepted = f.timeline.findIndex(
    x => x.event.type === "evaluation_control" && x.event.action === "advancement_accepted",
  );
  const completed = f.timeline.findIndex(x => x.event.type === "local_playback" && x.event.state === "completed");
  const committed = f.timeline.findIndex(x => x.event.type === "scene_advance_committed");
  expect(accepted).toBeLessThan(completed);
  expect(completed).toBeLessThan(committed);
  for (const { event, atMs } of f.timeline)
    if (event.type === "local_playback") {
      expect(event.provenance).toBe("application_finite_audio");
      expect(event.text).toBe("That's right, there's one duck.");
      expect(event.display.sceneId).toBe("hello-duck");
      expect(atMs).toBe(event.sessionAtMs);
    }
  f.session.dispose();
});

for (const phase of ["started", "media_ended"] as const)
  it(`correction during ${phase} supersedes the old evaluation and cannot commit through a retained completion`, async () => {
    const f = fixture();
    await f.accept();
    f.emit("requested");
    f.emit("ready");
    f.emit("started");
    if (phase === "media_ended") f.emit("media_ended");
    const old = f.requests[0];
    f.child(" no two", 1100);
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_FALLBACK_MS + CORRECTION_WINDOW_MS + 1);
    f.emit("completed", old);
    expect(f.session.snapshot.sceneIndex).toBe(0);
    expect(f.evaluator).toHaveBeenCalledTimes(2);
    expect(f.evaluator).toHaveBeenLastCalledWith({ sceneIndex: 0, utterance: "One no two" }, expect.any(AbortSignal));
    expect(f.requests).toHaveLength(2);
    expect(f.requests[1].identity.playbackAttemptId).not.toBe(old.identity.playbackAttemptId);
    expect(f.requests[1].identity.responseIdentity.fragmentKeys).toHaveLength(2);
    f.session.dispose();
  });

for (const type of ["microphone.activity_started", "microphone.speech_started"] as const)
  it(`cancels for ${type}, retries whole clip once with a fresh token and preserves the original budget`, async () => {
    const f = fixture();
    await f.accept();
    f.emit("requested");
    f.emit("ready");
    f.emit("started");
    const old = f.requests[0];
    f.session.receive({ type });
    f.emit("completed", old);
    expect(f.session.snapshot.sceneIndex).toBe(0);
    if (type === "microphone.activity_started") f.session.receive({ type: "microphone.activity_discarded" });
    else f.session.receive({ type: "microphone.speech_stopped", quietMs: 900 });
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_FALLBACK_MS + CORRECTION_WINDOW_MS + 1);
    expect(f.requests).toHaveLength(2);
    expect(f.requests[1].identity.playbackAttemptId).not.toBe(old.identity.playbackAttemptId);
    f.complete();
    await f.confirm();
    await vi.advanceTimersByTimeAsync(RESPONSE_GATE_RECOVERY_MS);
    expect(f.session.snapshot.status).toBe("ended");
    await f.ready();
    expect(f.transport.activateSource).not.toHaveBeenCalled();
  });

it("retains non-answer interruption, restarts acknowledgment after quiet, never evaluates the interruption", async () => {
  const f = fixture();
  await f.accept();
  f.emit("requested");
  f.emit("ready");
  f.emit("started");
  f.child("hello", 7000);
  await vi.advanceTimersByTimeAsync(TRANSCRIPT_FALLBACK_MS + CORRECTION_WINDOW_MS + 1);
  expect(f.evaluator).toHaveBeenCalledTimes(1);
  expect(f.requests).toHaveLength(2);
  f.complete();
  expect(f.session.snapshot.sceneIndex).toBe(1);
  f.session.dispose();
});

for (const phase of ["before_display", "preparing_question"] as const)
  it(`retains transition-period correction ${phase}, never rolls back or evaluates an unasked question`, async () => {
    const f = fixture();
    await f.accept();
    f.complete();
    if (phase === "preparing_question") await f.confirm();
    f.child("no two", 7000);
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_FALLBACK_MS + CORRECTION_WINDOW_MS + 1);
    expect(f.evaluator).toHaveBeenCalledTimes(1);
    expect(f.session.snapshot.sceneIndex).toBe(1);
    if (phase === "before_display") await f.confirm();
    if (f.pending.length === 2) {
      f.pending[0].finish();
      await vi.advanceTimersByTimeAsync(0);
      expect(f.transport.activateSource).not.toHaveBeenCalled();
    }
    await f.ready();
    expect(f.instructions.at(-1)!.command).toHaveProperty("content", expect.stringContaining("Neutrally clarify"));
    expect(f.session.snapshot.questionStatus).toBe("authorized_delivery_unknown");
    f.session.dispose();
  });

it("retries playback failure once and ends without commit on a second failure", async () => {
  const f = fixture();
  await f.accept();
  f.emit("failed");
  expect(f.requests).toHaveLength(2);
  f.emit("failed");
  expect(f.session.snapshot.status).toBe("ended");
  expect(f.session.snapshot.sceneIndex).toBe(0);
});
it("precommit source recovery seeds the actual old display and retains original response identity", async () => {
  const f = fixture();
  await f.accept();
  f.emit("source_retired");
  const seed = vi.mocked(f.transport.prepareReplacement!).mock.calls[0][0];
  expect(seed.choreography).toMatchObject({
    phase: "accepted_pending_ack",
    applicationAction: "UNCOMMITTED",
    acknowledgment: "pending",
    display: { sceneId: "hello-duck" },
  });
  await f.ready();
  expect(f.requests).toHaveLength(2);
  expect(f.requests[1].identity).toMatchObject({ originSourceId: 1, owningSourceId: 2 });
  f.complete();
  expect(f.session.snapshot.sceneIndex).toBe(1);
  f.session.dispose();
});

it("delegation during acknowledgment joins the one evaluator and reports accepted/uncommitted old display", async () => {
  const f = fixture();
  f.child();
  f.session.receive({ type: "delegation", id: "handle", offsetMs: 1100, sourceId: 1 });
  await vi.advanceTimersByTimeAsync(TRANSCRIPT_FALLBACK_MS + CORRECTION_WINDOW_MS + 1);
  const linked = f.instructions.filter(x => "delegation_id" in x.command && x.command.delegation_id === "handle");
  expect(linked).toHaveLength(1);
  expect(linked[0].command).toHaveProperty("content", expect.stringContaining("UNCOMMITTED"));
  expect(linked[0].command).toHaveProperty("content", expect.stringContaining("hello-duck"));
  f.complete();
  await f.confirm();
  await f.ready();
  expect(f.evaluator).toHaveBeenCalledOnce();
  expect(
    f.instructions.filter(x => x.source === 2 && "delegation_id" in x.command && x.command.delegation_id !== null),
  ).toEqual([]);
  f.session.dispose();
});

for (const reason of ["parent_stop", "child_stop", "page_hidden", "time_limit", "connection_failure"] as const)
  it(`revokes playback/display/question authority for ${reason}`, async () => {
    const f = fixture();
    await f.accept();
    const old = f.requests[0];
    f.session.end(reason);
    f.complete(old);
    f.session.displayed(1, f.session.snapshot.displayToken);
    expect(f.session.snapshot.sceneIndex).toBe(0);
    expect(f.transport.prepareReplacement).not.toHaveBeenCalled();
  });
it("rejects fabricated out-of-order, wrong-epoch and missing-fence completions", async () => {
  const f = fixture();
  await f.accept();
  const r = f.requests[0];
  f.emit("completed");
  f.emit("requested");
  f.emit("ready");
  f.emit("started");
  f.emit("media_ended");
  f.emit("completed", r, { identity: { ...r.identity, choreographyEpoch: 99 } });
  f.emit("completed", r, { renderFence: undefined });
  expect(f.session.snapshot.sceneIndex).toBe(0);
  f.emit("completed");
  expect(f.session.snapshot.sceneIndex).toBe(1);
  f.session.dispose();
});
it("stale source close/error/transcript callbacks cannot change a promoted source", async () => {
  const f = fixture();
  await f.accept();
  f.complete();
  await f.confirm();
  await f.ready();
  for (const event of [
    { type: "session.closed" },
    { type: "provider.error" },
    { type: "transcript", speaker: "child", delta: "stop", startMs: 1, endMs: 2 },
  ] as const)
    f.session.receive({ ...event, sourceId: 1 });
  expect(f.session.snapshot.status).toBe("active");
  expect(f.evaluator).toHaveBeenCalledOnce();
  f.session.dispose();
});
it("last group receives its question once, then bypasses app advancement", async () => {
  const f = fixture();
  for (let index = 0; index < LAST_SCENE; index++) {
    f.child("One", 1000 + index * 10000);
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_FALLBACK_MS + CORRECTION_WINDOW_MS + 1);
    f.complete();
    await f.confirm();
    await f.ready();
  }
  expect(f.session.snapshot.sceneIndex).toBe(LAST_SCENE);
  const count = f.requests.length;
  f.child("Five", 60000);
  await vi.advanceTimersByTimeAsync(TRANSCRIPT_FALLBACK_MS + CORRECTION_WINDOW_MS + 1);
  expect(f.requests).toHaveLength(count);
  expect(f.evaluator).toHaveBeenCalledTimes(LAST_SCENE);
  f.session.dispose();
});

it("late rejected playback promise from a superseded attempt cannot end the new owner", async () => {
  const f = fixture();
  let reject!: (error: Error) => void;
  vi.mocked(f.transport.playAcknowledgment!).mockImplementationOnce(request => {
    f.requests.push(request);
    return {
      result: new Promise((_resolve, no) => {
        reject = no;
      }),
      cancel: vi.fn(),
    };
  });
  await f.accept();
  f.child(" no two", 1100);
  await vi.advanceTimersByTimeAsync(TRANSCRIPT_FALLBACK_MS + CORRECTION_WINDOW_MS + 1);
  expect(f.requests).toHaveLength(2);
  reject(new Error("late old failure"));
  await vi.advanceTimersByTimeAsync(0);
  expect(f.session.snapshot.status).toBe("active");
  f.complete();
  expect(f.session.snapshot.sceneIndex).toBe(1);
  f.session.dispose();
});
for (const field of ["renderFence", "mediaTime", "duration"] as const)
  it(`nonfinite completion ${field} cannot commit`, async () => {
    const f = fixture();
    await f.accept();
    f.emit("requested");
    f.emit("ready");
    f.emit("started");
    f.emit("media_ended");
    f.emit("completed", f.requests[0], { [field]: NaN });
    expect(f.session.snapshot.sceneIndex).toBe(0);
    f.emit("completed", f.requests[0], {
      outputTimestamp: { contextTime: Infinity, performanceTime: performance.now() },
    });
    expect(f.session.snapshot.sceneIndex).toBe(0);
    f.emit("completed");
    expect(f.session.snapshot.sceneIndex).toBe(1);
    f.session.dispose();
  });

it("preparation watchdog retries once, retires late readiness and never renews the response deadline", async () => {
  const f = fixture();
  await f.accept();
  f.complete();
  await f.confirm();
  const first = f.pending[0];
  await vi.advanceTimersByTimeAsync(5000);
  expect(first.signal.aborted).toBe(true);
  expect(f.pending).toHaveLength(2);
  first.finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.transport.retireSource).toHaveBeenCalledWith(first.id);
  expect(f.transport.activateSource).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.session.snapshot.status).toBe("ended");
  f.pending[1].finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.transport.activateSource).not.toHaveBeenCalled();
  expect(f.session.events.filter(e => e.type === "answer.response_gate_released")).toHaveLength(0);
});
it("question send failure preserves delivery unknown and no late callback can authorize it again", async () => {
  const f = fixture();
  await f.accept();
  f.complete();
  await f.confirm();
  vi.mocked(f.transport.send).mockImplementationOnce(() => {
    throw new Error("send failure");
  });
  await f.ready();
  expect(f.session.snapshot).toMatchObject({ status: "ended", questionStatus: "authorized_delivery_unknown" });
  const before = vi.mocked(f.transport.send).mock.calls.length;
  await f.confirm();
  await f.ready();
  expect(f.transport.send).toHaveBeenCalledTimes(before);
  await f.session.recordingSettled();
  expect(f.timeline.map(x => x.event)).toContainEqual(
    expect.objectContaining({
      type: "choreography_phase",
      phase: "next_question_pending",
      questionStatus: "authorized_delivery_unknown",
      reason: "question_authorized_delivery_unverified",
    }),
  );
});
for (const transition of ["wrap", "goodbye"] as const)
  it(`${transition} cancels acknowledgment and its retained completion before any scene change`, async () => {
    const f = fixture();
    await f.accept();
    f.emit("requested");
    f.emit("ready");
    f.emit("started");
    (f.session as unknown as { wrap: () => void; goodbye: () => void })[transition]();
    f.emit("media_ended");
    f.emit("completed");
    expect(f.session.snapshot.status).toBe("ended");
    expect(f.session.snapshot.reason).toBe(transition === "wrap" ? "wrap_up" : "time_limit");
    expect(f.session.snapshot.sceneIndex).toBe(0);
    expect(f.transport.prepareReplacement).not.toHaveBeenCalled();
  });
it("phase-aware recovery seeds are closed, preserve response provenance and distinguish old from confirmed display", async () => {
  const { parseReplacementSeed, replacementSessionInput } = await import("../lib/lesson");
  const f = fixture();
  await f.accept();
  f.emit("source_retired");
  const before = vi.mocked(f.transport.prepareReplacement!).mock.calls[0][0];
  expect(parseReplacementSeed(before)).toEqual(before);
  expect(replacementSessionInput(before)[1].content[0].text).toContain("application action UNCOMMITTED");
  for (const malformed of [
    { ...before, choreography: { ...before.choreography, questionToken: "another:question:1" } },
    { ...before, choreography: { ...before.choreography, phase: "next_question_pending" } },
    {
      ...before,
      choreography: {
        ...before.choreography,
        responseIdentity: { ...before.choreography!.responseIdentity, sourceStatus: "mixed" },
      },
    },
    {
      ...before,
      choreography: { ...before.choreography, display: { ...before.choreography!.display, sceneId: "duck-friends" } },
    },
    { ...before, choreography: { ...before.choreography, instructions: "reopen A" } },
  ])
    expect(parseReplacementSeed(malformed)).toBeNull();
  await f.ready();
  f.complete();
  await f.confirm();
  const after = vi.mocked(f.transport.prepareReplacement!).mock.calls.at(-1)![0];
  expect(parseReplacementSeed(after)).toEqual(after);
  expect(after.choreography!.responseIdentity).toEqual(before.choreography!.responseIdentity);
  expect(replacementSessionInput(after)[1].content[0].text).toContain("Ask only");
  expect(replacementSessionInput(after)[1].content[0].text).toContain("acknowledgment has already played");
  f.session.dispose();
});
it("startup refuses missing reviewed assets before connecting the voice transport", async () => {
  const transport: Transport = {
    start: vi.fn(async () => {}),
    preloadAcknowledgments: vi.fn(async () => {
      throw new Error("Catalog unavailable");
    }),
    send: vi.fn(),
    setOutputBlocked: vi.fn(),
    stopMedia: vi.fn(),
    close: vi.fn(),
  };
  const session = new LessonSession(transport, vi.fn(), vi.fn());
  await session.start();
  expect(transport.start).not.toHaveBeenCalled();
  expect(session.snapshot).toMatchObject({ status: "ended", reason: "connection_failure" });
  expect(transport.stopMedia).toHaveBeenCalledOnce();
});
it("postcommit delegations share the evaluator, reflect actual confirmed display and never cross source authority", async () => {
  const f = fixture();
  await f.accept();
  f.complete();
  f.session.receive({ type: "delegation", id: "waiting-display", offsetMs: 1100, sourceId: 1 });
  await f.confirm();
  f.session.receive({ type: "delegation", id: "confirmed-display", offsetMs: 1100, sourceId: 1 });
  const linked = f.instructions.filter(x => "delegation_id" in x.command && x.command.delegation_id !== null);
  expect(linked).toHaveLength(2);
  expect(linked.every(x => x.source === 1)).toBe(true);
  expect(linked[0].command).toHaveProperty("content", expect.stringContaining("Last confirmed display: hello-duck"));
  expect(linked[0].command).toHaveProperty("content", expect.stringContaining("display confirmation pending"));
  expect(linked[1].command).toHaveProperty("content", expect.stringContaining("Last confirmed display: duck-friends"));
  expect(linked[1].command).toHaveProperty("content", expect.stringContaining("next question pending"));
  await f.ready();
  f.session.receive({ type: "delegation", id: "late-A", offsetMs: 1100, sourceId: 1 });
  expect(f.evaluator).toHaveBeenCalledOnce();
  expect(
    f.instructions.filter(x => x.source === 2 && "delegation_id" in x.command && x.command.delegation_id !== null),
  ).toEqual([]);
  f.session.dispose();
});
for (const phase of ["ack_completed", "transition_waiting_display"] as const)
  it(`synchronous stop from ${phase} notification revokes scene commit authority`, async () => {
    const f = fixture();
    await f.accept();
    f.changed.mockImplementation(snapshot => {
      if (snapshot.choreographyPhase === phase && snapshot.status === "active") f.session.end("parent_stop");
    });
    f.complete();
    expect(f.session.snapshot).toMatchObject({ status: "ended", reason: "parent_stop", sceneIndex: 0 });
    expect(f.session.events.filter(e => e.type === "advance.committed")).toHaveLength(0);
    expect(f.transport.prepareReplacement).not.toHaveBeenCalled();
  });
it("reentrant correction during completion remains on the old display and owns a new evaluation", async () => {
  const f = fixture();
  await f.accept();
  let corrected = false;
  f.changed.mockImplementation(snapshot => {
    if (snapshot.choreographyPhase === "ack_completed" && !corrected) {
      corrected = true;
      f.child(" no two", 1100);
    }
  });
  f.complete();
  expect(f.session.snapshot.sceneIndex).toBe(0);
  await vi.advanceTimersByTimeAsync(TRANSCRIPT_FALLBACK_MS + CORRECTION_WINDOW_MS + 1);
  expect(f.evaluator).toHaveBeenLastCalledWith({ sceneIndex: 0, utterance: "One no two" }, expect.any(AbortSignal));
  expect(f.requests).toHaveLength(2);
  f.complete();
  expect(f.session.snapshot.sceneIndex).toBe(1);
  f.session.dispose();
});
for (const input of ["parent_stop", "microphone.activity_started", "microphone.speech_started", "transcript"] as const)
  it(`question authorization notification rechecks ${input} before dispatch`, async () => {
    const f = fixture();
    await f.accept();
    f.complete();
    await f.confirm();
    let interrupted = false;
    f.changed.mockImplementation(snapshot => {
      if (!interrupted && snapshot.choreographyPhase === "next_question_pending" && f.transport.activeSourceId === 2) {
        interrupted = true;
        if (input === "parent_stop") f.session.end("parent_stop");
        else if (input === "transcript") f.child("no two", 7000);
        else f.session.receive({ type: input });
      }
    });
    await f.ready();
    expect(f.instructions.filter(x => x.command.type === "session.instructions.append")).toHaveLength(0);
    expect(f.transport.setOutputBlocked).not.toHaveBeenCalledWith(false);
    if (input === "parent_stop") {
      expect(f.session.snapshot).toMatchObject({ status: "ended", questionStatus: "cancelled" });
      return;
    }
    expect(f.session.snapshot.questionStatus).toBe("pending");
    if (input === "microphone.activity_started") f.session.receive({ type: "microphone.activity_discarded" });
    if (input === "microphone.speech_started") f.session.receive({ type: "microphone.speech_stopped", quietMs: 900 });
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_FALLBACK_MS);
    await f.ready();
    expect(f.instructions.filter(x => x.command.type === "session.instructions.append")).toHaveLength(1);
    expect(f.instructions[0].source).toBe(3);
    expect(f.evaluator).toHaveBeenCalledOnce();
    f.session.dispose();
  });
for (const input of ["parent_stop", "microphone.activity_started", "microphone.speech_started", "transcript"] as const)
  it(`released question notification cannot restore output after ${input}`, async () => {
    const f = fixture();
    await f.accept();
    f.complete();
    await f.confirm();
    let interrupted = false;
    f.changed.mockImplementation(snapshot => {
      if (!interrupted && snapshot.choreographyPhase === "next_question_released") {
        interrupted = true;
        if (input === "parent_stop") f.session.end("parent_stop");
        else if (input === "transcript") f.child("no two", 7000);
        else f.session.receive({ type: input });
      }
    });
    await f.ready();
    expect(f.instructions.filter(x => x.command.type === "session.instructions.append")).toHaveLength(1);
    expect(f.session.snapshot).toMatchObject({ status: "ended", questionStatus: "authorized_delivery_unknown" });
    expect(f.transport.setOutputBlocked).not.toHaveBeenCalledWith(false);
    expect(f.session.events.filter(e => e.type === "answer.response_gate_released")).toHaveLength(0);
    expect(f.evaluator).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(RESPONSE_GATE_RECOVERY_MS);
    expect(f.instructions.filter(x => x.command.type === "session.instructions.append")).toHaveLength(1);
  });
