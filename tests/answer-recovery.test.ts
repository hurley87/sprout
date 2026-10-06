import { afterEach, expect, it, vi } from "vitest";
import { AnswerRecovery, ANSWER_RECOVERY_WAIT_MS } from "../lib/lesson-runtime/answer-recovery";
import { createLessonRuntime, classificationSource } from "./helpers/counting-runtime";

const state = () => ({
  ...createLessonRuntime("runtime"),
  childTurnId: 2,
  hasChildTurn: true,
  outputActivity: "quiet" as const,
});
afterEach(() => vi.useRealTimers());

it("recovers a current semantic hold with the same one-request visit budget as missing text", async () => {
  vi.useFakeTimers();
  const request = vi.fn();
  const diagnostics = vi.fn();
  const recovery = new AnswerRecovery(request, diagnostics);
  const held = { ...state(), hasChildTranscript: true, transcriptRevision: 3, transcriptSource: "child" as const };
  recovery.armSemanticHold(held, true, classificationSource(held)!);
  await vi.advanceTimersByTimeAsync(3999);
  expect(request).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(request).toHaveBeenCalledExactlyOnceWith(classificationSource(held));
  expect(diagnostics).toHaveBeenCalledWith("answer_recovery.requested", classificationSource(held), {
    reason: "semantic_hold",
    waitMs: 4000,
  });
  recovery.arm({ ...state(), childTurnId: 3 }, true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(request).toHaveBeenCalledOnce();
});

it("rejects a stale held response and cancels a pending semantic recovery on a newer revision", async () => {
  vi.useFakeTimers();
  const request = vi.fn();
  const recovery = new AnswerRecovery(request, vi.fn());
  const held = { ...state(), hasChildTranscript: true, transcriptRevision: 3 };
  recovery.armSemanticHold(held, true, { ...classificationSource(held)!, transcriptRevision: 2 });
  await vi.advanceTimersByTimeAsync(5000);
  expect(request).not.toHaveBeenCalled();
  recovery.armSemanticHold(held, true, classificationSource(held)!);
  await vi.advanceTimersByTimeAsync(3999);
  recovery.observe({ ...held, transcriptRevision: 4 }, true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(request).not.toHaveBeenCalled();
});

it("waits for sustained quiet, follows tutor revisions, and requests once per visit", async () => {
  vi.useFakeTimers();
  const request = vi.fn();
  const recovery = new AnswerRecovery(request, vi.fn());
  const initial = state();
  recovery.arm(initial, true);
  await vi.advanceTimersByTimeAsync(3000);
  recovery.observe({ ...initial, outputActivity: "active" }, true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(request).not.toHaveBeenCalled();
  const quiet = { ...initial, transcriptRevision: 4, transcriptSource: "tutor" as const };
  recovery.observe(quiet, true);
  await vi.advanceTimersByTimeAsync(3999);
  expect(request).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(request).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ childTurnId: 2, transcriptRevision: 4 }));
  recovery.arm({ ...quiet, childTurnId: 3 }, true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(request).toHaveBeenCalledOnce();
  recovery.arm({ ...quiet, visitId: 2, nodeId: "count-2-ducks" }, true);
  await vi.advanceTimersByTimeAsync(4000);
  expect(request).toHaveBeenCalledTimes(2);
});

it.each([
  { hasChildTranscript: true },
  { childSpeaking: true },
  { childTurnId: 3 },
  { visitId: 2 },
  { phase: "stopped" as const },
])("cancels when missing-turn eligibility changes: %j", async change => {
  vi.useFakeTimers();
  const request = vi.fn();
  const recovery = new AnswerRecovery(request, vi.fn());
  recovery.arm(state(), true);
  await vi.advanceTimersByTimeAsync(1000);
  recovery.observe({ ...state(), ...change }, true);
  await vi.advanceTimersByTimeAsync(ANSWER_RECOVERY_WAIT_MS);
  expect(request).not.toHaveBeenCalled();
});

it("never arms for untouched silence or a candidate, and cancels when disabled", async () => {
  vi.useFakeTimers();
  const request = vi.fn();
  const recovery = new AnswerRecovery(request, vi.fn());
  recovery.arm(createLessonRuntime("runtime"), true);
  await vi.advanceTimersByTimeAsync(5000);
  recovery.arm({ ...state(), childCandidate: { hasChildTranscript: false, tutorOutputObserved: false } }, true);
  await vi.advanceTimersByTimeAsync(5000);
  recovery.arm(state(), true);
  recovery.observe(state(), false);
  await vi.advanceTimersByTimeAsync(5000);
  expect(request).not.toHaveBeenCalled();
});

it("spends the request budget even when sending fails", async () => {
  vi.useFakeTimers();
  const request = vi.fn(); // Runtime catches transport failure inside this callback.
  const recovery = new AnswerRecovery(request, vi.fn());
  recovery.arm(state(), true);
  await vi.advanceTimersByTimeAsync(4000);
  recovery.cancel("send_failed");
  recovery.arm({ ...state(), childTurnId: 3 }, true);
  await vi.advanceTimersByTimeAsync(4000);
  expect(request).toHaveBeenCalledOnce();
});
