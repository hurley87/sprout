import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MathExpression as E } from "../lib/calculus/math-expression";
import type { WorkExtraction, WorkExtractionInput } from "../lib/calculus/work-extraction";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { CALCULUS_LESSON } from "../lib/lesson-runtime/calculus-lesson";
import { LessonRuntime } from "../lib/lesson-runtime/lesson-runtime";
import { providerEvents, useRuntimeFakeTimers } from "./helpers/runtime-harness";

const transport = vi.hoisted(() => ({
  receive: undefined as ((e: ProviderEvent) => void) | undefined,
  send: vi.fn<(c: ClientCommand) => void>(),
  close: vi.fn(),
}));
vi.mock("../lib/browser-transport", async () => {
  const { mockBrowserTransport } = await import("./helpers/runtime-harness");
  return { BrowserTransport: mockBrowserTransport(transport) };
});
let runtime: LessonRuntime;
const emit = (event: ProviderEvent) => transport.receive!(event);
const events = providerEvents(emit);
let time = 100;
let requests: { input: WorkExtractionInput; signal: AbortSignal; resolve: (body: unknown) => void }[];

const x: E = { op: "variable", name: "x" };
const n = (value: number): E => ({ op: "number", value });
const threeXSquared: E = { op: "multiply", args: [n(3), { op: "power", base: x, exponent: 2 }] };
const final: E = { op: "subtract", left: threeXSquared, right: n(4) };
const step = (stepId: string, expression: E) => ({ stepId, expression, quote: "q" });

