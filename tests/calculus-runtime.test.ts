import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MathExpression as E } from "../lib/calculus/math-expression";
import { EXTRACTION_LIMITS, type WorkExtraction, type WorkExtractionInput } from "../lib/calculus/work-extraction";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { CALCULUS_LESSON } from "../lib/lesson-runtime/calculus-lesson";
import { ANSWER_RECOVERY_WAIT_MS } from "../lib/lesson-runtime/answer-recovery";
import { COUNTING_LESSON } from "../lib/lesson-runtime/counting-lesson";
import type { LessonDefinition } from "../lib/lesson-runtime/lesson-definition";
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
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function start(definition: LessonDefinition = CALCULUS_LESSON) {
  runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, definition);
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

it.each([
  { definition: CALCULUS_LESSON, recovers: false },
  { definition: COUNTING_LESSON, recovers: true },
])("only schedules missing-transcript recovery when enabled for $definition.id", async ({ definition, recovers }) => {
  start(definition);
  emit({ type: "output.activity", state: "quiet" });
  emit({ type: "microphone.activity_started" });
  emit({ type: "microphone.speech_started" });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  expect(runtime.report().events).toContainEqual(
    expect.objectContaining({
      type: "classifier.blocked",
      detail: expect.objectContaining({ reason: "missing_current_turn_child_transcript" }),
    }),
  );
  expect(runtime.report().events.some(event => event.type === "answer_recovery.scheduled")).toBe(recovers);
  await vi.advanceTimersByTimeAsync(ANSWER_RECOVERY_WAIT_MS + 1);
  expect(runtime.report().events.some(event => event.type === "answer_recovery.requested")).toBe(recovers);
  expect(runtime.report().events.some(event => event.type === "gpt_live.answer_recovery_append")).toBe(recovers);
  expect(fetch).not.toHaveBeenCalled();
});

it("leaves late final answers to the math check instead of recovering over learner speech", async () => {
  start();
  emit({ type: "output.activity", state: "quiet" });
  emit({ type: "microphone.activity_started" });
  emit({ type: "microphone.speech_started" });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(3000);
  emit({ type: "microphone.activity_started" });
  emit({ type: "microphone.speech_started" });
  emit({ type: "transcript", speaker: "child", delta: "three x squared minus four", startMs: 100, endMs: 200 });
  await vi.advanceTimersByTimeAsync(ANSWER_RECOVERY_WAIT_MS);
  expect(runtime.snapshot().runtime!.childSpeaking).toBe(true);
  expect(transport.send).toHaveBeenCalledOnce();
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(301);
  expect(requests).toHaveLength(1);
  await respond({
    steps: [step("d-cubic", threeXSquared), step("d-linear", n(4))],
    final: { expression: final, quote: "q" },
    unclear: null,
  });
  await vi.advanceTimersByTimeAsync(ANSWER_RECOVERY_WAIT_MS + 1);
  expect(runtime.report().events.some(event => event.type.startsWith("answer_recovery."))).toBe(false);
  expect(runtime.report().events.some(event => event.type === "gpt_live.answer_recovery_append")).toBe(false);
  expect(runtime.snapshot().runtime!.phase).toBe("rendering");
  expect(runtime.report().math!.visits[0].outcome).toBe("completed");
});

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

it("supersedes in-flight checks after substantive turns end and debounces the latest full visit", async () => {
  start();
  await learner("three x");
  emit({ type: "microphone.speech_started" });
  emit({ type: "transcript", speaker: "child", delta: "squared", startMs: time, endMs: time + 100 });
  expect(requests[0].signal.aborted).toBe(false);
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  expect(requests[0].signal.aborted).toBe(true);
  expect(requests).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(301);
  expect(requests).toHaveLength(2);
  expect(runtime.snapshot().math!.checking).toBe(true);
  expect(requests[1].signal.aborted).toBe(false);
  time += 200;
  await learner("minus four, so three x squared minus four");
  expect(requests[1].signal.aborted).toBe(true);
  expect(requests).toHaveLength(3);
  expect(requests[2].input.learnerTurns.map(turn => turn.text)).toEqual([
    "three x",
    "squared",
    "minus four, so three x squared minus four",
  ]);
  expect(runtime.report().events.filter(event => event.type === "calculus.check_ended")).toMatchObject([
    { detail: { status: "stale" } },
    { detail: { status: "stale" } },
  ]);
  expect(runtime.report().math!.visits[0].checks).toHaveLength(0);
  await respond({
    steps: [step("d-cubic", threeXSquared), step("d-linear", n(4))],
    final: { expression: final, quote: "three x squared minus four" },
    unclear: null,
  });
  expect(runtime.snapshot().math!.complete).toBe(true);
});

