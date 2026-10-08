import { afterEach, expect, it, vi } from "vitest";
import { SupportClarification } from "../lib/lesson-runtime/support-clarification";
import { classificationSource, createLessonRuntime } from "./helpers/counting-runtime";

const state = () => ({
  ...createLessonRuntime("runtime"),
  childTurnId: 1,
  hasChildTurn: true,
  hasChildTranscript: true,
  transcriptRevision: 3,
  transcriptSource: "tutor" as const,
  outputActivity: "quiet" as const,
  tutorOutputObserved: true,
  tutorOutputDrained: true,
});
afterEach(() => vi.useRealTimers());
it.each([
  { runtimeId: "different" },
  { nodeId: "count-2-ducks" as const },
  { visitId: 2 },
  { childTurnId: 2 },
  { transcriptRevision: 4 },
  { phase: "rendering" as const },
  { childSpeaking: true },
  { hasChildTranscript: false },
  { tutorOutputDrained: false },
  { tutorOutputObserved: false },
  { outputActivity: "active" as const },
])("cancels on identity/eligibility change %j without rearming identical evidence", async change => {
  vi.useFakeTimers();
  const request = vi.fn();
  const gate = new SupportClarification(request, vi.fn());
  const initial = state();
  const source = classificationSource(initial)!;
  gate.consider(initial, true, source);
  gate.observe({ ...initial, ...change }, true);
  gate.consider(initial, true, source);
  await vi.advanceTimersByTimeAsync(10000);
  expect(request).not.toHaveBeenCalled();
});
it("requires exact source and enabled runtime, and gives a new visit a fresh one-request budget", async () => {
  vi.useFakeTimers();
  const request = vi.fn();
  const gate = new SupportClarification(request, vi.fn());
  const initial = state();
  const source = classificationSource(initial)!;
  gate.consider(initial, false, source);
  gate.consider(initial, true, { ...source, transcriptRevision: 99 });
  await vi.advanceTimersByTimeAsync(5000);
  expect(request).not.toHaveBeenCalled();
  gate.consider(initial, true, source);
  await vi.advanceTimersByTimeAsync(4000);
  expect(request).toHaveBeenCalledOnce();
  gate.cancel("node_visit_changed");
  const next = { ...initial, visitId: 2, nodeId: "count-2-ducks" as const };
  gate.consider(next, true, classificationSource(next)!);
  await vi.advanceTimersByTimeAsync(4000);
  expect(request).toHaveBeenCalledTimes(2);
});
