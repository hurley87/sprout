import { afterEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { MAE386_LESSON } from "../lib/lesson-runtime/mae386-lesson";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import { questionRecap } from "../lib/lesson-runtime/mae386/question-outcomes";
import { providerEvents, useRuntimeFakeTimers as installRuntimeFakeTimers } from "./helpers/runtime-harness";
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
  vi.restoreAllMocks();
});
function start() {
  installRuntimeFakeTimers();
  runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, { ...MAE386_LESSON, initialNodeId: "q15" });
  const events = providerEvents(event => transport.receive!(event));
  runtime.confirmRendered(runtime.snapshot().display);
  const steering = transport.send.mock.calls.at(-1)![0];
  if (steering.type !== "session.instructions.append") throw new Error("Expected steering");
  events.acknowledgeSteering(steering.event_id, 0);
  return events;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function response(input: { nodeId: string; transcriptRevision: number }) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      proposal: {
        nodeId: input.nodeId,
        transcriptRevision: input.transcriptRevision,
        childActivity: "unknown",
        answerOutcome: "correct",
        supportState: "none",
        tutorState: "asking",
        conceptObservations: MAE386_LESSON.nodes.q15.concepts!.map(c => ({
          criterionId: c.id,
          observation: "demonstrated_independent",
          childMessageIndex: 0,
        })),
      },
    }),
  };
}
function secondaryReview() {
  return {
    assessment: {
      results: Object.fromEntries(
        Object.values(MAE386_LESSON.nodes).flatMap(node =>
          (node.concepts ?? []).map(c => [
            `${node.id}:${c.id}`,
            {
              scores: {
                choice: "demonstrated_independent",
                confidence: 1,
                probabilities: { not_yet: 0, partial: 0, demonstrated_independent: 1, demonstrated_prompted: 0 },
              },
            },
          ]),
        ),
      ),
    },
  };
}
function requests() {
  const live = deferred<ReturnType<typeof response>>();
  const assessment = deferred<{ ok: boolean; status: number; json: () => Promise<unknown> }>();
  let input!: { nodeId: string; transcriptRevision: number };
  let signal!: AbortSignal;
  const fetch = vi.fn((url: string, init: RequestInit) => {
    if (url === "/api/assess") {
      // Teardown must precede secondary review on Stop. Natural entry is allowed while live.
      return assessment.promise;
    }
    input = JSON.parse(String(init.body));
    signal = init.signal as AbortSignal;
    return live.promise;
  });
  vi.stubGlobal("fetch", fetch);
  return {
    live,
    assessment,
    fetch,
    get input() {
      return input;
    },
    get signal() {
      return signal;
    },
  };
}
it.each(["late", "failed", "absent"] as const)(
  "early Stop releases media with %s assessment and pending live work, preserving one frozen on-screen recap",
  async kind => {
    const work = requests();
    const events = start();
    events.childTurn("Science can predict phenomena even without an ultimate explanation.", 100);
    await vi.advanceTimersByTimeAsync(400);
    expect(work.input.nodeId).toBe("q15");
    transport.receive!({ type: "output.activity", state: "active" });
    const before = transport.send.mock.calls.length;
    runtime.stop();
    const snapshot = runtime.snapshot();
    expect(transport.close).toHaveBeenCalledOnce();
    expect(work.signal.aborted).toBe(true);
    expect(snapshot.status).toBe("ended");
    expect(snapshot.questionRecap?.label).toBe("Session ended early");
    expect(snapshot.questionOutcomes?.questions.at(-1)?.outcome).toBe("unresolved");
    expect(snapshot.recapText).toBeUndefined();
    expect(transport.send.mock.calls.slice(before).map(([c]) => c.type)).toEqual(["session.close"]);
    const frozen = snapshot.questionOutcomes;
    const wire = JSON.stringify(frozen);
    work.live.resolve(response(work.input));
    if (kind === "late") work.assessment.resolve({ ok: true, status: 200, json: async () => secondaryReview() });
    if (kind === "failed") work.assessment.reject(new Error("offline"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(runtime.snapshot().questionOutcomes).toBe(frozen);
    expect(JSON.stringify(runtime.snapshot().questionOutcomes)).toBe(wire);
    expect(runtime.report().runtime?.questionOutcomes).toEqual(frozen);
    expect(transport.close).toHaveBeenCalledOnce();
    expect(transport.send.mock.calls.slice(before).map(([c]) => c.type)).toEqual(["session.close"]);
  },
);
it.each(["accepted", "failed"] as const)(
  "natural final transition waits for bounded live work (%s), then derives spoken and visual recap together",
  async kind => {
    const work = requests();
    const events = start();
    events.childTurn("Science can predict phenomena even without an ultimate explanation.", 100);
    await vi.advanceTimersByTimeAsync(400);
    transport.receive!({ type: "output.activity", state: "quiet" });
    await vi.advanceTimersByTimeAsync(600);
    runtime.skipScene();
    expect(runtime.snapshot().runtime?.phase).toBe("active");
    expect(runtime.snapshot().questionOutcomes).toBeUndefined();
    if (kind === "accepted") work.live.resolve(response(work.input));
    else work.live.reject(new Error("Live assessment unavailable"));
    await vi.advanceTimersByTimeAsync(10);
    expect(runtime.snapshot().runtime?.phase).toBe("rendering");
    expect(runtime.snapshot().questionOutcomes).toBeUndefined();
    const display = runtime.snapshot().display;
    runtime.confirmRendered({ ...display, token: "stale" });
    expect(runtime.snapshot().questionOutcomes).toBeUndefined();
    runtime.confirmRendered(display);
    runtime.confirmRendered(display);
    const snapshot = runtime.snapshot();
    const frozen = snapshot.questionOutcomes!;
    expect(frozen.questions).toHaveLength(8);
    expect(frozen.questions.at(-1)?.outcome).toBe(kind === "accepted" ? "independent" : "unresolved");
    expect(snapshot.recapText).toBe(questionRecap(frozen).spoken);
    expect(snapshot.questionRecap?.questions).toBe(frozen.questions);
    const steering = transport.send.mock.calls.at(-1)![0];
    if (steering.type !== "session.instructions.append") throw new Error("Expected recap steering");
    expect(JSON.stringify(steering)).toContain(snapshot.recapText);
    expect(transport.send.mock.calls.filter(([c]) => c.type === "session.instructions.append")).toHaveLength(2);
    events.acknowledgeSteering(steering.event_id, 300);
    events.tutorTurn(snapshot.recapText!, 400);
    await vi.advanceTimersByTimeAsync(2000);
    expect(runtime.snapshot().runtime?.phase).toBe("rendering");
    runtime.confirmRendered(runtime.snapshot().display);
    runtime.confirmRendered(runtime.snapshot().display);
    expect(runtime.snapshot().runtime?.phase).toBe("complete");
    expect(runtime.snapshot().questionRecap?.label).toBe("Practice recap");
    expect(transport.close).toHaveBeenCalledOnce();
    work.assessment.resolve({ ok: true, status: 200, json: async () => secondaryReview() });
    await vi.advanceTimersByTimeAsync(100);
    expect(runtime.snapshot().questionOutcomes).toBe(frozen);
    expect(runtime.snapshot().assessment?.status).toBe("complete");
    expect(runtime.snapshot().recapText).toBe(snapshot.recapText);
    expect(runtime.observe().snapshot.questionOutcomes).toEqual(frozen);
  },
);
it.each(["before-confirmation", "before-steering-ack", "during-recap"] as const)(
  "Stop at final boundary %s is immediate and never adds recap speech",
  async boundary => {
    requests();
    const events = start();
    transport.receive!({ type: "output.activity", state: "quiet" });
    await vi.advanceTimersByTimeAsync(600);
    runtime.skipScene();
    const recapDisplay = runtime.snapshot().display;
    if (boundary !== "before-confirmation") runtime.confirmRendered(recapDisplay);
    if (boundary === "during-recap") {
      const steering = transport.send.mock.calls.at(-1)![0];
      if (steering.type !== "session.instructions.append") throw new Error("Expected recap steering");
      events.acknowledgeSteering(steering.event_id, 300);
      events.tutorTurn("Q1", 400);
    }
    const before = transport.send.mock.calls.length;
    runtime.stop();
    const frozen = runtime.snapshot().questionOutcomes;
    expect(transport.close).toHaveBeenCalledOnce();
    expect(runtime.snapshot().questionRecap?.label).toBe("Session ended early");
    expect(runtime.snapshot().runtime?.lessonComplete).toBe(false);
    expect(frozen?.questions.at(-1)?.components[0]).toMatchObject({
      reached: true,
      skipped: boundary !== "before-confirmation",
    });
    runtime.confirmRendered(recapDisplay);
    events.tutorTurn("Late output.", 800);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(runtime.snapshot().questionOutcomes).toBe(frozen);
    expect(transport.send.mock.calls.slice(before).map(([c]) => c.type)).toEqual(["session.close"]);
  },
);

it("Stop before classifier debounce preserves unresolved evidence without fabricating an attempted answer", () => {
  const work = requests();
  const events = start();
  events.childTurn("Science gives useful predictions without a final explanation.", 100);
  runtime.stop();
  expect(transport.close).toHaveBeenCalledOnce();
  expect(work.fetch.mock.calls.every(([url]) => url !== "/api/classify")).toBe(true);
  const component = runtime.snapshot().questionOutcomes!.questions.at(-1)!.components[0];
  expect(component).toMatchObject({ outcome: "unresolved", assessment: "unresolved", attempts: [] });
});
it("a classifier that never answers releases the final skip at the existing request timeout", async () => {
  installRuntimeFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
    const abort = new AbortController();
    setTimeout(() => abort.abort(new Error("timeout")), ms);
    return abort.signal;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error("timeout")))),
    ),
  );
  const events = start();
  events.childTurn("Prediction remains useful even without a final explanation.", 100);
  await vi.advanceTimersByTimeAsync(400);
  transport.receive!({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(600);
  runtime.skipScene();
  expect(runtime.snapshot().runtime?.phase).toBe("active");
  await vi.advanceTimersByTimeAsync(10_000);
  expect(runtime.snapshot().runtime?.phase).toBe("rendering");
  runtime.confirmRendered(runtime.snapshot().display);
  expect(runtime.snapshot().questionOutcomes?.questions.at(-1)?.components[0]).toMatchObject({
    outcome: "unresolved",
    assessment: "unavailable",
  });
});
