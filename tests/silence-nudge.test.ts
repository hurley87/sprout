import { afterEach, expect, it, vi } from "vitest";
import { DINO_CAR_CRUNCH_LESSON } from "../lib/lesson-runtime/dino-car-crunch-lesson";
import { validateLessonDefinition, type LessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import { createLessonRuntime, type LessonRuntimeState } from "../lib/lesson-runtime/lesson-runtime-reducer";
import { awaitingFirstLearnerTurn, SilenceNudge } from "../lib/lesson-runtime/silence-nudge";

const lesson: LessonDefinition = {
  ...DINO_CAR_CRUNCH_LESSON,
  silenceNudges: [
    { afterQuietMs: 7_000, instruction: "Re-ask out loud." },
    { afterQuietMs: 12_000, instruction: "Check in once." },
  ],
};
const waiting = (overrides: Partial<LessonRuntimeState> = {}): LessonRuntimeState => ({
  ...createLessonRuntime("runtime", { lesson }),
  outputActivity: "quiet",
  transcriptSource: "tutor",
  transcriptRevision: 1,
  ...overrides,
});
const candidate = { hasChildTranscript: false, tutorOutputObserved: true };
const setup = () => {
  const request = vi.fn();
  const diagnostics = vi.fn();
  return { request, diagnostics, nudge: new SilenceNudge(lesson, request, diagnostics) };
};
/** The tutor asks (output heard on this visit), then goes quiet. */
const asked = (nudge: SilenceNudge, overrides: Partial<LessonRuntimeState> = {}) => {
  nudge.observe(waiting({ ...overrides, outputActivity: "active" }), true);
  nudge.observe(waiting(overrides), true);
};
afterEach(() => vi.useRealTimers());

it("waits only for a silent learner after the tutor has spoken and gone quiet", () => {
  expect(awaitingFirstLearnerTurn(waiting(), lesson)).toBe(true);
  for (const blocked of [
    { transcriptSource: "unknown" as const },
    { outputActivity: "active" as const },
    { hasChildTurn: true },
    { childSpeaking: true },
    { childCandidate: candidate },
    { answerAccepted: true },
    { phase: "rendering" as const },
    { conversationAdvanceRequested: "learner" as const },
  ])
    expect(awaitingFirstLearnerTurn(waiting(blocked), lesson)).toBe(false);
});

it("sends each authored step once per visit, in order, after its own silence", async () => {
  vi.useFakeTimers();
  const { request, nudge } = setup();
  asked(nudge);
  await vi.advanceTimersByTimeAsync(6_999);
  expect(request).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(request).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ visitId: 1 }), 0, lesson.silenceNudges![0]);

  // The tutor speaks the nudge, then goes quiet again: the second step needs its own full wait.
  asked(nudge);
  await vi.advanceTimersByTimeAsync(11_999);
  expect(request).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ visitId: 1 }), 1, lesson.silenceNudges![1]);

  asked(nudge);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(request).toHaveBeenCalledTimes(2);
});

it("restarts the wait on any learner activity, including a discarded microphone burst", async () => {
  vi.useFakeTimers();
  const { request, diagnostics, nudge } = setup();
  asked(nudge);
  await vi.advanceTimersByTimeAsync(5_000);
  nudge.observe(waiting({ childCandidate: candidate }), true);
  nudge.observe(waiting(), true);
  await vi.advanceTimersByTimeAsync(6_999);
  expect(request).not.toHaveBeenCalled();
  expect(diagnostics).toHaveBeenCalledWith("silence_nudge.cancelled", expect.anything(), {
    step: 0,
    reason: "learner_or_tutor_activity",
  });
  await vi.advanceTimersByTimeAsync(1);
  expect(request).toHaveBeenCalledOnce();
});

it("never nudges once the learner has taken a turn, while disabled, or after cancellation", async () => {
  vi.useFakeTimers();
  const { request, nudge } = setup();
  asked(nudge, { hasChildTurn: true, childTurnId: 1 });
  await vi.advanceTimersByTimeAsync(60_000);
  nudge.observe(waiting(), false);
  await vi.advanceTimersByTimeAsync(60_000);
  asked(nudge);
  nudge.cancel("stop");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(request).not.toHaveBeenCalled();
});

it("gives a new visit its own budget", async () => {
  vi.useFakeTimers();
  const { request, nudge } = setup();
  asked(nudge);
  await vi.advanceTimersByTimeAsync(7_000);
  // A stale tutor transcript from the last scene is not a question on this one.
  nudge.observe(waiting({ visitId: 2, nodeId: "twenty-three" }), true);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(request).toHaveBeenCalledOnce();
  asked(nudge, { visitId: 2, nodeId: "twenty-three" });
  await vi.advanceTimersByTimeAsync(7_000);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ visitId: 2 }), 0, lesson.silenceNudges![0]);
});

it("does nothing for a lesson without authored nudges", async () => {
  vi.useFakeTimers();
  const request = vi.fn();
  asked(new SilenceNudge(DINO_CAR_CRUNCH_LESSON, request, vi.fn()));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(request).not.toHaveBeenCalled();
});

it("validates authored nudges", () => {
  const withNudges = (silenceNudges: unknown) =>
    validateLessonDefinition({ ...DINO_CAR_CRUNCH_LESSON, silenceNudges } as LessonDefinition);
  expect(() => withNudges(lesson.silenceNudges)).not.toThrow();
  for (const invalid of [
    [{ afterQuietMs: 2_999, instruction: "Too soon." }],
    [{ afterQuietMs: 60_001, instruction: "Too late." }],
    [{ afterQuietMs: 7_000, instruction: " " }],
    Array.from({ length: 4 }, () => ({ afterQuietMs: 7_000, instruction: "Too many." })),
  ])
    expect(() => withNudges(invalid)).toThrow(/Silence nudges/);
});
