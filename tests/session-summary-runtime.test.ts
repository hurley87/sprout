import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { CATCHING_UNICORNS_LESSON as lesson } from "../lib/lesson-runtime/catching-unicorns-lesson";
import {
  ASSESSMENT_VERSION,
  assessmentQuestions,
  normalizeAssessment,
} from "../lib/lesson-runtime/conversation-assessment";
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
const events = providerEvents(event => transport.receive!(event));
const definition = {
  ...lesson,
  nodes: { ...lesson.nodes, engram: { ...lesson.nodes.engram, onSuccess: { kind: "node" as const, nodeId: "recap" } } },
};
let runtime: LessonRuntime;
let requests: { resolve: (response: Response) => void; signal: AbortSignal }[];
const response = () =>
  Response.json({
    assessment: normalizeAssessment(
      {
        version: ASSESSMENT_VERSION,
        answers: Object.fromEntries(
          Object.keys(assessmentQuestions(lesson)).map(key => [
            key,
            key.endsWith(":understanding")
              ? {
                  type: "choice",
                  choice: "partial",
                  confidence: 0.6,
                  probabilities: { not_yet: 0.1, partial: 0.6, demonstrated: 0.3 },
                }
              : {
                  type: "choice",
                  choice: "unclear",
                  confidence: 1,
                  probabilities: { independent: 0, prompted: 0, unclear: 1 },
                },
          ]),
        ),
      },
      lesson,
    ),
  });
const appends = () =>
  transport.send.mock.calls
    .map(([command]) => command)
    .filter(
      (command): command is Extract<ClientCommand, { type: "session.instructions.append" }> =>
        command.type === "session.instructions.append",
    );
beforeEach(() => {
  useRuntimeFakeTimers();
  vi.clearAllMocks();
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) =>
      url === "/api/assess"
        ? new Promise<Response>(resolve => requests.push({ resolve, signal: init.signal as AbortSignal }))
        : Promise.resolve(Response.json({ proposal: null })),
    ),
  );
});
afterEach(() => {
  runtime?.stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function enterRecap() {
  runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, definition);
  runtime.confirmRendered(runtime.snapshot().display);
  await vi.advanceTimersByTimeAsync(0);
  events.acknowledgeSteering(appends()[0].event_id, 0);
  transport.receive!({ type: "output.activity", state: "quiet" });
  events.childTurn("Next question, then", 100);
  await vi.advanceTimersByTimeAsync(900);
  expect(runtime.snapshot().runtime?.nodeId).toBe("recap");
  runtime.confirmRendered(runtime.snapshot().display);
  return appends().at(-1)!;
}
it("steers immediately with actual fallback feedback, then queues a passive review update behind the steering boundary", async () => {
  const steering = await enterRecap();
  expect(requests).toHaveLength(1);
  expect(runtime.snapshot().summary?.reviewStatus).toBe("pending");
  const feedback = runtime.snapshot().summary!;
  const supplied = JSON.parse(steering.content.split("\n")[1]);
  expect(supplied.exercise).toBe(feedback.exercise);
  expect(supplied.improvement).toBe(feedback.improvement.text);
  expect(steering.content).toContain("Speak now");
  expect(steering.content).not.toContain("visible recap");
  requests[0].resolve(response());
  await vi.advanceTimersByTimeAsync(0);
  expect(runtime.snapshot().summary?.reviewStatus).toBe("complete");
  expect(appends()).toHaveLength(2);
  events.acknowledgeSteering(steering.event_id, 300);
  expect(appends()).toHaveLength(3);
  expect(appends()[2].content).toContain("do not initiate an extra turn");
  expect(JSON.parse(appends()[2].content.split("\n")[1]).exercise).toBe(runtime.snapshot().summary?.exercise);
  events.acknowledgeSteering(steering.event_id, 300);
  await vi.advanceTimersByTimeAsync(0);
  expect(appends()).toHaveLength(3);
  expect(runtime.snapshot().error).toBeNull();
});
it("keeps usable feedback on review failure and never waits for it to acknowledge recap", async () => {
  const steering = await enterRecap();
  events.acknowledgeSteering(steering.event_id, 300);
  requests[0].resolve(new Response(null, { status: 503 }));
  await vi.advanceTimersByTimeAsync(0);
  expect(runtime.snapshot().summary?.reviewStatus).toBe("unavailable");
  expect(runtime.snapshot().summary?.exercise).toContain("in your own words");
  expect(runtime.snapshot().awaitingSteering).toBe(false);
  expect(runtime.snapshot().status).toBe("live");
});
it("supersedes in-flight entry review on stop, ignores late completion, and sends no feedback after close", async () => {
  const steering = await enterRecap();
  events.acknowledgeSteering(steering.event_id, 300);
  events.childTurn("What should I study next?", 1000);
  runtime.stop();
  expect(requests).toHaveLength(2);
  expect(requests[0].signal.aborted).toBe(true);
  requests[0].resolve(response());
  await vi.advanceTimersByTimeAsync(0);
  expect(runtime.snapshot().summary?.reviewStatus).toBe("pending");
  requests[1].resolve(response());
  await vi.advanceTimersByTimeAsync(0);
  expect(runtime.snapshot().summary?.reviewStatus).toBe("complete");
  expect(runtime.snapshot().status).toBe("ended");
  expect(appends()).toHaveLength(2);
  const previous = runtime.snapshot().summary!;
  const fresh = new LessonRuntime({} as HTMLAudioElement, () => {}, definition);
  expect(fresh.snapshot().summary).toBeUndefined();
  expect(fresh.snapshot().assessment?.status).toBe("idle");
  expect(fresh.report().runtimeId).not.toBe(previous.runtimeId);
  fresh.stop();
});
it("keeps malformed successful API responses unavailable without changing accepted live evidence", async () => {
  await enterRecap();
  const before = structuredClone(runtime.snapshot().runtime?.conceptEvidence);
  requests[0].resolve(Response.json({ assessment: { version: ASSESSMENT_VERSION, status: "complete", results: {} } }));
  await vi.advanceTimersByTimeAsync(0);
  expect(runtime.snapshot().assessment?.status).toBe("unavailable");
  expect(runtime.snapshot().assessment?.version).toBe(ASSESSMENT_VERSION);
  expect(runtime.snapshot().runtime?.conceptEvidence).toEqual(before);
  expect(runtime.snapshot().summary?.notice).toContain("unavailable");
});
