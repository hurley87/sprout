import { expect, it, vi, afterEach } from "vitest";
import { attemptWindowInjection, diagnoseWindowMiss, type InjectionTiming } from "./helpers/injection-window";
import { createLessonRuntime } from "./helpers/counting-runtime";
import type { LessonDiagnostic, LessonObservation } from "../lib/lesson-runtime/lesson-runtime";
import { assertInjectionWindow, butterflySummary, assertButterflySafety } from "./browser/live/butterfly-evidence";
import type { Report } from "./browser/live/evidence";

function windowFixture(timing: InjectionTiming = "during-output") {
  const state = {
    ...createLessonRuntime("window-runtime"),
    nodeId: "count-3-butterflies" as const,
    visitId: 3,
    childTurnId: 1,
    hasChildTurn: true,
    hasChildTranscript: true,
    transcriptRevision: 2,
    transcriptSource: "tutor" as const,
    outputActivity: timing === "during-output" ? ("active" as const) : ("quiet" as const),
  };
  let nowMs = 150;
  const events: LessonDiagnostic[] = [];
  const event = (type: string, atMs: number, detail: unknown, speaker: "child" | "tutor" | "unknown" = "unknown") => {
    const e: LessonDiagnostic = {
      type,
      atMs,
      timestamp: "offline",
      runtimeId: state.runtimeId,
      visitId: 3,
      nodeId: state.nodeId,
      childTurnId: 1,
      transcriptRevision: 2,
      transcriptSpeaker: speaker,
      detail,
    };
    events.push(e);
    return e;
  };
  event("transcript.snapshot", 10, { transcript: "Child: Uh, I think, uh, three." }, "child");
  event("runtime.event.child.turn.ended", 20, {});
  event("output.activity", 30, { state: "active" });
  event(
    "transcript.snapshot",
    40,
    { transcript: "Child: Uh, I think, uh, three.\nTutor: Yes, three butterflies." },
    "tutor",
  );
  if (timing !== "during-output") event("output.activity", 100, { state: "quiet" });
  if (timing === "confirmation-quiet") event("tutor_stabilization.scheduled", 110, { delayMs: 200 }, "tutor");
  if (timing === "classifier-in-flight") event("classifier.started", 120, {}, "tutor");
  event("runtime.changed", 125, { before: state, after: state, trigger: "clock.tick" });
  const observation = (): LessonObservation =>
    structuredClone({
      nowMs: nowMs++,
      events,
      cursor: { runtimeId: state.runtimeId, offset: events.length },
      snapshot: {
        runtime: state,
        status: "live",
        error: null,
        transcript: "",
        diagnostics: [],
        awaitingSteering: false,
        display: { nodeId: state.nodeId, token: "test", sceneId: "butterfly-garden" },
      },
    });
  const speech = vi.fn(() => ({ id: 7, startedAt: 900000, durationSeconds: 0.25 }));
  const noise = vi.fn(() => ({ id: 8, startedAt: 900001, durationSeconds: 0.04 }));
  const read = vi.fn(observation);
  vi.stubGlobal("window", {
    sproutLessonObservation: { read },
    syntheticMicrophone: { speech, noise, state: () => ({ activeSources: 0 }) },
  });
  const request = {
    from: {
      after: { runtimeId: state.runtimeId, offset: 0 },
      scope: { runtimeId: state.runtimeId, visitId: 3, nodeId: state.nodeId, childTurnId: 0 },
    },
    timing,
    audio: { fixture: "uh" as const },
  };
  const report = (): Report => ({
    product: "sprout",
    version: 1,
    classifierVersion: "conversation-state-v2",
    clock: "browser.performance.now-relative-to-attempt",
    runtimeId: state.runtimeId,
    status: "live",
    error: null,
    transcript: "",
    timing: {} as Report["timing"],
    runtime: state,
    events,
  });
  return {
    state,
    events,
    event,
    request,
    report,
    speech,
    noise,
    read,
    setNow: (value: number) => {
      nowMs = value;
    },
  };
}
afterEach(() => vi.unstubAllGlobals());

