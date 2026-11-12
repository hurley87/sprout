import { afterEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { GARDEN_RESCUE_LESSON } from "../lib/lesson-runtime/garden-rescue-lesson";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import { providerEvents, useRuntimeFakeTimers } from "./helpers/runtime-harness";

const transport = vi.hoisted(() => ({
  receive: undefined as ((event: ProviderEvent) => void) | undefined,
  send: vi.fn<(command: ClientCommand) => void>(),
  close: vi.fn(),
}));
vi.mock("../lib/browser-transport", async () => {
  const { mockBrowserTransport } = await import("./helpers/runtime-harness");
  return { BrowserTransport: mockBrowserTransport(transport) };
});
let runtime: LessonRuntime;
afterEach(() => {
  runtime?.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("sends one close and records its cancellation on stop", async () => {
  useRuntimeFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const input = JSON.parse(init.body as string);
      return Response.json({
        proposal: {
          nodeId: input.nodeId,
          transcriptRevision: input.transcriptRevision,
          childActivity: "unknown",
          answerOutcome: "incorrect",
          answerCommitment: "committed",
          supportState: "none",
          tutorState: "unknown",
        },
      });
    }),
  );
  runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, GARDEN_RESCUE_LESSON);
  runtime.confirmRendered(runtime.snapshot().display);
  const events = providerEvents(event => transport.receive!(event));
  const initial = transport.send.mock.calls[0][0];
  events.acknowledgeSteering(initial.event_id, 0);
  for (let i = 0; i < 3; i++) {
    events.childTurn("Two", 100 + i * 500);
    await vi.advanceTimersByTimeAsync(400);
  }
  const close = transport.send.mock.calls
    .map(([command]) => command)
    .filter(command => command.event_id.includes(":support-limit:"));
  expect(close).toHaveLength(1);
  expect(close[0]).toMatchObject({ content: GARDEN_RESCUE_LESSON.supportLimit!.instruction });
  expect(runtime.snapshot().diagnostics.filter(event => event.type === "support_limit.sent")).toHaveLength(1);
  runtime.stop("parent_stop");
  expect(runtime.snapshot().diagnostics.filter(event => event.type === "support_limit.cancelled")).toHaveLength(1);
  expect(runtime.snapshot().runtime?.visitOutcomes).toEqual([]);
});

it("releases a silent close after the timeout", async () => {
  useRuntimeFakeTimers();
  const { gardenRun } = await import("./helpers/garden-session");
  const run = await gardenRun(transport);
  runtime = run.runtime;
  for (let i = 0; i < 3; i++) await run.child("five");
  await vi.advanceTimersByTimeAsync(9_500);
  expect(runtime.snapshot().runtime?.phase).toBe("active");
  await vi.advanceTimersByTimeAsync(500);
  expect(runtime.snapshot().runtime?.phase).toBe("rendering");
  runtime.confirmRendered(runtime.snapshot().display);
  expect(runtime.snapshot().runtime?.visitOutcomes?.[0].outcome).toBe("released_after_support_limit");
});

it("cancels the fallback when tutor output releases the quest", async () => {
  useRuntimeFakeTimers();
  const { gardenRun } = await import("./helpers/garden-session");
  const run = await gardenRun(transport);
  runtime = run.runtime;
  for (let i = 0; i < 3; i++) await run.child("five");
  await run.tutor("Let's try the next one.");
  expect(runtime.snapshot().runtime?.phase).toBe("rendering");
  runtime.confirmRendered(runtime.snapshot().display);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(runtime.snapshot().runtime?.visitOutcomes).toHaveLength(1);
});

it("cancels the fallback on stop", async () => {
  useRuntimeFakeTimers();
  const { gardenRun } = await import("./helpers/garden-session");
  const run = await gardenRun(transport);
  runtime = run.runtime;
  for (let i = 0; i < 3; i++) await run.child("five");
  runtime.stop();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(runtime.snapshot().runtime?.visitOutcomes).toEqual([]);
});
