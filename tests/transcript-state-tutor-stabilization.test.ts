import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLessonRuntime, type LessonRuntimeState } from "./helpers/counting-runtime";
import { TutorStabilizationGate, type TutorStabilizationDiagnostic } from "../lib/lesson-runtime/tutor-stabilization";

const timing = { tutorTranscriptStableMs: 600, tutorClassificationQuietMs: 500 };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

function setup(patch: Partial<LessonRuntimeState> = {}) {
  let state: LessonRuntimeState = {
    ...createLessonRuntime("test-runtime"),
    childTurnId: 1,
    hasChildTurn: true,
    hasChildTranscript: true,
    transcriptRevision: 2,
    transcriptSource: "tutor",
    outputActivity: "active",
    ...patch,
  };
  const ready = vi.fn();
  const diagnostics: TutorStabilizationDiagnostic[] = [];
  const gate = new TutorStabilizationGate(
    timing,
    () => Date.now(),
    ready,
    event => diagnostics.push(event),
  );
  const observe = (next: Partial<LessonRuntimeState> = {}, enabled = true) => {
    state = { ...state, ...next };
    gate.observe(state, enabled, "local_event");
  };
  observe();
  return { gate, ready, diagnostics, observe };
}

describe("lesson tutor classification boundary", () => {
  it("stabilizes an interrupted exchange without waiting for missing-text recovery", () => {
    const { ready } = setup({
      hasChildTranscript: false,
      interruptedExchange: { tutorOutputObserved: true, ready: false },
      outputActivity: "quiet",
    });
    vi.advanceTimersByTime(599);
    expect(ready).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(ready).toHaveBeenCalledOnce();
  });

  it("does not stabilize missing text without observed tutor output from an exchange", () => {
    const { ready } = setup({
      hasChildTranscript: false,
      interruptedExchange: { tutorOutputObserved: false, ready: false },
      outputActivity: "quiet",
    });
    vi.advanceTimersByTime(6000);
    expect(ready).not.toHaveBeenCalled();
  });

  it("does not classify a partial tutor transcript or a 350 ms pause while audio remains active", () => {
    const { observe, ready, diagnostics } = setup();
    vi.advanceTimersByTime(350);
    expect(ready).not.toHaveBeenCalled();
    observe({ transcriptRevision: 3 });
    vi.advanceTimersByTime(2000);
    expect(ready).not.toHaveBeenCalled();
    expect(diagnostics.at(-1)).toMatchObject({
      type: "tutor_stabilization.waiting_for_quiet",
      revision: 3,
      thresholds: timing,
    });
  });

  it("resets continuous quiet when briefly quiet output resumes", () => {
    const { observe, ready, diagnostics } = setup();
    vi.advanceTimersByTime(600);
    observe({ outputActivity: "quiet" });
    vi.advanceTimersByTime(400);
    observe({ outputActivity: "active" });
    vi.advanceTimersByTime(1000);
    expect(ready).not.toHaveBeenCalled();
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ type: "tutor_stabilization.cancelled", reason: "output_active" }),
    );
    observe({ outputActivity: "quiet" });
    vi.advanceTimersByTime(499);
    expect(ready).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(ready).toHaveBeenCalledOnce();
    expect(diagnostics.at(-1)).toMatchObject({ type: "tutor_stabilization.ready", quietDurationMs: 500 });
  });

  it("cancels the scheduled revision and restarts stability when tutor text continues", () => {
    const { observe, ready, diagnostics } = setup({ outputActivity: "quiet" });
    vi.advanceTimersByTime(500);
    observe({ transcriptRevision: 3 });
    vi.advanceTimersByTime(100); // The superseded revision's original deadline.
    expect(ready).not.toHaveBeenCalled();
    vi.advanceTimersByTime(499);
    expect(ready).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(ready).toHaveBeenCalledOnce();
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        type: "tutor_stabilization.cancelled",
        revision: 2,
        reason: "newer_transcript_snapshot",
        transcriptStableDurationMs: 500,
      }),
    );
    expect(diagnostics.at(-1)).toMatchObject({
      type: "tutor_stabilization.ready",
      revision: 3,
      transcriptStableDurationMs: 600,
    });
  });

  it("starts exactly once for stable text plus sustained quiet, even on repeated observations", () => {
    const { observe, ready, diagnostics } = setup({ outputActivity: "quiet" });
    vi.advanceTimersByTime(599);
    expect(ready).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    observe();
    vi.advanceTimersByTime(2000);
    observe({ outputActivity: "active" });
    observe({ outputActivity: "quiet" });
    vi.advanceTimersByTime(1000);
    expect(ready).toHaveBeenCalledOnce();
    expect(diagnostics.filter(event => event.type === "tutor_stabilization.ready")).toHaveLength(1);
  });

  it("uses an already-running quiet interval when the later transcript stabilizes", () => {
    const { observe, ready, diagnostics } = setup({
      outputActivity: "quiet",
      transcriptSource: "child",
      transcriptRevision: 1,
    });
    vi.advanceTimersByTime(1000);
    observe({ transcriptSource: "tutor", transcriptRevision: 2 });
    vi.advanceTimersByTime(500);
    observe({ outputActivity: "quiet" }); // Repeated quiet must not restart that interval.
    vi.advanceTimersByTime(99);
    expect(ready).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(ready).toHaveBeenCalledOnce();
    expect(diagnostics.at(-1)).toMatchObject({ transcriptStableDurationMs: 600, quietDurationMs: 1600 });
  });

  it("waits only for classification quiet when the transcript is already stable", () => {
    const { observe, ready, diagnostics } = setup();
    vi.advanceTimersByTime(1000);
    observe({ outputActivity: "quiet" });
    vi.advanceTimersByTime(499);
    expect(ready).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(ready).toHaveBeenCalledOnce();
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ type: "tutor_stabilization.scheduled", delayMs: 500 }),
    );
  });

  it.each([
    { childSpeaking: true, childTurnId: 2, hasChildTranscript: false },
    { phase: "rendering", visitId: 2, nodeId: "count-2-ducks", hasChildTranscript: false },
    { phase: "stopped" },
  ] satisfies Partial<LessonRuntimeState>[])("makes pending work inert on interruption %j", patch => {
    const { observe, ready, diagnostics } = setup({ outputActivity: "quiet" });
    vi.advanceTimersByTime(400);
    observe(patch);
    vi.advanceTimersByTime(5000);
    expect(ready).not.toHaveBeenCalled();
    expect(diagnostics).toContainEqual(expect.objectContaining({ type: "tutor_stabilization.cancelled", revision: 2 }));
  });

  it("holds classification without child evidence or when the visit is disabled", () => {
    const { observe, ready } = setup({ outputActivity: "quiet", hasChildTranscript: false });
    vi.advanceTimersByTime(1000);
    expect(ready).not.toHaveBeenCalled();
    observe({ hasChildTranscript: true }, false);
    vi.advanceTimersByTime(1000);
    expect(ready).not.toHaveBeenCalled();
  });

  it("retains the actual transcript stability clock while child speech blocks eligibility", () => {
    const { observe, ready } = setup({ outputActivity: "quiet", childSpeaking: true });
    vi.advanceTimersByTime(700);
    expect(ready).not.toHaveBeenCalled();
    observe({ childSpeaking: false });
    expect(ready).toHaveBeenCalledOnce();
  });

  it("does not treat unavailable output as quiet or carry its previous quiet interval", () => {
    const { observe, ready } = setup({ outputActivity: "quiet" });
    vi.advanceTimersByTime(400);
    observe({ outputActivity: "unavailable" });
    vi.advanceTimersByTime(1000);
    expect(ready).not.toHaveBeenCalled();
    observe({ outputActivity: "quiet" });
    vi.advanceTimersByTime(499);
    expect(ready).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(ready).toHaveBeenCalledOnce();
  });
});
