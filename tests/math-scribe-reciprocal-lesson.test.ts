import { afterEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { validateLessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import { resolveLessonDefinition } from "../lib/lesson-runtime/lesson-registry";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import { MATH_SCRIBE_LESSON } from "../lib/lesson-runtime/math-scribe-lesson";
import { MATH_SCRIBE_RECIPROCAL_LESSON } from "../lib/lesson-runtime/math-scribe-reciprocal-lesson";
import { providerEvents, useRuntimeFakeTimers } from "./helpers/runtime-harness";

const transport = vi.hoisted(() => ({
  receive: undefined as ((event: ProviderEvent) => void) | undefined,
  send: vi.fn<(command: ClientCommand) => void>(),
  close: vi.fn(),
  start: vi.fn<(lessonId: string) => void>(),
  setOutputAudible: vi.fn<(audible: boolean) => void>(),
}));

vi.mock("../lib/browser-transport", async () => {
  const { mockBrowserTransport } = await import("./helpers/runtime-harness");
  return { BrowserTransport: mockBrowserTransport(transport) };
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("validates and registers the single-problem lesson with inherited guidance", () => {
  const lesson = MATH_SCRIBE_RECIPROCAL_LESSON;
  expect(validateLessonDefinition(lesson)).toEqual(lesson);
  expect(resolveLessonDefinition("math-scribe-reciprocal")).toBe(lesson);
  expect(lesson.initialNodeId).toBe("reciprocal");
  expect(Object.keys(lesson.nodes)).toEqual(["reciprocal", "recap"]);
  expect(lesson.nodes.reciprocal.onSuccess).toEqual({ kind: "node", nodeId: "recap" });
  expect(lesson.nodes.recap).toBe(MATH_SCRIBE_LESSON.nodes.recap);
  expect(lesson.tutor).toEqual(MATH_SCRIBE_LESSON.tutor);
  expect(lesson.recovery).toEqual(MATH_SCRIBE_LESSON.recovery);
  expect(lesson.classifier).toEqual(MATH_SCRIBE_LESSON.classifier);
  expect(lesson.gateTutorAudio).toBe(MATH_SCRIBE_LESSON.gateTutorAudio);
});

it("navigates from reciprocal directly to the scribe recap", async () => {
  useRuntimeFakeTimers();
  const runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, MATH_SCRIBE_RECIPROCAL_LESSON);
  try {
    runtime.confirmRendered(runtime.snapshot().display);
    const events = providerEvents(event => transport.receive!(event));
    events.acknowledgeSteering(transport.send.mock.calls.at(-1)![0].event_id, 0);
    expect(transport.start).toHaveBeenCalledWith("math-scribe-reciprocal");
    expect(runtime.snapshot().scribe?.problem?.id).toBe("reciprocal");

    events.childTurn("next problem", 100);
    transport.receive!({ type: "output.activity", state: "quiet" });
    await vi.advanceTimersByTimeAsync(1000);

    expect(runtime.snapshot().runtime?.nodeId).toBe("recap");
    runtime.confirmRendered(runtime.snapshot().display);
    expect(runtime.snapshot().recapText).toBe("Thanks for practicing.");
    expect(transport.send.mock.calls.at(-1)![0]).toMatchObject({
      type: "session.instructions.append",
      content: expect.stringContaining("Thanks for practicing."),
    });
  } finally {
    runtime.stop();
  }
});