beforeEach(() => {
  useRuntimeFakeTimers();
  vi.clearAllMocks();
  requests = [];
  time = 100;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      expect(url).toBe("/api/calculus-work");
      return new Promise<Response>((resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        requests.push({
          input: JSON.parse(init.body as string),
          signal: init.signal!,
          resolve: body => resolve(Response.json(body)),
        });
      });
    }),
  );
});
afterEach(() => {
  runtime?.stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function start() {
  runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, CALCULUS_LESSON);
  runtime.confirmRendered(runtime.snapshot().display);
  events.acknowledgeSteering(transport.send.mock.calls.at(-1)![0].event_id, 0);
}
async function learner(text: string) {
  events.childTurn(text, time);
  time += 200;
  await vi.advanceTimersByTimeAsync(301);
}
async function respond(extraction: Omit<WorkExtraction, "rule">, index = requests.length - 1) {
  requests[index].resolve({ status: "ok", extraction: { rule: null, ...extraction } });
  await vi.advanceTimersByTimeAsync(0);
}
const steering = () =>
  transport.send.mock.calls
    .map(([command]) => command)
    .filter(command => command.type === "session.instructions.append" && command.event_id.includes(":steer:"))
    .map(command => (command as { content: string }).content);
const work = () => runtime.snapshot().math!.work!;
const statuses = () => [...work().steps, work().final].map(item => item.status);
const instructions = () =>
  transport.send.mock.calls
    .map(([command]) => command)
    .filter(command => command.type === "session.instructions.append" && command.event_id.includes(":math:"))
    .map(command => (command as { content: string }).content);

it("checks each spoken turn against the steps and briefs the tutor without confirmation", async () => {
  start();
  await learner("for x cubed I bring the three down, three x squared");
  expect(requests).toHaveLength(1);
  expect(requests[0].input.problemId).toBe("cubic-minus-linear");
  expect(requests[0].input.learnerTurns.map(turn => turn.text)).toEqual([
    "for x cubed I bring the three down, three x squared",
  ]);
  expect(runtime.snapshot().math!.checking).toBe(true);
  await respond({ steps: [step("d-cubic", threeXSquared)], final: null, unclear: null });
  expect(statuses()).toEqual(["correct", "missing", "missing"]);
  expect(instructions().at(-1)).toContain('Correct so far: "Derivative of x³"');
  expect(runtime.snapshot().runtime!.nodeId).toBe("cubic-minus-linear");
});

it("sends every learner turn in the visit so later turns can revise earlier steps", async () => {
  start();
  await learner("three x cubed");
  await respond({
    steps: [step("d-cubic", { op: "multiply", args: [n(3), { op: "power", base: x, exponent: 3 }] })],
    final: null,
    unclear: null,
  });
  expect(statuses()[0]).toBe("incorrect");
  expect(instructions().at(-1)).toContain('step "Derivative of x³"');
  await learner("sorry, I mean three x squared");
  expect(requests[1].input.learnerTurns.map(turn => turn.text)).toEqual([
    "three x cubed",
    "sorry, I mean three x squared",
  ]);
  await respond({ steps: [step("d-cubic", threeXSquared)], final: null, unclear: null });
  expect(statuses()[0]).toBe("correct");
});

it("advances to the next problem once every step and the final answer check out", async () => {
  start();
  await learner("three x squared, and four x becomes four, so three x squared minus four");
  await respond({
    steps: [step("d-cubic", threeXSquared), step("d-linear", n(4))],
    final: { expression: final, quote: "q" },
    unclear: null,
  });
  expect(runtime.snapshot().math!.complete).toBe(true);
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(600);
  expect(runtime.snapshot().runtime!.nodeId).toBe("quadratic-sine");
  runtime.confirmRendered(runtime.snapshot().display);
  // The praise rides on the next problem's steering, so the steering cannot replace it.
  expect(instructions()).toHaveLength(0);
  expect(steering().at(-1)).toContain("every step and the final answer were correct");
  expect(steering().at(-1)).toContain("Differentiate f(x) = x^2 sin(x)");
  expect(work().problemId).toBe("quadratic-sine");
  expect(statuses()).toEqual(["missing", "missing", "missing"]);
  expect(runtime.report().math!.visits.map(visit => visit.outcome)).toEqual(["completed", "active"]);
});

it("asks for the work when only a correct final answer is given", async () => {
  start();
  await learner("three x squared minus four");
  await respond({ steps: [], final: { expression: final, quote: "q" }, unclear: null });
  expect(runtime.snapshot().math!.complete).toBe(false);
  expect(instructions().at(-1)).toContain("final answer is correct, but they have not yet shown");
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(600);
  expect(runtime.snapshot().runtime!.nodeId).toBe("cubic-minus-linear");
});

it("does not resend an unchanged instruction or recheck unchanged turns", async () => {
  start();
  await learner("three x squared");
  await respond({ steps: [step("d-cubic", threeXSquared)], final: null, unclear: null });
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(600);
  expect(requests).toHaveLength(1);
  await learner("um, sorry");
  await respond({ steps: [step("d-cubic", threeXSquared)], final: null, unclear: null });
  expect(instructions()).toHaveLength(1);
});

it("does not check turns of only fillers or sound tags", async () => {
  start();
  await learner("[tongue click] Um");
  expect(requests).toHaveLength(0);
  await learner("three x squared");
  await respond({ steps: [step("d-cubic", threeXSquared)], final: null, unclear: null });
  await learner("[gulp] And...");
  expect(requests).toHaveLength(1);
});

it("asks only for the final answer once every step is correct", async () => {
  start();
  await learner("three x squared, and four x becomes four");
  await respond({ steps: [step("d-cubic", threeXSquared), step("d-linear", n(4))], final: null, unclear: null });
  expect(instructions().at(-1)).toContain("Still to show: the final answer.");
});

it("finishes a check while the learner keeps talking, then rechecks everything said", async () => {
  start();
  await learner("for x cubed, three x squared");
  // The learner resumes after a short pause, before the check returns.
  emit({ type: "microphone.activity_started" });
  emit({ type: "microphone.speech_started" });
  expect(requests[0].signal.aborted).toBe(false);
  emit({ type: "transcript", speaker: "child", delta: "and four x becomes four", startMs: time, endMs: time + 100 });
  await respond({ steps: [step("d-cubic", threeXSquared)], final: null, unclear: null });
  // Its result is shown, but the tutor is not briefed from out-of-date work.
  expect(statuses()[0]).toBe("correct");
  expect(instructions()).toHaveLength(0);
  expect(runtime.report().math!.visits[0].checks[0].current).toBe(false);
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(301);
  expect(requests).toHaveLength(2);
  expect(requests[1].input.learnerTurns.map(turn => turn.text)).toEqual([
    "for x cubed, three x squared",
    "and four x becomes four",
  ]);
  await respond({ steps: [step("d-cubic", threeXSquared), step("d-linear", n(4))], final: null, unclear: null });
  expect(statuses()).toEqual(["correct", "correct", "missing"]);
  expect(instructions()).toHaveLength(1);
});

it("does not restart a running check when the tutor speaks", async () => {
  start();
  await learner("three x squared");
  events.tutorTurn("Mm-hmm.", time);
  await vi.advanceTimersByTimeAsync(1000);
  expect(requests).toHaveLength(1);
  expect(requests[0].signal.aborted).toBe(false);
  await respond({ steps: [step("d-cubic", threeXSquared)], final: null, unclear: null });
  expect(statuses()[0]).toBe("correct");
  expect(instructions()).toHaveLength(1);
});

it("routes spoken help through app support without checking it as work", async () => {
  start();
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(600);
  await learner("help");
  expect(requests).toHaveLength(0);
  expect(runtime.report().math!.visits[0].help).toBe(1);
});

it("records skipped and stopped visits without treating next as completion", async () => {
  start();
  await learner("three x squared");
  await respond({ steps: [step("d-cubic", threeXSquared)], final: null, unclear: null });
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(600);
  await learner("Next question.");
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(600);
  expect(runtime.snapshot().runtime!.nodeId).toBe("quadratic-sine");
  runtime.confirmRendered(runtime.snapshot().display);
  runtime.stop();
  expect(runtime.report().math!.visits.map(visit => visit.outcome)).toEqual(["skipped", "stopped"]);
  expect(runtime.report().math!.visits[0].checks).toHaveLength(1);
});

it("keeps the work unchanged when the check is unavailable", async () => {
  start();
  await learner("three x squared");
  requests[0].resolve({ status: "unavailable" });
  await vi.advanceTimersByTimeAsync(0);
  expect(statuses()).toEqual(["missing", "missing", "missing"]);
  expect(runtime.report().math!.visits[0].checks[0].status).toBe("unavailable");
  expect(instructions()).toHaveLength(0);
});
