import type { MathExpression } from "../lib/calculus/math-expression";
import { compactMathExpression } from "../lib/calculus/tutor-context";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClientCommand, ProviderEvent } from "../lib/events";
import { LessonRuntime, type LessonSnapshot } from "../lib/lesson-runtime/lesson-runtime";
import { CALCULUS_LESSON } from "../lib/lesson-runtime/calculus-lesson";
import { resolveLessonDefinition } from "../lib/lesson-runtime/lesson-registry";
import {
  parseMathInterpretationOutput,
  type MathInterpretationInput,
} from "../lib/calculus/math-interpretation-contract";
import { getCalculusReviewKey } from "../lib/calculus/problems";
import { createLessonRuntime, reduceLessonRuntime, runtimeSource } from "../lib/lesson-runtime/lesson-runtime-reducer";
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
let publications: LessonSnapshot[];
const emit = (event: ProviderEvent) => transport.receive!(event);
const events = providerEvents(emit);
let time = 100;
let requests: { input: MathInterpretationInput; signal: AbortSignal; resolve: (body: unknown) => void }[];
const correct = getCalculusReviewKey("cubic-minus-linear").finalForms[0];
const wrong: MathExpression = {
  op: "add",
  args: [
    {
      op: "multiply",
      args: [
        { op: "number", value: 3 },
        { op: "power", base: { op: "variable", name: "x" }, exponent: 2 },
      ],
    },
    { op: "number", value: 4 },
  ],
};