it("does not supersede an in-flight check for noise, speech without text, or filler", async () => {
  start();
  await learner("three x squared");
  emit({ type: "microphone.activity_started" });
  emit({ type: "microphone.speech_started" });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(301);
  expect(requests).toHaveLength(1);
  expect(requests[0].signal.aborted).toBe(false);
  await learner("[tongue click] Um, and...");
  expect(requests).toHaveLength(1);
  expect(requests[0].signal.aborted).toBe(false);
  await respond({ steps: [step("d-cubic", threeXSquared)], final: null, unclear: null });
  expect(statuses()[0]).toBe("correct");
});

it("ignores a superseded response even if the transport finishes after cancellation", async () => {
  vi.mocked(fetch).mockImplementationOnce(
    async (_url, init) =>
      new Promise<Response>(resolve => {
        requests.push({
          input: JSON.parse(init!.body as string),
          signal: init!.signal!,
          resolve: body => resolve(Response.json(body)),
        });
      }),
  );
  start();
  await learner("three x");
  await learner("three x squared minus four");
  expect(requests[0].signal.aborted).toBe(true);
  await respond({ steps: [step("d-cubic", n(3))], final: null, unclear: null }, 0);
  expect(statuses()).toEqual(["missing", "missing", "missing"]);
  expect(runtime.snapshot().math!.checking).toBe(true);
  expect(requests[1].signal.aborted).toBe(false);
  await respond({ steps: [step("d-cubic", threeXSquared)], final: null, unclear: null });
  expect(statuses()[0]).toBe("correct");
});

it("honors the client timeout and records it without changing work", async () => {
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(timeoutMs => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), timeoutMs);
    return controller.signal;
  });
  start();
  await learner("three x squared");
  expect(EXTRACTION_LIMITS.timeoutMs).toBe(10_000);
  expect(EXTRACTION_LIMITS.clientTimeoutMs).toBe(12_000);
  expect(timeout).toHaveBeenCalledWith(EXTRACTION_LIMITS.clientTimeoutMs);
  await vi.advanceTimersByTimeAsync(EXTRACTION_LIMITS.clientTimeoutMs - 2);
  expect(requests[0].signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(requests[0].signal.aborted).toBe(true);
  expect(statuses()).toEqual(["missing", "missing", "missing"]);
  expect(runtime.report().math!.visits[0].checks[0].status).toBe("timeout");
});

it("retries a failed check of the learner's last words once, then asks for them again", async () => {
  start();
  await learner("three x squared");
  requests[0].resolve({ status: "timeout" });
  await vi.advanceTimersByTimeAsync(0);
  expect(requests).toHaveLength(2);
  expect(requests[1].input).toEqual(requests[0].input);
  expect(instructions()).toEqual([]);
  requests[1].resolve({ status: "provider-failure" });
  await vi.advanceTimersByTimeAsync(0);
  expect(requests).toHaveLength(2);
  expect(runtime.snapshot().math!.checking).toBe(false);
  expect(instructions()).toEqual([expect.stringContaining("ask them to say their last step again")]);
  // New speech is checked as usual.
  await learner("so three x squared minus four");
  expect(requests).toHaveLength(3);
});

it("does not retry when checking is unavailable, and a retry can succeed", async () => {
  start();
  await learner("three x squared");
  requests[0].resolve({ status: "unavailable" });
  await vi.advanceTimersByTimeAsync(0);
  expect(requests).toHaveLength(1);
  await learner("so three x squared minus four");
  requests[1].resolve({ status: "malformed" });
  await vi.advanceTimersByTimeAsync(0);
  expect(requests).toHaveLength(3);
  await respond({ steps: [step("d-cubic", threeXSquared)], final: null, unclear: null });
  expect(statuses()).toEqual(["correct", "missing", "missing"]);
  expect(instructions()).toEqual([expect.stringContaining("Correct so far")]);
});

it("logs the returned raw output and dropped items with the check", async () => {
  start();
  await learner("three x squared");
  const diagnostics = {
    raw: { steps: [], rule: null, final: { expression: n(4), quote: "four" }, unclear: null },
    dropped: [{ item: "final", reason: "unquoted", value: { expression: n(4), quote: "four" } }],
  };
  requests[0].resolve({ status: "ok", extraction: { steps: [], rule: null, final: null, unclear: null }, diagnostics });
  await vi.advanceTimersByTimeAsync(0);
  expect(runtime.report().events.find(event => event.type === "calculus.check_ended")?.detail).toMatchObject({
    status: "ok",
    diagnostics,
  });
});

