import { afterEach, expect, it, vi } from "vitest";
import {
  AnswerRecovery,
  ANSWER_RECOVERY_WAIT_MS,
  ANSWER_COMPLETION_WAIT_MS,
} from "../lib/lesson-runtime/answer-recovery";
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

it("allows one faster completion prompt after the visit's support recovery was spent", async () => {
  vi.useFakeTimers();
  const request = vi.fn();
  const recovery = new AnswerRecovery(request, vi.fn());
  const held = { ...state(), hasChildTranscript: true, transcriptRevision: 3 };
  recovery.armSemanticHold(held, true, classificationSource(held)!);
  await vi.advanceTimersByTimeAsync(ANSWER_RECOVERY_WAIT_MS);
  expect(request).toHaveBeenCalledOnce();
  const completed = { ...held, childTurnId: 3, transcriptRevision: 4 };
  recovery.armSemanticHold(completed, true, classificationSource(completed)!, true);
  await vi.advanceTimersByTimeAsync(ANSWER_COMPLETION_WAIT_MS - 1);
  expect(request).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenLastCalledWith(classificationSource(completed));
  recovery.armSemanticHold(
    { ...completed, transcriptRevision: 5 },
    true,
    classificationSource({ ...completed, transcriptRevision: 5 })!,
    true,
  );
  await vi.advanceTimersByTimeAsync(5000);
  expect(request).toHaveBeenCalledTimes(2);
});

it("cancels completion guidance on new speech and waits for audio quiet before rearming", async () => {
  vi.useFakeTimers();
  const request = vi.fn();
  const recovery = new AnswerRecovery(request, vi.fn());
  const held = { ...state(), hasChildTranscript: true, transcriptRevision: 3 };
  recovery.armSemanticHold(held, true, classificationSource(held)!, true);
  await vi.advanceTimersByTimeAsync(500);
  recovery.observe({ ...held, childSpeaking: true }, true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(request).not.toHaveBeenCalled();
  const active = { ...held, outputActivity: "active" as const };
  recovery.armSemanticHold(active, true, classificationSource(active)!, true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(request).not.toHaveBeenCalled();
  recovery.observe(held, true);
  await vi.advanceTimersByTimeAsync(ANSWER_COMPLETION_WAIT_MS);
  expect(request).toHaveBeenCalledOnce();
});

it("keeps missing-text recovery through discarded candidates but never sends during activity", async () => {
  vi.useFakeTimers();
  const request = vi.fn();
  const recovery = new AnswerRecovery(request, vi.fn(), true);
  const initial = state();
  recovery.arm(initial, true);
  for (let turn = 3; turn <= 5; turn++) {
    await vi.advanceTimersByTimeAsync(1000);
    const candidate = {
      ...initial,
      childTurnId: turn,
      childSpeaking: true,
      childCandidate: { hasChildTranscript: false, tutorOutputObserved: false },
    };
    recovery.observe(candidate, true);
    await vi.advanceTimersByTimeAsync(200);
    recovery.observe({ ...initial, childTurnId: turn }, true);
  }
  await vi.advanceTimersByTimeAsync(300);
  const candidate = {
    ...initial,
    childTurnId: 6,
    childSpeaking: true,
    childCandidate: { hasChildTranscript: false, tutorOutputObserved: false },
  };
  recovery.observe(candidate, true);
  await vi.advanceTimersByTimeAsync(200);
  expect(request).not.toHaveBeenCalled();
  recovery.observe({ ...initial, childTurnId: 6 }, true);
  await vi.advanceTimersByTimeAsync(0);
  expect(request).toHaveBeenCalledExactlyOnceWith({
    runtimeId: initial.runtimeId,
    nodeId: initial.nodeId,
    visitId: initial.visitId,
    childTurnId: 6,
    transcriptRevision: initial.transcriptRevision,
  });
});

it("still cancels preserved missing-text recovery on confirmed speech or late child words", async () => {
  vi.useFakeTimers();
  const request = vi.fn();
  const recovery = new AnswerRecovery(request, vi.fn(), true);
  const initial = state();
  recovery.arm(initial, true);
  const candidate = {
    ...initial,
    childTurnId: 3,
    childSpeaking: true,
    childCandidate: { hasChildTranscript: false, tutorOutputObserved: false },
  };
  recovery.observe(candidate, true);
  recovery.observe({ ...candidate, childCandidate: null }, true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(request).not.toHaveBeenCalled();
  recovery.arm(initial, true);
  recovery.observe({ ...initial, hasChildTranscript: true }, true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(request).not.toHaveBeenCalled();
});

it("repairs the recorded exogram fragment once after new tutor text, without learner speech", async () => {
  // Session 563329ad: revision 66 ('That's right') received completion recovery;
  // revision 68 ('Okay. That's') remained held, then candidates repeated it.
  vi.useFakeTimers();
  const request = vi.fn();
  const recovery = new AnswerRecovery(request, vi.fn(), true, () => false);
  const confirmed = {
    ...state(),
    hasChildTranscript: true,
    transcriptRevision: 66,
    transcriptSource: "child" as const,
  };
  recovery.armSemanticHold(confirmed, true, classificationSource(confirmed)!, true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(request).toHaveBeenCalledTimes(1);
  const fragment = { ...confirmed, transcriptRevision: 68, transcriptSource: "tutor" as const };
  recovery.armSemanticHold(fragment, true, classificationSource(fragment)!, true);
  await vi.advanceTimersByTimeAsync(3999);
  expect(request).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(request).toHaveBeenCalledTimes(2);
  for (const revision of [68, 69, 70]) {
    const repeated = { ...fragment, transcriptRevision: revision, childTurnId: revision };
    recovery.armSemanticHold(repeated, true, classificationSource(repeated)!, true);
    await vi.advanceTimersByTimeAsync(10000);
  }
  expect(request).toHaveBeenCalledTimes(2);
});

it.each(["speech", "active audio", "stop", "new visit"])("cancels completion repair on %s", async change => {
  vi.useFakeTimers();
  const request = vi.fn();
  const recovery = new AnswerRecovery(request, vi.fn(), true, () => false);
  const initial = { ...state(), hasChildTranscript: true, transcriptRevision: 66 };
  recovery.armSemanticHold(initial, true, classificationSource(initial)!, true);
  await vi.advanceTimersByTimeAsync(1000);
  const fragment = { ...initial, transcriptSource: "tutor" as const, transcriptRevision: 68 };
  recovery.armSemanticHold(fragment, true, classificationSource(fragment)!, true);
  await vi.advanceTimersByTimeAsync(3999);
  recovery.observe(
    {
      ...fragment,
      ...(change === "speech"
        ? { childSpeaking: true }
        : change === "active audio"
          ? { outputActivity: "active" as const }
          : change === "stop"
            ? { phase: "stopped" as const }
            : { visitId: 2 }),
    },
    true,
  );
  await vi.advanceTimersByTimeAsync(10000);
  expect(request).toHaveBeenCalledTimes(1);
});
