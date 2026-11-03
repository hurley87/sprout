import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import { MATH_SCRIBE_LESSON } from "../lib/lesson-runtime/math-scribe-lesson";
import { listParts } from "../lib/math-scribe/parts";
import { providerEvents, useRuntimeFakeTimers } from "./helpers/runtime-harness";

const transport = vi.hoisted(() => ({
  receive: undefined as ((event: ProviderEvent) => void) | undefined,
  send: vi.fn<(command: ClientCommand) => void>(),
  close: vi.fn(),
  start: vi.fn<(lessonId: string) => void>(),
}));
vi.mock("../lib/browser-transport", async () => {
  const { mockBrowserTransport } = await import("./helpers/runtime-harness");
  return { BrowserTransport: mockBrowserTransport(transport) };
});

let runtime: LessonRuntime;
let requests: { signal: AbortSignal; resolve: (body: unknown) => void }[];
const emit = (event: ProviderEvent) => transport.receive!(event);
const events = providerEvents(emit);
const instructions = () =>
  transport.send.mock.calls
    .map(([command]) => command)
    .filter(command => command.type === "session.instructions.append" && command.event_id.includes(":math-scribe:"));

beforeEach(() => {
  useRuntimeFakeTimers();
  vi.clearAllMocks();
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      expect(url).toBe("/api/math-scribe");
      return new Promise<Response>(resolve =>
        requests.push({ signal: init.signal!, resolve: body => resolve(Response.json(body)) }),
      );
    }),
  );
  runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, MATH_SCRIBE_LESSON);
  runtime.confirmRendered(runtime.snapshot().display);
  events.acknowledgeSteering(transport.send.mock.calls.at(-1)![0].event_id, 0);
});
afterEach(() => {
  runtime.stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("routes speech, actions, navigation and cancellation through the scribe", async () => {
  expect(transport.start).toHaveBeenCalledWith("math-scribe");
  const initial = runtime.snapshot().scribe!;
  expect(initial.problem?.id).toBe("reciprocal");
  const divisor = listParts(initial.session!.workingLine.expression).find(part => part.description === "divisor")!.id;
  events.childTurn("flip the divisor", 100);
  await vi.advanceTimersByTimeAsync(301);
  expect(requests).toHaveLength(1);
  requests[0].resolve({
    status: "ok",
    interpretations: [
      {
        intent: "propose",
        operation: { kind: "division-to-reciprocal", partId: divisor },
        source: "instruction",
        quote: "flip",
      },
    ],
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(instructions()).toHaveLength(1);
  expect(instructions()[0]).toMatchObject({
    type: "session.instructions.append",
    content: expect.stringContaining("Application update from the scribe"),
  });
  runtime.scribeAction("check");
  expect(instructions()).toHaveLength(2);
  expect(instructions()[1]).toMatchObject({ content: expect.stringContaining("That step follows") });
  expect(runtime.report().scribe!.visits[0].requests).toHaveLength(1);

  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(600);
  events.childTurn("next problem", 300);
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(runtime.snapshot().runtime!.nodeId).toBe("negative-exponent");
  expect(runtime.snapshot().scribe!.problem?.id).toBe("negative-exponent");
  expect(runtime.snapshot().scribe!.session!.pending).toBeNull();
  expect(runtime.snapshot().scribe!.metrics!.proposals).toBe(0);
  runtime.confirmRendered(runtime.snapshot().display);
  events.acknowledgeSteering(transport.send.mock.calls.at(-1)![0].event_id, 400);
  events.childTurn("rewrite the exponent", 500);
  await vi.advanceTimersByTimeAsync(301);
  expect(requests).toHaveLength(2);
  runtime.stop();
  expect(requests[1].signal.aborted).toBe(true);
  const count = instructions().length;
  requests[1].resolve({ status: "ok", interpretations: [{ intent: "describe-strategy", quote: "rewrite" }] });
  await vi.advanceTimersByTimeAsync(1000);
  runtime.scribeAction("check");
  expect(instructions()).toHaveLength(count);
  expect(runtime.report().scribe!.visits).toHaveLength(2);
});

it("uses the scribe recap after the learner navigates through both problems", async () => {
  events.childTurn("next problem", 100);
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(runtime.snapshot().runtime!.nodeId).toBe("negative-exponent");
  runtime.confirmRendered(runtime.snapshot().display);
  events.acknowledgeSteering(transport.send.mock.calls.at(-1)![0].event_id, 300);
  events.childTurn("next problem", 400);
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(runtime.snapshot().runtime!.nodeId).toBe("recap");
  runtime.confirmRendered(runtime.snapshot().display);
  expect(runtime.snapshot().recapText).toBe("Thanks for practicing.");
  expect(transport.send.mock.calls.at(-1)![0]).toMatchObject({
    type: "session.instructions.append",
    content: expect.stringContaining("Thanks for practicing."),
  });
});