beforeEach(() => {
  useRuntimeFakeTimers();
  vi.clearAllMocks();
  requests = [];
  publications = [];
  time = 100;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      expect(url).toBe("/api/math-action");
      return new Promise<Response>(resolve =>
        requests.push({
          input: JSON.parse(init.body as string),
          signal: init.signal as AbortSignal,
          resolve: body => resolve(Response.json(body)),
        }),
      );
    }),
  );
});
afterEach(() => {
  runtime?.stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function start() {
  runtime = new LessonRuntime({} as HTMLAudioElement, snapshot => publications.push(snapshot), CALCULUS_LESSON);
  runtime.confirmRendered(runtime.snapshot().display);
  events.acknowledgeSteering(transport.send.mock.calls.at(-1)![0].event_id, 0);
}
async function learner(text: string) {
  events.childTurn(text, time);
  time += 200;
  await vi.advanceTimersByTimeAsync(301);
}
function action(kind = "append", extra: object = {}, index = requests.length - 1) {
  const turn = requests[index].input.learnerTurns.at(-1)!;
  return { kind, ...extra, sources: [{ turnId: turn.id, quote: turn.text }] };
}
async function respond(actions: object[], index = requests.length - 1) {
  requests[index].resolve(parseMathInterpretationOutput({ actions }, requests[index].input));
  await vi.advanceTimersByTimeAsync(0);
}
function confirm(operation: "differentiate" | "rewrite" | "unassessed" = "differentiate") {
  const pending = runtime.snapshot().math!.pending!;
  expect(runtime.confirmMathProposalDisplayed(pending.id, pending.boardRevision)).toBe(true);
  expect(
    runtime.confirmMathProposal(
      pending.id,
      pending.boardRevision,
      pending.batch.actions.map(() => operation),
    ),
  ).toBe(true);
}

it("registers exactly three authored problems and a terminal recap with explicit opt-in", () => {
  expect(resolveLessonDefinition("calculus")).toBe(CALCULUS_LESSON);
  expect(Object.keys(CALCULUS_LESSON.nodes)).toEqual([
    "cubic-minus-linear",
    "quadratic-sine",
    "composite-fifth",
    "recap",
  ]);
  expect(CALCULUS_LESSON.calculus).toBe(true);
});

it.each([correct, wrong])(
  "requires exact display + learner confirmation, then publishes faithful math during tutor output",
  async expression => {
    start();
    await learner("My derivative is three x squared minus four.");
    emit({ type: "output.activity", state: "active" });
    await respond([action("append", { expression })]);
    expect(runtime.snapshot().math!.current!.steps).toHaveLength(0);
    const pending = runtime.snapshot().math!.pending!;
    expect(runtime.confirmMathProposal(pending.id, pending.boardRevision, ["differentiate"])).toBe(false);
    expect(runtime.confirmMathProposalDisplayed("stale", pending.boardRevision)).toBe(false);
    expect(runtime.confirmMathProposalDisplayed(pending.id, pending.boardRevision + 1)).toBe(false);
    confirm();
    const version = runtime.snapshot().math!.current!.steps[0].versions[0];
    expect(version.expression).toEqual(expression);
    expect(version.evidence.assessment.correctness).toBe(expression === correct ? "valid" : "incorrect");
    expect(version.evidence.assessment.reasoning).toBe("unassessed");
    expect(version.evidence.assessment.assistance).toBe("unknown");
    expect(version.evidence.demonstratedIndependent).toBe(false);
    expect(runtime.snapshot().runtime!.outputActivity).toBe("active");
    expect(publications.at(-1)!.math!.current!.steps).toHaveLength(1);
    expect(publications.at(-1)!.runtime!.outputActivity).toBe("active");
    expect(runtime.snapshot().runtime!.nodeId).toBe("cubic-minus-linear");
    expect(runtime.confirmMathProposal(pending.id, pending.boardRevision, ["differentiate"])).toBe(false);
    expect(runtime.snapshot().math!.current!.history).toHaveLength(1);
  },
);

it.each([
  { text: "Use the power rule.", kind: "strategy", extra: { method: "power" } },
  { text: "Three x to the", kind: "clarify", extra: { reason: "missing-operand" } },
])("keeps $kind non-mutating and does not invent an expression", async ({ text, kind, extra }) => {
  start();
  await learner(text);
  await respond([action(kind, extra)]);
  expect(runtime.snapshot().math!.disposition).toBe("pending-clarification");
  expect(runtime.snapshot().math!.current!.steps).toEqual([]);
  confirm("unassessed");
  expect(runtime.snapshot().math!.current!.steps).toEqual([]);
  expect(runtime.snapshot().math!.current!.history[0].evidence.mathematicallyComplete).toBe(false);
});

it("preserves chronological fragments and distinct turns without sourcing tutor words", async () => {
  start();
  emit({ type: "microphone.activity_started" });
  emit({ type: "transcript", speaker: "child", delta: "three x ", startMs: 100, endMs: 150 });
  emit({ type: "transcript", speaker: "child", delta: "squared", startMs: 151, endMs: 190 });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(301);
  events.tutorTurn("Continue.", 200);
  time = 400;
  await learner("minus four");
  const input = requests.at(-1)!.input;
  expect(input.learnerTurns.map(t => t.text)).toEqual(["three x squared", "minus four"]);
  expect(input.tutorContext.map(t => t.text)).toEqual(["Continue."]);
  expect(requests[0].signal.aborted).toBe(true);
});

it("retains a captured learner revision while tutor-only transcript changes", async () => {
  start();
  await learner("three x squared minus four");
  const revision = requests[0].input.identity.transcriptRevision;
  emit({ type: "transcript", speaker: "sprout", delta: "You can continue.", startMs: 400, endMs: 450 });
  expect(runtime.snapshot().runtime!.transcriptRevision).toBeGreaterThan(revision);
  expect(requests[0].signal.aborted).toBe(false);
  await respond([action("append", { expression: correct })]);
  confirm();
  expect(runtime.snapshot().math!.current!.history[0].evidence.identity.transcriptRevision).toBe(revision);
});

it.each(["stop", "speech", "correction", "skip", "next"])(
  "revokes extraction on %s even if endpoint ignores cancellation",
  async race => {
    start();
    await learner("three x squared minus four");
    if (race === "stop") runtime.stop();
    if (race === "speech") emit({ type: "microphone.speech_started" });
    if (race === "correction") await learner("Actually plus four.");
    if (race === "skip") {
      emit({ type: "output.activity", state: "quiet" });
      await vi.advanceTimersByTimeAsync(600);
      runtime.skipScene();
    }
    if (race === "next") {
      emit({ type: "output.activity", state: "active" });
      await learner("Next question.");
    }
    expect(requests[0].signal.aborted).toBe(true);
    await respond([action("append", { expression: correct }, 0)], 0);
    expect(runtime.snapshot().math!.current!.steps).toEqual([]);
    expect(runtime.snapshot().math!.pending).toBeNull();
  },
);

it("revokes displayed proposals on new learner speech and Stop", async () => {
  start();
  await learner("three x squared minus four");
  await respond([action("append", { expression: correct })]);
  const pending = runtime.snapshot().math!.pending!;
  runtime.confirmMathProposalDisplayed(pending.id, pending.boardRevision);
  await learner("Actually plus four.");
  expect(runtime.confirmMathProposal(pending.id, pending.boardRevision, ["differentiate"])).toBe(false);
  await respond([action("append", { expression: wrong })]);
  const newer = runtime.snapshot().math!.pending!;
  runtime.stop();
  expect(runtime.confirmMathProposalDisplayed(newer.id, newer.boardRevision)).toBe(false);
  expect(runtime.confirmMathProposal(newer.id, newer.boardRevision, ["differentiate"])).toBe(false);
});

it("retains incorrect first attempt, correction and undo history with fresh board bases", async () => {
  start();
  await learner("three x squared plus four");
  await respond([action("append", { expression: wrong })]);
  confirm();
  await learner("Replace that with three x squared minus four.");
  expect(requests[1].input.board).toHaveLength(1);
  expect(requests[1].input.identity.baseBoardRevision).toBe(1);
  expect(requests[1].input.learnerTurns).toHaveLength(1);
  await respond([action("replace", { targetStepId: "s1", expression: correct })]);
  confirm();
  await learner("Undo that correction.");
  await respond([action("undo", { targetStepId: "s1" })]);
  confirm("unassessed");
  const state = runtime.snapshot().math!.current!;
  expect(state.steps[0].currentVersionId).toBe("s1v1");
  expect(state.steps[0].versions).toHaveLength(2);
  expect(state.history).toHaveLength(3);
  expect(state.identity.baseBoardRevision).toBe(3);
  expect(state.history[2].withdrawsActionId).toBe("a2");
});

it("supports learner-confirmed original-function rewriting before differentiation", async () => {
  start();
  await learner("Rewrite as x times x squared minus four in parentheses.");
  const expression = {
    op: "multiply",
    args: [
      { op: "variable", name: "x" },
      {
        op: "subtract",
        left: { op: "power", base: { op: "variable", name: "x" }, exponent: 2 },
        right: { op: "number", value: 4 },
      },
    ],
  };
  await respond([action("append", { expression })]);
  confirm("rewrite");
  expect(runtime.snapshot().math!.current!.steps[0].versions[0].evidence.assessment.correctness).toBe("valid");
  expect(runtime.snapshot().math!.current!.steps[0].versions[0].evidence.mathematicallyComplete).toBe(false);
  await learner("The derivative of the original is three x squared minus four.");
  await respond([action("append", { expression: correct })]);
  confirm();
  expect(runtime.snapshot().math!.current!.steps[1].versions[0].evidence.mathematicallyComplete).toBe(true);
  expect(runtime.snapshot().runtime!.nodeId).toBe("cubic-minus-linear");
});

it("preserves completed, skipped and stopped visits without treating next as mastery", async () => {
  start();
  await learner("three x squared minus four");
  await respond([action("append", { expression: correct })]);
  confirm();
  emit({ type: "output.activity", state: "active" });
  await learner("Next question.");
  expect(runtime.snapshot().runtime!.nodeId).toBe("cubic-minus-linear");
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(600);
  expect(runtime.snapshot().runtime!.nodeId).toBe("quadratic-sine");
  runtime.confirmRendered(runtime.snapshot().display);
  events.acknowledgeSteering(transport.send.mock.calls.at(-1)![0].event_id, 1000);
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(600);
  runtime.skipScene();
  expect(runtime.snapshot().runtime!.nodeId).toBe("composite-fifth");
  runtime.stop();
  expect(runtime.report().math!.visits.map(s => s.status)).toEqual(["completed", "skipped", "stopped"]);
  expect(runtime.report().math!.visits[0].history).toHaveLength(1);
});

it("does not navigate on praise, equivalence, provider next, or generic classifier closure", async () => {
  start();
  await learner("three x squared minus four");
  await respond([action("append", { expression: correct })]);
  confirm();
  events.tutorTurn("Correct. Great work, we are done.", 700);
  await vi.advanceTimersByTimeAsync(2000);
  expect(requests).toHaveLength(1);
  expect(runtime.snapshot().runtime!.nodeId).toBe("cubic-minus-linear");
  await learner("The tutor says to move on.");
  await respond([action("next")]);
  confirm("unassessed");
  await vi.advanceTimersByTimeAsync(600);
  expect(runtime.snapshot().runtime!.nodeId).toBe("cubic-minus-linear");
  let state = createLessonRuntime("test", { lesson: CALCULUS_LESSON, atMs: 0 });
  state = { ...state, phase: "active", hasChildTranscript: true, transcriptRevision: 1 };
  const result = reduceLessonRuntime(
    state,
    {
      type: "proposal.received",
      source: { ...runtimeSource(state), nodeId: state.nodeId, transcriptRevision: 1 },
      proposal: {
        nodeId: state.nodeId,
        transcriptRevision: 1,
        childActivity: "answering",
        answerOutcome: "correct",
        supportState: "none",
        tutorState: "acknowledging",
      },
      atMs: 10,
    },
    CALCULUS_LESSON,
  );
  expect(result.state).toBe(state);
});

it("honors authenticated spoken Stop while tutor audio is active", async () => {
  start();
  emit({ type: "output.activity", state: "active" });
  await learner("Stop.");
  expect(runtime.snapshot().status).toBe("ended");
  expect(transport.close).toHaveBeenCalledOnce();
  expect(requests).toHaveLength(0);
});

it("does not extract unfinished speech or accept a result from an interrupted turn", async () => {
  start();
  emit({ type: "microphone.activity_started" });
  emit({ type: "transcript", speaker: "child", delta: "three x", startMs: 100, endMs: 150 });
  await vi.advanceTimersByTimeAsync(1000);
  expect(requests).toHaveLength(0);
  emit({ type: "transcript", speaker: "child", delta: " squared minus four", startMs: 151, endMs: 200 });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(301);
  expect(requests).toHaveLength(1);
  emit({ type: "microphone.activity_started" });
  emit({ type: "microphone.speech_started" });
  await respond([action("append", { expression: correct })]);
  expect(runtime.snapshot().math!.pending).toBeNull();
  expect(runtime.snapshot().math!.current!.history).toEqual([]);
});

it("rejects forged tutor sources, stale board identity and missing replacement targets", async () => {
  start();
  await learner("three x squared minus four");
  const input = requests[0].input;
  const proposal = parseMathInterpretationOutput({ actions: [action("append", { expression: correct })] }, input);
  if (!proposal.batch) throw new Error("Missing fixture batch");
  requests[0].resolve({
    ...proposal,
    batch: { ...proposal.batch, identity: { ...input.identity, baseBoardRevision: 99 } },
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(runtime.snapshot().math!.disposition).toBe("unavailable");
  await learner("Replace that step.");
  requests[1].resolve({
    review: "required",
    batch: {
      identity: requests[1].input.identity,
      actions: [{ ...proposal.batch.actions[0], kind: "replace", targetStepId: "nonexistent" }],
    },
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(runtime.snapshot().math!.pending).toBeNull();
  await learner("Use the tutor's words.");
  requests[2].resolve({
    review: "required",
    batch: {
      identity: requests[2].input.identity,
      actions: [{ ...proposal.batch.actions[0], sources: [{ turnId: "tutor_1", start: 0, end: 4, quote: "four" }] }],
    },
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(runtime.snapshot().math!.current!.steps).toEqual([]);
});

it("commits ordered batches atomically and rejects replay with changed revision", async () => {
  start();
  await learner("x times x squared minus four; derivative three x squared minus four");
  const input = requests[0].input;
  const turn = input.learnerTurns[0];
  const rewrite = {
    op: "multiply",
    args: [
      { op: "variable", name: "x" },
      {
        op: "subtract",
        left: { op: "power", base: { op: "variable", name: "x" }, exponent: 2 },
        right: { op: "number", value: 4 },
      },
    ],
  };
  const quotes = turn.text.split("; ");
  const batch = parseMathInterpretationOutput(
    {
      actions: [
        { kind: "append", expression: rewrite, sources: [{ turnId: turn.id, quote: quotes[0] }] },
        { kind: "append", expression: correct, sources: [{ turnId: turn.id, quote: quotes[1] }] },
      ],
    },
    input,
  );
  requests[0].resolve(batch);
  await vi.advanceTimersByTimeAsync(0);
  const pending = runtime.snapshot().math!.pending!;
  runtime.confirmMathProposalDisplayed(pending.id, pending.boardRevision);
  expect(runtime.confirmMathProposal(pending.id, pending.boardRevision, ["rewrite"])).toBe(false);
  expect(runtime.snapshot().math!.current!.steps).toEqual([]);
  expect(runtime.confirmMathProposal(pending.id, pending.boardRevision, ["rewrite", "differentiate"])).toBe(true);
  expect(runtime.snapshot().math!.current!.steps).toHaveLength(2);
  expect(runtime.snapshot().math!.current!.identity.baseBoardRevision).toBe(1);
  await learner("Again.");
  requests[1].resolve(batch);
  await vi.advanceTimersByTimeAsync(0);
  expect(runtime.snapshot().math!.current!.steps).toHaveLength(2);
  expect(runtime.snapshot().math!.pending).toBeNull();
});

it("holds unsupported and unassessed operations without turning them into incorrect work or mastery", async () => {
  start();
  await learner("x to the negative one");
  await respond([action("append", { expression: { op: "power", base: { op: "variable", name: "x" }, exponent: -1 } })]);
  confirm();
  expect(runtime.snapshot().math!.current!.history[0].evidence.assessment).toMatchObject({
    disposition: "unresolved",
    correctness: "unsupported",
  });
  await learner("A function step whose operation is uncertain");
  await respond([action("append", { expression: correct })]);
  confirm("unassessed");
  expect(runtime.snapshot().math!.current!.history[1].evidence.assessment.correctness).toBe("unchecked");
  expect(runtime.snapshot().math!.current!.history[1].evidence.mathematicallyComplete).toBe(false);
});

it("keeps the original runtime frozen when a fresh runtime is started", async () => {
  start();
  await learner("three x squared minus four");
  const old = runtime;
  old.stop();
  start();
  await respond([action("append", { expression: correct }, 0)], 0);
  expect(old.snapshot().math!.current!.status).toBe("stopped");
  expect(old.snapshot().math!.current!.steps).toEqual([]);
  expect(runtime.snapshot().math!.current!.steps).toEqual([]);
  expect(runtime.snapshot().math!.current!.identity.runtimeId).not.toBe(
    old.snapshot().math!.current!.identity.runtimeId,
  );
});

it("checks product-rule derivative notation then simplification against the actual derivative line", async () => {
  const definition = { ...CALCULUS_LESSON, initialNodeId: "quadratic-sine" };
  runtime = new LessonRuntime({} as HTMLAudioElement, () => {}, definition);
  runtime.confirmRendered(runtime.snapshot().display);
  events.acknowledgeSteering(transport.send.mock.calls.at(-1)![0].event_id, 0);
  const route = getCalculusReviewKey("quadratic-sine").routes[0];
  const intermediate = route.steps[0].expression;
  const final = getCalculusReviewKey("quadratic-sine").finalForms[0];
  await learner("Derivative of x squared times sine x plus x squared times derivative of sine x.");
  await respond([action("append", { expression: intermediate })]);
  confirm();
  expect(runtime.snapshot().math!.current!.history[0].evidence.assessment.correctness).toBe("valid");
  await learner("Simplify that to two x sine x plus x squared cosine x.");
  await respond([action("append", { expression: final })]);
  confirm("rewrite");
  const math = runtime.snapshot().math!;
  expect(math.current!.history[1].evidence.assessment.correctness).toBe("valid");
  expect(math.checks[1].base).toEqual({ expression: intermediate, role: "derivative" });
  expect(math.checks[1].result!.transformationCorrectness).toBe("valid");
});

it("does not excuse an invalid rewrite out of a wrong derivative merely because its final value is correct", async () => {
  start();
  await learner("three x squared plus four");
  await respond([action("append", { expression: wrong })]);
  confirm();
  await learner("Rewrite it as three x squared minus four");
  await respond([action("append", { expression: correct })]);
  confirm("rewrite");
  const math = runtime.snapshot().math!;
  expect(math.checks[1].result).toMatchObject({
    expressionCorrectness: "valid",
    transformationCorrectness: "incorrect",
    completeDerivative: false,
  });
  expect(math.current!.history[1].evidence.assessment.correctness).toBe("incorrect");
});

it("replacement checks its retained input and undo restores role and context for following steps", async () => {
  start();
  await learner("three x squared plus four");
  await respond([action("append", { expression: wrong })]);
  confirm();
  await learner("Replace that with three x squared minus four");
  await respond([action("replace", { targetStepId: "s1", expression: correct })]);
  confirm();
  expect(runtime.snapshot().math!.checks[1].base!.role).toBe("function");
  expect(runtime.snapshot().math!.checks[1].result!.correctness).toBe("valid");
  await learner("Undo the correction");
  await respond([action("undo", { targetStepId: "s1" })]);
  confirm("unassessed");
  await learner("Simplify to three x squared minus four");
  await respond([action("append", { expression: correct })]);
  confirm("rewrite");
  expect(runtime.snapshot().math!.checks[2].base).toEqual({ expression: wrong, role: "derivative" });
  expect(runtime.snapshot().math!.checks[2].result!.transformationCorrectness).toBe("incorrect");
});

function feedbackCommands() {
  return transport.send.mock.calls
    .map(([command]) => command)
    .filter(command => command.type === "session.instructions.append" && command.event_id.includes(":math:"));
}
function confirmBoard() {
  const feedback = runtime.snapshot().math!.feedback!;
  expect(feedback.target).toBe("board");
  expect(runtime.confirmMathFeedbackDisplayed(feedback.token)).toBe(true);
  return feedback.token;
}

it("sends exact proposal context only after matching display, and board feedback only after its own display", async () => {
  start();
  await learner("three x squared plus four");
  await respond([action("append", { expression: wrong })]);
  const proposal = runtime.snapshot().math!.pending!;
  const proposalToken = runtime.snapshot().math!.feedback!.token;
  expect(feedbackCommands()).toEqual([]);
  expect(runtime.confirmMathFeedbackDisplayed(proposalToken)).toBe(false);
  expect(runtime.confirmMathProposalDisplayed(proposal.id, 99)).toBe(false);
  expect(feedbackCommands()).toEqual([]);
  confirm();
  const proposalFeedback = feedbackCommands()[0];
  expect(proposalFeedback).toMatchObject({ type: "session.instructions.append", delegation_id: null });
  if (proposalFeedback.type !== "session.instructions.append") throw new Error("Missing append");
  expect(proposalFeedback.content).toContain(proposal.id);
  expect(proposalFeedback.content).toContain(JSON.stringify(compactMathExpression(wrong)));
  expect(proposalFeedback.content).toContain("EXACT displayed proposal");
  expect(feedbackCommands()).toHaveLength(1);
  expect(runtime.snapshot().math!.current!.steps).toHaveLength(1);
  expect(runtime.snapshot().awaitingSteering).toBe(false);
  emit({ type: "output.activity", state: "active" });
  const boardToken = confirmBoard();
  expect(feedbackCommands()).toHaveLength(2);
  const boardFeedback = feedbackCommands()[1];
  if (boardFeedback.type !== "session.instructions.append") throw new Error("Missing append");
  expect(boardFeedback.content).toContain('"correctness":"incorrect"');
  expect(boardFeedback.content).toContain("do not give its replacement");
  expect(runtime.confirmMathFeedbackDisplayed(boardToken)).toBe(false);
  expect(runtime.confirmMathFeedbackDisplayed(proposalToken)).toBe(false);
  // No acknowledgment has arrived. A correction must still commit immediately.
  await learner("Replace that with three x squared minus four");
  await respond([action("replace", { targetStepId: "s1", expression: correct })]);
  confirm();
  expect(publications.at(-1)!.math!.current!.steps[0].currentVersionId).toBe("s1v2");
  expect(publications.at(-1)!.runtime!.outputActivity).toBe("active");
});

it.each(["speech", "correction", "board", "visit", "stop"])(
  "suppresses unshown feedback superseded by %s",
  async race => {
    start();
    await learner("three x squared plus four");
    await respond([action("append", { expression: wrong })]);
    confirm();
    const token = runtime.snapshot().math!.feedback!.token;
    const before = feedbackCommands().length;
    if (race === "speech") emit({ type: "microphone.speech_started" });
    if (race === "correction" || race === "board") {
      await learner("Replace that with three x squared minus four");
      if (race === "board") {
        await respond([action("replace", { targetStepId: "s1", expression: correct })]);
        confirm();
      }
    }
    if (race === "visit") {
      emit({ type: "output.activity", state: "quiet" });
      await vi.advanceTimersByTimeAsync(600);
      runtime.skipScene();
      runtime.confirmRendered(runtime.snapshot().display);
      events.acknowledgeSteering(transport.send.mock.calls.at(-1)![0].event_id, 1000);
    }
    if (race === "stop") runtime.stop();
    const after = feedbackCommands().length;
    expect(after).toBe(before + (race === "board" ? 1 : 0));
    expect(runtime.confirmMathFeedbackDisplayed(token)).toBe(false);
    expect(feedbackCommands()).toHaveLength(after);
  },
);

it.each(["hint", "unknown-help"] as const)(
  "retains %s provenance across in-flight extraction and subsequent correction",
  async kind => {
    start();
    expect(runtime.recordMathSourceEvent(kind, "App-retained help before the first learner turn")).toBe(true);
    await learner("three x squared plus four");
    // Tutor-only updates must not revoke extraction or establish learner evidence.
    events.tutorTurn("Try checking that step. Great effort.", 350);
    expect(requests[0].signal.aborted).toBe(false);
    await respond([action("append", { expression: wrong })]);
    confirm();
    await learner("Replace it with three x squared minus four");
    await respond([action("replace", { targetStepId: "s1", expression: correct })]);
    confirm();
    const state = runtime.snapshot().math!.current!;
    expect(state.history.map(entry => entry.evidence.assessment.assistance)).toEqual(
      kind === "hint" ? ["hinted", "hinted"] : ["unknown", "unknown"],
    );
    expect(
      state.history.every(
        entry => !entry.evidence.demonstratedIndependent && entry.evidence.assessment.reasoning === "unassessed",
      ),
    ).toBe(true);
    expect(state.history[1].evidence.sourceEventIds).toContain(state.sourceEvents[0].id);
    expect(state.sourceEvents.map(event => event.order)).toEqual(
      [...state.sourceEvents.map(event => event.order)].sort((a, b) => a - b),
    );
    expect(new Set(state.sourceEvents.map(event => event.order)).size).toBe(state.sourceEvents.length);
  },
);

it("records app help controls and unclassified tutor output without ever sourcing tutor praise or recitation", async () => {
  start();
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(600);
  runtime.requestSupport("help");
  expect(runtime.snapshot().math!.current!.sourceEvents.at(-1)?.kind).toBe("hint");
  events.acknowledgeSteering(transport.send.mock.calls.at(-1)![0].event_id, 0);
  events.tutorTurn("Three x squared minus four. Correct, you understand everything.", 50);
  await vi.advanceTimersByTimeAsync(600);
  expect(runtime.snapshot().math!.current!.history).toEqual([]);
  expect(runtime.snapshot().math!.pending).toBeNull();
  expect(requests).toEqual([]);
  expect(runtime.snapshot().math!.current!.sourceEvents.at(-1)?.kind).toBe("unknown-help");
  await learner("three x squared minus four");
  await respond([action("append", { expression: correct })]);
  confirm();
  const evidence = runtime.snapshot().math!.current!.history[0].evidence;
  expect(evidence.assessment.assistance).toBe("hinted");
  expect(evidence.demonstratedIndependent).toBe(false);
  expect(evidence.assessment.reasoning).toBe("unassessed");
});

it("keeps acceptance published when feedback append fails, and ignores late acknowledgments", async () => {
  start();
  await learner("three x squared minus four");
  await respond([action("append", { expression: correct })]);
  confirm();
  transport.send.mockImplementationOnce(() => {
    throw new Error("send failed");
  });
  confirmBoard();
  expect(runtime.snapshot().status).toBe("live");
  expect(runtime.snapshot().math!.current!.steps).toHaveLength(1);
  const command = feedbackCommands().at(-1)!;
  events.acknowledgeSteering(command.event_id, 9999);
  expect(runtime.snapshot().awaitingSteering).toBe(false);
  await learner("Undo that");
  expect(requests).toHaveLength(2);
});

it("does not accept a proposal from tutor confirmation or an ordinary generic yes turn", async () => {
  start();
  await learner("three x squared minus four");
  await respond([action("append", { expression: correct })]);
  const pending = runtime.snapshot().math!.pending!;
  runtime.confirmMathProposalDisplayed(pending.id, pending.boardRevision);
  events.tutorTurn("Yes, that is correct; accepted.", 400);
  expect(runtime.snapshot().math!.current!.history).toEqual([]);
  expect(runtime.snapshot().math!.pending!.id).toBe(pending.id);
  time = 600;
  await learner("Yes.");
  expect(runtime.confirmMathProposal(pending.id, pending.boardRevision, ["differentiate"])).toBe(false);
  expect(runtime.snapshot().math!.current!.history).toEqual([]);
});

it("orders help between fragments before the completed learner action", async () => {
  start();
  emit({ type: "microphone.activity_started" });
  emit({ type: "transcript", speaker: "child", delta: "three x ", startMs: 100, endMs: 150 });
  runtime.recordMathSourceEvent("hint", "App hint while notation is incomplete");
  emit({ type: "transcript", speaker: "child", delta: "squared minus four", startMs: 151, endMs: 200 });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(301);
  expect(requests[0].input.learnerTurns[0].text).toBe("three x squared minus four");
  await respond([action("append", { expression: correct })]);
  confirm();
  expect(runtime.snapshot().math!.current!.history[0].evidence.assessment.assistance).toBe("hinted");
});

it("preserves pending authority on later help without retroactively changing earlier evidence", async () => {
  start();
  await learner("three x squared plus four");
  await respond([action("append", { expression: wrong })]);
  runtime.recordMathSourceEvent("hint", "Later app hint");
  events.tutorTurn("Check your work.", 400);
  confirm();
  expect(runtime.snapshot().math!.current!.history[0].evidence.assessment.assistance).toBe("unknown");
  time = 600;
  await learner("Replace that with three x squared minus four");
  await respond([action("replace", { targetStepId: "s1", expression: correct })]);
  confirm();
  expect(runtime.snapshot().math!.current!.history[1].evidence.assessment.assistance).toBe("hinted");
});

it("records a confirmed help action's issued hint for the learner's subsequent math", async () => {
  start();
  await learner("Can I have help?");
  await respond([action("help")]);
  confirm("unassessed");
  confirmBoard();
  expect(runtime.snapshot().math!.current!.sourceEvents.at(-1)?.kind).toBe("hint");
  await learner("three x squared minus four");
  await respond([action("append", { expression: correct })]);
  confirm();
  const evidence = runtime.snapshot().math!.current!.history[1].evidence;
  expect(evidence.assessment.assistance).toBe("hinted");
  expect(evidence.demonstratedIndependent).toBe(false);
});

it("does not invent issued help when its support append fails", async () => {
  start();
  emit({ type: "output.activity", state: "quiet" });
  await vi.advanceTimersByTimeAsync(600);
  transport.send.mockImplementationOnce(() => {
    throw new Error("send failed");
  });
  runtime.requestSupport("help");
  expect(runtime.snapshot().math!.current!.sourceEvents).toEqual([]);
});

it("reserves the displayed proposal before onset, accepts only at turn end, and consumes confirmation words", async () => {
  start();
  await learner("three x squared minus four");
  await respond([action("append", { expression: correct })]);
  const pending = runtime.snapshot().math!.pending!;
  runtime.confirmMathProposalDisplayed(pending.id, pending.boardRevision);
  emit({ type: "microphone.activity_started" });
  expect(runtime.confirmMathProposal(pending.id, pending.boardRevision, ["differentiate"])).toBe(false);
  emit({ type: "transcript", speaker: "child", delta: "confirm differentiation", startMs: time, endMs: time + 100 });
  expect(runtime.snapshot().math!.current!.steps).toHaveLength(0);
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  expect(runtime.snapshot().math!.current!.steps).toHaveLength(1);
  expect(runtime.report().mathConfirmations?.[0]).toMatchObject({ id: pending.id, text: "confirm differentiation" });
  time += 200;
  await vi.advanceTimersByTimeAsync(400);
  expect(requests).toHaveLength(1);
  await learner("replace that with three x squared plus four");
  expect(requests[1].input.learnerTurns.map(turn => turn.text)).toEqual([
    "replace that with three x squared plus four",
  ]);
});

it.each([
  "yes",
  "do not confirm differentiation",
  "confirm differentiation but change four",
  'She said "confirm differentiation"',
  "if correct confirm differentiation",
])("revokes reservation for ordinary or ineligible words: %s", async text => {
  start();
  await learner("three x squared minus four");
  await respond([action("append", { expression: correct })]);
  const pending = runtime.snapshot().math!.pending!;
  runtime.confirmMathProposalDisplayed(pending.id, pending.boardRevision);
  await learner(text);
  expect(runtime.snapshot().math!.current!.steps).toHaveLength(0);
  expect(runtime.confirmMathProposal(pending.id, pending.boardRevision, ["differentiate"])).toBe(false);
  expect(requests).toHaveLength(2);
});

it("cannot confirm a stale, undelivered, overlong, or stopped proposal", async () => {
  start();
  await learner("three x squared minus four");
  await respond([action("append", { expression: correct })]);
  await learner("confirm differentiation");
  expect(runtime.snapshot().math!.current!.steps).toHaveLength(0);
  await respond([action("append", { expression: correct })]);
  let pending = runtime.snapshot().math!.pending!;
  runtime.confirmMathProposalDisplayed(pending.id, pending.boardRevision);
  emit({ type: "microphone.activity_started" });
  emit({ type: "transcript", speaker: "child", delta: "confirm differentiation", startMs: time, endMs: time + 100 });
  await vi.advanceTimersByTimeAsync(8001);
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  expect(runtime.snapshot().math!.current!.steps).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(301);
  await respond([action("append", { expression: correct })]);
  pending = runtime.snapshot().math!.pending!;
  runtime.confirmMathProposalDisplayed(pending.id, pending.boardRevision);
  emit({ type: "microphone.activity_started" });
  runtime.stop();
  emit({
    type: "transcript",
    speaker: "child",
    delta: "confirm differentiation",
    startMs: time + 200,
    endMs: time + 300,
  });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  expect(runtime.snapshot().math!.current!.steps).toHaveLength(0);
});

it.each(["help", "repeat"] as const)(
  "routes exact spoken %s through app support once, with consumed words",
  async request => {
    start();
    emit({ type: "output.activity", state: "active" });
    emit({ type: "output.activity", state: "quiet" });
    await vi.advanceTimersByTimeAsync(600);
    const before = transport.send.mock.calls.length;
    await learner(request);
    expect(transport.send.mock.calls).toHaveLength(before + 1);
    expect(transport.send.mock.calls.at(-1)![0].event_id).toContain(":support:");
    const command = transport.send.mock.calls.at(-1)![0];
    events.acknowledgeSteering(command.event_id, 0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(transport.send.mock.calls).toHaveLength(before + 1);
    expect(requests).toHaveLength(0);
    expect(runtime.snapshot().math!.current!.sourceEvents.at(-1)?.kind).toBe(
      request === "help" ? "hint" : "neutral-probe",
    );
    await learner("my next derivative");
    expect(requests[0].input.learnerTurns.map(t => t.text)).toEqual(["my next derivative"]);
  },
);

it("does not treat quoted or negated support/navigation as a command", async () => {
  start();
  for (const text of ['she said "repeat"', "do not help", 'she said "next"', "do not skip this problem"]) {
    await learner(text);
    expect(runtime.snapshot().runtime!.nodeId).toBe("cubic-minus-linear");
  }
  expect(transport.send.mock.calls).toHaveLength(1);
  expect(requests).toHaveLength(4);
});

it("authenticates a whole ordered mixed batch and never a tutor confirmation", async () => {
  start();
  await learner("rewrite the function then differentiate it");
  const expression = getCalculusReviewKey("cubic-minus-linear").routes[0].steps[0].expression;
  const turn = requests.at(-1)!.input.learnerTurns.at(-1)!;
  await respond([
    { kind: "append", expression, sources: [{ turnId: turn.id, quote: "rewrite the function" }] },
    { kind: "append", expression: correct, sources: [{ turnId: turn.id, quote: "differentiate it" }] },
  ]);
  const pending = runtime.snapshot().math!.pending!;
  runtime.confirmMathProposalDisplayed(pending.id, pending.boardRevision);
  events.tutorTurn("confirm differentiation", time);
  time += 200;
  expect(runtime.snapshot().math!.current!.steps).toHaveLength(0);
  await learner("action 1 confirm rewrite; action 2 confirm differentiation");
  expect(runtime.snapshot().math!.current!.steps).toHaveLength(2);
  expect(runtime.snapshot().math!.checks.map(check => check.operation)).toEqual(["rewrite", "differentiate"]);
});

it.each(["microphone.activity_discarded", "microphone.speech_stopped"] as const)(
  "revokes a displayed proposal on %s without new words or a fabricated revision",
  async type => {
    start();
    await learner("three x squared minus four");
    await respond([action("append", { expression: correct })]);
    const pending = runtime.snapshot().math!.pending!;
    runtime.confirmMathProposalDisplayed(pending.id, pending.boardRevision);
    const revision = runtime.snapshot().math!.current!.identity.transcriptRevision;
    emit({ type: "microphone.activity_started" });
    expect(() => emit(type === "microphone.speech_stopped" ? { type, quietMs: 900 } : { type })).not.toThrow();
    expect(runtime.snapshot().math!.current!.identity.transcriptRevision).toBe(revision);
    expect(runtime.snapshot().math!.current!.steps).toHaveLength(0);
    expect(runtime.snapshot().math!.pending).toBeNull();
  },
);

it("revokes reservation immediately when a later fragment adds correction words", async () => {
  start();
  await learner("three x squared minus four");
  await respond([action("append", { expression: correct })]);
  const pending = runtime.snapshot().math!.pending!;
  runtime.confirmMathProposalDisplayed(pending.id, pending.boardRevision);
  emit({ type: "microphone.activity_started" });
  emit({ type: "transcript", speaker: "child", delta: "confirm differentiation", startMs: time, endMs: time + 100 });
  emit({ type: "transcript", speaker: "child", delta: " except change four", startMs: time + 100, endMs: time + 200 });
  expect(runtime.snapshot().math!.pending).toBeNull();
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  expect(runtime.snapshot().math!.current!.steps).toHaveLength(0);
});

it("does not replay accepted fragments after a late tutor fragment changes turn grouping", async () => {
  start();
  emit({ type: "microphone.activity_started" });
  emit({ type: "transcript", speaker: "child", delta: "three x squared ", startMs: 100, endMs: 150 });
  emit({ type: "transcript", speaker: "child", delta: "minus four", startMs: 200, endMs: 250 });
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(301);
  await respond([action("append", { expression: correct })]);
  confirm();
  events.tutorTurn("Tell me about that step", 175);
  time = 500;
  await learner("my correction");
  expect(requests.at(-1)!.input.learnerTurns.map(turn => turn.text)).toEqual(["my correction"]);
});

it("a correlated provider feedback error cannot end the session or undo accepted work", async () => {
  start();
  await learner("three x squared minus four");
  await respond([action("append", { expression: correct })]);
  confirm();
  confirmBoard();
  emit({ type: "provider.error", code: "invalid_value", clientEventId: feedbackCommands().at(-1)!.event_id });
  expect(runtime.snapshot().status).toBe("live");
  expect(runtime.snapshot().math!.current!.steps).toHaveLength(1);
});

it("coalesces more than sixteen streaming tutor deltas before the next math extraction", async () => {
  start();
  await learner("three x squared minus four");
  await respond([action("append", { expression: correct })]);
  confirm();
  for (let index = 0; index < 24; index++) {
    emit({
      type: "transcript",
      speaker: "sprout",
      delta: `tutor fragment ${index}. `,
      startMs: time,
      endMs: time + 100,
    });
    time += 110;
  }
  await learner("my next step");
  expect(requests).toHaveLength(2);
  expect(requests[1].input.tutorContext).toHaveLength(1);
  expect(requests[1].input.tutorContext[0].text).toContain("tutor fragment 0.");
  expect(requests[1].input.tutorContext[0].text).toContain("tutor fragment 23.");
  expect(requests[1].input.learnerTurns.map(turn => turn.text)).toEqual(["my next step"]);
});

it("marks omitted long tutor context and retains its bounded recent suffix", async () => {
  start();
  events.tutorTurn("earlier ".repeat(300) + "latest help", time);
  time += 200;
  await learner("my next step");
  const context = requests[0].input.tutorContext[0].text;
  expect(context).toHaveLength(2000);
  expect(context).toMatch(/^\[Earlier tutor context omitted/);
  expect(context).toMatch(/latest help$/);
});

it.each([{ actions: [null] }, { actions: {} }, { actions: "invalid" }])(
  "retains rejected malformed raw proposals without breaking export: %j",
  async batch => {
    start();
    await learner("sine or sign x squared, I am unsure");
    requests[0].resolve({ review: "required", batch });
    await vi.advanceTimersByTimeAsync(0);
    const report = runtime.report().mathDiagnostics!;
    expect(report.requests[0].rawProposal).toEqual(batch);
    expect(report.requests[0].proposal).toBeNull();
    expect(report.requests[0].disposition).toBe("rejected");
    expect(report.requests[0].actions).toEqual([]);
    expect(runtime.snapshot().math!.current!.steps).toEqual([]);
  },
);

it.each(["stop", "speech", "next"])("exports malformed late interpretation after %s safely", async race => {
  start();
  await learner("x to the power, or perhaps sine x");
  if (race === "stop") runtime.stop();
  if (race === "speech") emit({ type: "microphone.activity_started" });
  if (race === "next") {
    await learner("next");
    await vi.advanceTimersByTimeAsync(2000);
  }
  requests[0].resolve({ review: "required", batch: { actions: [null] } });
  await vi.advanceTimersByTimeAsync(0);
  const request = runtime.report().mathDiagnostics!.requests[0];
  expect(request.disposition).toBe("stale");
  expect(request.actions).toEqual([]);
  expect(runtime.snapshot().math!.current!.steps).toEqual([]);
});

it.each(["sine or sign x", "x squared or x to an unknown power"])(
  "records ambiguous dictation without inventing math: %s",
  async text => {
    start();
    await learner(text);
    await respond([action("clarify", { reason: "ambiguous" })]);
    confirm("unassessed");
    const request = runtime.report().mathDiagnostics!.requests[0];
    expect(request.rawLearnerTurns![0].text).toBe(text);
    expect(request.after!.steps).toEqual([]);
    expect(request.after!.history[0].evidence.demonstratedIndependent).toBe(false);
  },
);

it("deduplicates event/transcript/result delivery and UI confirmations without inventing spoken turns", async () => {
  start();
  emit({ type: "microphone.activity_started" });
  const transcript = {
    type: "transcript" as const,
    speaker: "child" as const,
    delta: "three x squared minus four",
    startMs: 100,
    endMs: 200,
    eventId: "same-transcript",
  };
  emit(transcript);
  emit(transcript);
  emit({ type: "microphone.speech_stopped", quietMs: 900 });
  await vi.advanceTimersByTimeAsync(301);
  await respond([action("append", { expression: correct })]);
  const pending = runtime.snapshot().math!.pending!;
  const body = parseMathInterpretationOutput(
    { actions: [action("append", { expression: correct })] },
    requests[0].input,
  );
  requests[0].resolve(body);
  confirm();
  expect(runtime.confirmMathProposal(pending.id, pending.boardRevision, ["differentiate"])).toBe(false);
  const report = runtime.report();
  expect(report.math!.current!.history).toHaveLength(1);
  expect(report.mathDiagnostics!.requests[0].rawLearnerTurns![0].text).toBe(transcript.delta);
  expect(
    report.mathDiagnostics!.requests[0].confirmations.filter(e => (e.detail as { accepted: boolean }).accepted),
  ).toHaveLength(1);
  expect(report.mathConfirmations).toEqual([]);
  expect(report.math!.current!.history[0].evidence.demonstratedIndependent).toBe(false);
});

it("exports a valid equivalent expression outside supported trig identities as unresolved", async () => {
  start();
  await learner(
    "my derivative is open parenthesis three x squared minus four close parenthesis times open parenthesis sine squared x plus cosine squared x close parenthesis",
  );
  const x: MathExpression = { op: "variable", name: "x" };
  const expression: MathExpression = {
    op: "multiply",
    args: [
      correct,
      {
        op: "add",
        args: [
          { op: "power", base: { op: "sin", argument: x }, exponent: 2 },
          { op: "power", base: { op: "cos", argument: x }, exponent: 2 },
        ],
      },
    ],
  };
  await respond([action("append", { expression })]);
  confirm();
  const request = runtime.report().mathDiagnostics!.requests[0];
  expect(request.after!.history[0].evidence.assessment).toMatchObject({
    correctness: "unsupported",
    disposition: "unresolved",
    reasoning: "unassessed",
  });
  expect(request.after!.steps[0].versions[0].expression).toEqual(expression);
  expect(request.after!.history[0].evidence.demonstratedIndependent).toBe(false);
});