it.each(["during-output", "confirmation-quiet", "classifier-in-flight"] as const)(
  "starts preloaded speech atomically in current %s window and validates saved journal",
  timing => {
    const f = windowFixture(timing);
    const landed = attemptWindowInjection(f.request)!;
    expect(f.speech).toHaveBeenCalledExactlyOnceWith("uh");
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(landed.atMs).toBe(150);
    expect(landed.afterStartMs).toBe(151);
    assertInjectionWindow(f.report(), landed);
  },
);
it("noise uses the identical atomic window with explicit seeded non-speech parameters", () => {
  const f = windowFixture();
  const noise = { seed: 30, durationMs: 40, amplitude: 0.2 };
  const landed = attemptWindowInjection({ ...f.request, audio: { noise } })!;
  expect(f.noise).toHaveBeenCalledExactlyOnceWith(noise);
  expect(f.speech).not.toHaveBeenCalled();
  assertInjectionWindow(f.report(), landed);
});
it.each([
  "quiet now",
  "old active",
  "old child turn",
  "speaking",
  "missing ended",
  "missing heard answer",
  "old output before answer",
  "awaiting steering",
])("rejects missed/unsafe output window: %s", fault => {
  const f = windowFixture();
  if (fault === "quiet now") f.state.outputActivity = "quiet";
  if (fault === "old active") f.event("output.activity", 145, { state: "quiet" });
  if (fault === "old child turn") f.request.from.scope.childTurnId = 1;
  if (fault === "speaking") f.state.childSpeaking = true;
  if (fault === "missing ended")
    f.events.splice(
      f.events.findIndex(e => e.type === "runtime.event.child.turn.ended"),
      1,
    );
  if (fault === "missing heard answer") f.events[0].detail = { transcript: "Tutor: Three.\nChild: Okay." };
  if (fault === "old output before answer") f.events.find(e => e.type === "output.activity")!.atMs = 15;
  if (fault === "awaiting steering") {
    const original = f.read.getMockImplementation()!;
    f.read.mockImplementation(() => {
      const v = original();
      v.snapshot.awaitingSteering = true;
      return v;
    });
  }
  expect(attemptWindowInjection(f.request)).toBeNull();
  expect(f.speech).not.toHaveBeenCalled();
});
it.each(["restart", "visit left", "ended"])(
  "fails explicitly on %s rather than injecting into another scene",
  fault => {
    const f = windowFixture();
    if (fault === "restart") f.request.from.after.runtimeId = "other";
    if (fault === "visit left") f.request.from.scope.visitId = 2;
    if (fault === "ended") f.state.phase = "complete";
    expect(() => attemptWindowInjection(f.request)).toThrow();
    expect(f.speech).not.toHaveBeenCalled();
  },
);
it.each(["expired", "cancelled", "revision", "no confirmation", "output active", "old quiet"])(
  "rejects obsolete confirmation schedule: %s",
  fault => {
    const f = windowFixture("confirmation-quiet");
    if (fault === "expired") f.setNow(310);
    if (fault === "cancelled") f.event("tutor_stabilization.cancelled", 140, {});
    if (fault === "revision") f.events.find(e => e.type === "tutor_stabilization.scheduled")!.transcriptRevision = 1;
    if (fault === "no confirmation")
      f.events.find(e => e.transcriptSpeaker === "tutor")!.detail = { transcript: "Tutor: How many butterflies?" };
    if (fault === "output active") f.state.outputActivity = "active";
    if (fault === "old quiet") {
      f.setNow(1200);
      (f.events.find(e => e.type === "tutor_stabilization.scheduled")!.detail as { delayMs: number }).delayMs = 2000;
    }
    expect(attemptWindowInjection(f.request)).toBeNull();
    expect(f.speech).not.toHaveBeenCalled();
  },
);
it.each(["classifier.cancelled", "classifier.result", "classifier.held", "classifier.abstained", "classifier.error"])(
  "does not inject on an old request after %s",
  type => {
    const f = windowFixture("classifier-in-flight");
    f.event(type, 140, {});
    expect(attemptWindowInjection(f.request)).toBeNull();
  },
);
it.each(["identity changed", "delayed start", "old output", "expired schedule", "cancelled request"])(
  "saved timing assertions reject %s",
  fault => {
    const timing =
      fault === "expired schedule"
        ? "confirmation-quiet"
        : fault === "cancelled request"
          ? "classifier-in-flight"
          : "during-output";
    const f = windowFixture(timing);
    const landed = attemptWindowInjection(f.request)!;
    if (fault === "identity changed")
      landed.afterState = { ...landed.afterState, childTurnId: landed.afterState.childTurnId + 1 };
    if (fault === "delayed start") landed.afterStartMs += 101;
    if (fault === "old output") landed.output.atMs = 1;
    if (fault === "expired schedule")
      landed.atMs = landed.trigger.atMs + (landed.trigger.detail as { delayMs: number }).delayMs;
    if (fault === "cancelled request") {
      f.events.splice(landed.cursor.offset - 1, 0, { ...landed.trigger, type: "classifier.cancelled" });
      landed.cursor.offset++;
    }
    expect(() => assertInjectionWindow(f.report(), landed)).toThrow();
  },
);
it("bounded cancellation starvation remains unresolved and cannot count as recovery", () => {
  const f = windowFixture();
  const landed = attemptWindowInjection(f.request)!;
  f.event("tutor_stabilization.cancelled", 160, { reason: "child_turn_started" });
  f.event("microphone.activity_started", 160, {});
  f.event("microphone.activity_discarded", 200, {});
  const summary = butterflySummary(f.report(), landed, 8200, false);
  expect(summary.safetyFailure).toBeNull();
  expect(summary.outcome).toBe("bounded-starvation-or-pending");
  expect(summary.recoveryVerified).toBe(false);
  expect(summary.work?.cancelled).toBe(1);
  expect(summary.activity?.map(e => e.type)).toEqual(["microphone.activity_started", "microphone.activity_discarded"]);
  expect(() => assertButterflySafety(f.report(), landed, true)).toThrow(/genuine interruption/);
});
it("absent trigger and provider failures cannot masquerade as successful evidence", () => {
  const f = windowFixture();
  expect(butterflySummary(f.report(), null, 8200, false).outcome).toBe("incomplete-trigger");
  const landed = attemptWindowInjection(f.request)!;
  f.event("classifier.error", 200, { reason: "network" });
  expect(butterflySummary(f.report(), landed, 8200, false).outcome).toBe("unsafe-or-incomplete");
});

