import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { DINO_CAR_CRUNCH_LESSON } from "../lib/lesson-runtime/dino-car-crunch-lesson";
import type { LessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import { classifierProposal } from "./helpers/runtime-classifier";
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

const lesson: LessonDefinition = {
  ...DINO_CAR_CRUNCH_LESSON,
  silenceNudges: [
    { afterQuietMs: 7_000, instruction: "NUDGE ONE" },
    { afterQuietMs: 12_000, instruction: "NUDGE TWO" },
  ],
};
const emit = (event: ProviderEvent) => transport.receive!(event);
const events = providerEvents(emit);
const nudges = () =>
  transport.send.mock.calls
    .map(([command]) => command)
    .filter(command => command.type === "session.instructions.append" && command.event_id.includes(":silence-nudge:"))
    .map(command => (command as { content: string }).content);
let runtime: LessonRuntime;

beforeEach(() => {
  useRuntimeFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: RequestInit) =>
      Response.json({
        proposal: classifierProposal(JSON.parse(init.body as string), {
          answerOutcome: "none",
          tutorState: "asking",
        }),
      }),
    ),
  );
});
afterEach(() => {
  runtime?.stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function start(definition = lesson) {
  runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, definition);
  runtime.confirmRendered(runtime.snapshot().display);
  events.acknowledgeSteering(transport.send.mock.calls.at(-1)![0].event_id, 0);
  events.tutorTurn("This is Rex! How many cars can Rex eat?", 100);
}

it("re-asks a silent learner, then checks in once, then stays quiet", async () => {
  start();
  await vi.advanceTimersByTimeAsync(6_999);
  expect(nudges()).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(nudges()).toEqual(["NUDGE ONE"]);

  events.tutorTurn("You can tell Rex out loud! How many cars?", 8_000);
  await vi.advanceTimersByTimeAsync(11_999);
  expect(nudges()).toEqual(["NUDGE ONE"]);
  await vi.advanceTimersByTimeAsync(1);
  expect(nudges()).toEqual(["NUDGE ONE", "NUDGE TWO"]);

  events.tutorTurn("Are you still there?", 21_000);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(nudges()).toEqual(["NUDGE ONE", "NUDGE TWO"]);
  expect(runtime.report().events.map(event => event.type)).toEqual(
    expect.arrayContaining(["silence_nudge.scheduled", "silence_nudge.requested", "gpt_live.silence_nudge_append"]),
  );
});

it("does not nudge a learner who answers", async () => {
  start();
  await vi.advanceTimersByTimeAsync(3_000);
  events.childTurn("seven", 3_200);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(nudges()).toEqual([]);
});

it("is not pushed back by repeated discarded microphone bursts", async () => {
  // The Nov 27 test session: room-noise bursts every few seconds each restarted the old 7 s wait,
  // delaying the first nudge from ~11 s to 30 s.
  start();
  const quietAt = performance.now();
  for (const atMs of [2_000, 4_000, 5_000]) {
    await vi.advanceTimersByTimeAsync(quietAt + atMs - performance.now());
    emit({ type: "microphone.activity_started" });
    await vi.advanceTimersByTimeAsync(200);
    emit({ type: "microphone.activity_discarded" });
  }
  await vi.advanceTimersByTimeAsync(quietAt + 6_999 - performance.now());
  expect(nudges()).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(nudges()).toEqual(["NUDGE ONE"]);
});

it("cancels a pending nudge when the lesson stops", async () => {
  start();
  await vi.advanceTimersByTimeAsync(5_000);
  runtime.stop();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(nudges()).toEqual([]);
});

it("leaves lessons without authored nudges unchanged", async () => {
  start({ ...lesson, silenceNudges: undefined });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(nudges()).toEqual([]);
});