it("includes returned extraction timing in the check diagnostic", async () => {
  start();
  await learner("three x squared");
  requests[0].resolve({ status: "timeout", timing: { extractionMs: 10_000 } });
  await vi.advanceTimersByTimeAsync(0);
  expect(runtime.report().events.find(event => event.type === "calculus.check_ended")?.detail).toMatchObject({
    status: "timeout",
    timing: { extractionMs: 10_000 },
  });
});

it.each([threeXSquared, n(3)])(
  "withholds stale three-times-one feedback, then applies a current check (%j)",
  async expression => {
    start();
    await learner("I bring the three down, so three times one is");
    emit({ type: "microphone.speech_started" });
    emit({ type: "transcript", speaker: "child", delta: "three x squared", startMs: time, endMs: time + 100 });
    await respond({
      steps: [{ ...step("d-cubic", { op: "multiply", args: [n(3), n(1)] }), quote: "three times one" }],
      final: { expression: n(3), quote: "three times one" },
      unclear: null,
    });
    expect(statuses()).toEqual(["missing", "missing", "missing"]);
    expect(work().steps[0].expression).toBeNull();
    expect(work().final.expression).toBeNull();
    expect(instructions()).toHaveLength(0);
    expect(runtime.report().math!.visits[0].checks[0]).toMatchObject({
      current: false,
      outcome: "in-progress",
      extraction: { steps: [{ quote: "three times one" }] },
    });
    expect(runtime.report().math!.visits[0].checks[0].instruction).not.toContain("not correct");
    emit({ type: "microphone.speech_stopped", quietMs: 900 });
    await vi.advanceTimersByTimeAsync(301);
    expect(requests).toHaveLength(2);
    expect(requests[1].input.learnerTurns.map(turn => turn.text).join(" ")).toContain("three x squared");
    const correct = expression === threeXSquared;
    await respond({
      steps: [step("d-cubic", expression)],
      final: { expression: correct ? final : n(3), quote: "current final" },
      unclear: null,
    });
    expect(statuses()).toEqual([correct ? "correct" : "incorrect", "missing", correct ? "correct" : "incorrect"]);
    expect(runtime.report().math!.visits[0].checks[1].current).toBe(true);
    expect(instructions().at(-1)?.includes("not correct")).toBe(!correct);
  },
);

it.each([threeXSquared, n(3)])(
  "keeps previous step and final records when stale mismatches arrive (%j)",
  async expression => {
    start();
    await learner("my cubic derivative and final answer");
    await respond({
      steps: [step("d-cubic", expression)],
      final: { expression: final, quote: "earlier final" },
      unclear: null,
    });
    const previous = work();
    await learner("three times one is");
    emit({ type: "microphone.speech_started" });
    await respond({
      steps: [step("d-cubic", n(1)), step("d-linear", n(4))],
      final: { expression: n(1), quote: "one" },
      unclear: null,
    });
    expect(work().steps[0]).toEqual(previous.steps[0]);
    expect(work().final).toEqual(previous.final);
    expect(work().steps[1].status).toBe("correct");
  },
);

it("rechecks after becoming quiet even when resumed speech only adds filler", async () => {
  start();
  await learner("three times one is");
  emit({ type: "microphone.speech_started" });
  await respond({ steps: [step("d-cubic", n(3))], final: null, unclear: null });
  expect(statuses()[0]).toBe("missing");
  expect(runtime.report().math!.visits[0].checks[0].current).toBe(false);
  emit({ type: "transcript", speaker: "child", delta: "um", startMs: time, endMs: time + 100 });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(301);
  expect(requests).toHaveLength(2);
  expect(requests[1].input.learnerTurns.map(turn => turn.text)).toContain("um");
  await respond({ steps: [step("d-cubic", n(3))], final: null, unclear: null });
  expect(statuses()[0]).toBe("incorrect");
  expect(runtime.report().math!.visits[0].checks[1].current).toBe(true);
});

it("still detects completion from stale correct steps and final answers", async () => {
  start();
  await learner("three x squared, minus four, so three x squared minus four");
  emit({ type: "microphone.speech_started" });
  await respond({
    steps: [step("d-cubic", threeXSquared), step("d-linear", n(4))],
    final: { expression: final, quote: "three x squared minus four" },
    unclear: null,
  });
  expect(statuses()).toEqual(["correct", "correct", "correct"]);
  expect(runtime.snapshot().math!.complete).toBe(true);
  expect(runtime.report().math!.visits[0].checks[0]).toMatchObject({ current: false, outcome: "complete" });
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