it("never cancels still-playing answer audio to hit an output window", () => {
  const f = windowFixture();
  const host = window as unknown as { syntheticMicrophone: { state: () => { activeSources: number } } };
  host.syntheticMicrophone.state = () => ({ activeSources: 1 });
  expect(attemptWindowInjection(f.request)).toBeNull();
  expect(f.speech).not.toHaveBeenCalled();
});
it("polling cancellation and a missed window never start audio", async () => {
  const { injectInWindow } = await import("./helpers/injection-window");
  const f = windowFixture();
  const evaluate = vi.fn(async () => null);
  const page = { evaluate } as unknown as import("@playwright/test").Page;
  const abort = new AbortController();
  abort.abort(new Error("attempt cancelled"));
  await expect(injectInWindow(page, f.request, abort.signal, 100)).rejects.toThrow(/attempt cancelled/);
  expect(evaluate).not.toHaveBeenCalled();
  await expect(injectInWindow(page, f.request, new AbortController().signal, 0)).rejects.toThrow(
    /Missed current.*no audio injected/,
  );
  expect(f.speech).not.toHaveBeenCalled();
});
it("readable summary identifies the audio/window/work without claiming unresolved recovery", async () => {
  const { formatButterflySummary } = await import("./browser/live/butterfly-evidence");
  const f = windowFixture();
  const landed = attemptWindowInjection(f.request)!;
  f.event("microphone.activity_started", 160, {});
  f.event("microphone.activity_discarded", 200, {});
  const text = formatButterflySummary("filler-output", butterflySummary(f.report(), landed, 8200, false), true);
  expect(text).toContain('Injected: {"fixture":"uh"}');
  expect(text).toContain("Window: during-output");
  expect(text).toContain("bounded-starvation-or-pending");
  expect(text).toContain("Safe completion verified: false");
  expect(text).toContain("VAD/runtime");
});

it("does not require ASR to preserve hesitation filler when the current tentative total is heard", () => {
  const f = windowFixture();
  f.events[0].detail = { transcript: "Child: I think there are three butterflies." };
  expect(attemptWindowInjection(f.request)).not.toBeNull();
  expect(f.speech).toHaveBeenCalledExactlyOnceWith("uh");
});
it("diagnoses confirmed VAD plus tutor paraphrase without learner transcription, and never injects", () => {
  const f = windowFixture("confirmation-quiet");
  f.events.splice(
    f.events.findIndex(e => e.transcriptSpeaker === "child"),
    1,
  );
  f.state.hasChildTranscript = false;
  f.event("classifier.blocked", 130, { reason: "missing_current_turn_child_transcript" });
  f.events.find(e => e.transcriptSpeaker === "tutor")!.detail = {
    transcript: "Tutor: I heard you say three. Yes, there are three butterflies.",
  };
  expect(attemptWindowInjection(f.request)).toBeNull();
  const missed = diagnoseWindowMiss(f.request);
  expect(missed.reason).toBe("missing_current_turn_child_transcript");
  expect(missed).toMatchObject({
    childSnapshot: null,
    hasChildTranscript: false,
    blocked: { detail: { reason: "missing_current_turn_child_transcript" } },
  });
  expect(f.speech).not.toHaveBeenCalled();
});

it.each(["confirmation-quiet", "classifier-in-flight"] as const)(
  "accepts fragmented live transcripts without hesitation words in %s",
  timing => {
    const f = windowFixture(timing);
    const transcript =
      "Tutor: How many butterflies do you see?\nChild: Three\nTutor: Yes\nChild: ! There are\nTutor: , three\nChild: three butterflies\nTutor: butterflies.";
    f.events.find(e => e.transcriptSpeaker === "child")!.detail = { transcript };
    f.events.find(e => e.transcriptSpeaker === "tutor")!.detail = { transcript };
    const landed = attemptWindowInjection(f.request)!;
    expect(landed).not.toBeNull();
    expect(f.speech).toHaveBeenCalledExactlyOnceWith("uh");
    assertInjectionWindow(f.report(), landed);
  },
);
it.each([
  "earlier child",
  "earlier tutor",
  "another visit",
  "prefix mismatch",
  "tutor-only total",
  "child-only confirmation",
])("fragment reconstruction cannot borrow %s evidence", fault => {
  const f = windowFixture("confirmation-quiet");
  const child = f.events.find(e => e.transcriptSpeaker === "child")!;
  const tutor = f.events.find(e => e.transcriptSpeaker === "tutor")!;
  if (fault === "earlier child" || fault === "earlier tutor" || fault === "prefix mismatch") {
    const old = "Child: Three.\nTutor: Yes, three butterflies.";
    f.events.unshift({ ...child, childTurnId: 0, atMs: 0, detail: { transcript: old } });
    f.request.from.after.offset = 1;
    child.detail = { transcript: old + "\nChild: " + (fault === "earlier child" ? "Okay." : "Three.") };
    tutor.detail = {
      transcript:
        (child.detail as { transcript: string }).transcript +
        "\nTutor: " +
        (fault === "earlier tutor" ? "Try again." : "Yes, three butterflies."),
    };
    if (fault === "prefix mismatch") child.detail = { transcript: "Child: Three." };
  }
  if (fault === "another visit") child.visitId = 2;
  if (fault === "tutor-only total") child.detail = { transcript: "Child: Okay.\nTutor: Three." };
  if (fault === "child-only confirmation")
    tutor.detail = { transcript: "Child: Yes, three butterflies.\nTutor: Try again." };
  expect(attemptWindowInjection(f.request)).toBeNull();
  expect(f.speech).not.toHaveBeenCalled();
});
it("does not reuse a correct answer from an intervening older turn after the checkpoint", () => {
  const f = windowFixture("confirmation-quiet");
  const child = f.events.find(e => e.transcriptSpeaker === "child")!;
  f.events.unshift({ ...child, childTurnId: 0, atMs: 0, detail: { transcript: "Child: Three." } });
  child.detail = { transcript: "Child: Three.\nChild: Okay." };
  expect(attemptWindowInjection(f.request)).toBeNull();
  expect(f.speech).not.toHaveBeenCalled();
});
