import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MathScribeRuntime, scribeInstruction } from "../lib/lesson-runtime/math-scribe-runtime";
import type { CalculusFragment } from "../lib/lesson-runtime/calculus-runtime";
import type { LessonRuntimeState } from "../lib/lesson-runtime/lesson-runtime-reducer";
import { readAlgebraLatex } from "../lib/math-audit/latex";
import { listParts } from "../lib/math-scribe/parts";
import type { Interpretation } from "../lib/math-scribe/session";
import fixtures from "./fixtures/math-scribe-utterances.json";

function expression(latex: string) {
  const result = readAlgebraLatex(latex);
  if (!result.ok) throw new Error(result.reason);
  return result.expression;
}

describe("math scribe voice runtime", () => {
  let fragments: CalculusFragment[];
  let state: LessonRuntimeState;
  let messages: string[];
  let logs: { type: string; detail: unknown }[];
  let fetcher: ReturnType<typeof vi.fn>;
  let publish: ReturnType<typeof vi.fn>;
  let runtime: MathScribeRuntime;
  let turn: number;

  beforeEach(() => {
    vi.useFakeTimers();
    fragments = [];
    messages = [];
    logs = [];
    turn = 0;
    state = { childTurnId: 0, visitId: 1, hasChildTranscript: true } as LessonRuntimeState;
    fetcher = vi.fn();
    publish = vi.fn();
    runtime = new MathScribeRuntime(
      "runtime",
      () => ({ state, fragments, quiet: true, steering: false }),
      publish as () => void,
      (type, detail) => logs.push({ type, detail }),
      (_id, text) => messages.push(text),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      () => true,
      () => false,
      100,
      fetcher as typeof fetch,
    );
    runtime.onStart("reciprocal", 1);
  });
  afterEach(() => vi.useRealTimers());

  function fragment(text: string, speaker: "child" | "sprout" = "child") {
    if (speaker === "child") state = { ...state, childTurnId: ++turn };
    fragments.push({
      event: { type: "transcript", speaker, delta: text, startMs: 0, endMs: 1 },
      source: { runtimeId: "runtime", visitId: 1, childTurnId: turn },
      order: fragments.length + 1,
    });
  }
  function respond(...interpretations: Interpretation[]) {
    fetcher.mockResolvedValueOnce({
      json: async () => ({ status: "ok", interpretations, diagnostics: { dropped: [] }, timing: { extractionMs: 2 } }),
    });
  }
  async function say(text: string, ...interpretations: Interpretation[]) {
    respond(...interpretations);
    fragment(text);
    runtime.onQuiet();
    await vi.advanceTimersByTimeAsync(100);
  }
  function part(description: string) {
    const line = runtime.snapshot().session!.workingLine.expression;
    const found = listParts(line).find(item => item.description === description);
    if (!found) throw new Error(description);
    return found.id;
  }
  const proposal = (
    operation: Extract<Interpretation, { intent: "propose" }>["operation"],
    source: "instruction" | "report" = "instruction",
  ): Interpretation => ({ intent: "propose", operation, source, quote: "said" });

  it("passes an open factor clarification into the next read", async () => {
    await say("flip", proposal({ kind: "division-to-reciprocal", partId: part("divisor") }));
    const partId = part("numerator of factor 2");
    const prompt = "six times open bracket- open bracket 2 x plus 5 y close bracket";
    await say(
      `factor six out ${prompt}`,
      {
        intent: "propose",
        source: "instruction",
        quote: "factor six out",
        operation: { kind: "non-unique", name: "factor", partId },
      },
      { intent: "clarify", question: "What is inside the brackets?", quote: prompt },
    );
    await vi.advanceTimersByTimeAsync(2000);
    await say("It would be 2x plus 5 y", {
      intent: "propose",
      source: "report",
      quote: "It would be 2x plus 5 y",
      operation: { kind: "replace-part", partId, expression: expression("6(2x+5y)") },
    });
    const request = JSON.parse(fetcher.mock.calls.at(-1)![1].body);
    expect(request.openQuestion).toMatchObject({
      question: "What is inside the brackets?",
      prompt,
      operation: "factor",
      part: { id: partId, description: "numerator of factor 2", latex: "12x+30y" },
    });
    expect(runtime.snapshot().session?.workingLine.latex).toContain("6(2x+5y)");
    expect(runtime.snapshot().session?.clarification).toBeNull();
  });

  it.each([
    "I'm done",
    "I am done",
    "I'm finished",
    "done",
    "finished",
    "that's my answer",
    "that's the answer",
    "that's the solution",
    "I'm done with this problem",
    "I'm- I'm done",
    "um, I'm done",
    "okay I'm done",
  ])("navigates without interpreting finish phrase %s", async text => {
    fragment(text);
    expect(runtime.onQuiet()).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requires checking a pending line and consumes the finish phrase", async () => {
    await say("flip", proposal({ kind: "division-to-reciprocal", partId: part("divisor") }));
    fragment("I'm- I'm done");
    expect(runtime.onQuiet()).toBe(true);
    expect(messages.at(-1)).toContain("Say check first, then I'm done.");
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(runtime.snapshot().session?.pending).not.toBeNull();
    await say("explain", { intent: "describe-strategy", quote: "explain" });
    expect(JSON.stringify(fetcher.mock.calls[1])).not.toContain("I'm- I'm done");
  });

  it("interprets mathematical sentences containing done", async () => {
    await say("when we're done factoring the numerator is y", {
      intent: "describe-strategy",
      quote: "factoring",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("preserves the missing x, localizes the failed check, and verifies a correction", async () => {
    await say("flip", proposal({ kind: "division-to-reciprocal", partId: part("divisor") }));
    await say(
      "twelve plus thirty y",
      proposal(
        { kind: "replace-part", partId: part("numerator of factor 2"), expression: expression("12+30y") },
        "report",
      ),
    );
    runtime.ui("check");
    expect(messages.at(-1)).toContain("numerator of the second fraction");
    expect(messages.at(-1)).not.toContain("12x");
    await say("twelve x plus thirty y", {
      intent: "correct",
      operation: { kind: "replace-part", partId: part("numerator of factor 2"), expression: expression("12x+30y") },
      quote: "correct",
    });
    runtime.ui("check");
    expect(runtime.snapshot().metrics?.checks).toMatchObject({ equivalent: 1, "not-equivalent": 1 });
    expect(messages.at(-1)).toContain("follows");
    runtime.ui("check");
    expect(runtime.snapshot().metrics?.checks.equivalent).toBe(1);
    const report = runtime.report().visits[0];
    expect(report.requests).toHaveLength(3);
    expect(report.requests[0]).toMatchObject({
      revision: 0,
      status: "ok",
      diagnostics: { dropped: [] },
      timing: { extractionMs: 2 },
    });
    expect(report.log.length).toBeGreaterThan(0);
    expect(report.speechEndToProposalMs).toHaveLength(3);
    expect(report.checkRequestToInstructionMs).toHaveLength(2);
    expect(() => JSON.stringify(runtime.report())).not.toThrow();
  });

  it("verifies the negative exponent rewrite", async () => {
    runtime.onVisitChange("negative-exponent", 2, "completed");
    await say("rewrite", proposal({ kind: "negative-power-to-denominator", partId: part("factor 2") }));
    runtime.ui("check");
    expect(runtime.snapshot().metrics?.checks.equivalent).toBe(1);
  });

  it("combines pauses, excludes tutor speech, and does not resend applied turns", async () => {
    respond(fixtures.find(item => item.name === "strategy")!.expected[0] as Interpretation);
    fragment("twelve plus");
    runtime.onQuiet();
    await vi.advanceTimersByTimeAsync(50);
    fragment("thirty y");
    fragment("tutor words", "sprout");
    runtime.onQuiet();
    await vi.advanceTimersByTimeAsync(100);
    const input = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(input.learnerTurns.map((item: { text: string }) => item.text)).toEqual(["twelve plus", "thirty y"]);
    expect(input.tutorTurns[0].text).toBe("tutor words");
    await say("again", { intent: "describe-strategy", quote: "again" });
    expect(JSON.parse(fetcher.mock.calls[1][1].body).learnerTurns.map((item: { text: string }) => item.text)).toEqual([
      "again",
    ]);
  });

  it.each([
    "six times open bracket",
    "six times open bracket two x plus five close bracket and",
    "two x plus, um [cough]",
    "factor out",
    "change it to the",
    "it would be",
    "divided by",
    "two plus um, uh",
  ])("waits longer but eventually reads unfinished speech: %s", async text => {
    respond();
    fragment(text);
    runtime.onQuiet();
    await vi.advanceTimersByTimeAsync(699);
    expect(fetcher).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(["close bracket", "open bracket two plus five close bracket", "check that step", "yes", "check, um"])(
    "reads finished speech at the normal debounce: %s",
    async text => {
      respond();
      fragment(text);
      runtime.onQuiet();
      await vi.advanceTimersByTimeAsync(99);
      expect(fetcher).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it("merges speech arriving during the longer wait into one read", async () => {
    respond();
    fragment("six times open bracket");
    runtime.onQuiet();
    await vi.advanceTimersByTimeAsync(200);
    expect(fetcher).not.toHaveBeenCalled();
    runtime.onSpeechStarted(true);
    fragment("two x plus five close bracket");
    runtime.onQuiet();
    await vi.advanceTimersByTimeAsync(100);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).learnerTurns.map((item: { text: string }) => item.text)).toEqual([
      "six times open bracket",
      "two x plus five close bracket",
    ]);
  });

  it("waits for a filler-only latest turn before reading earlier speech", async () => {
    respond();
    fragment("change the numerator");
    fragment("um, uh");
    runtime.onQuiet();
    await vi.advanceTimersByTimeAsync(699);
    expect(fetcher).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("aborts interrupted requests and resends both learner turns", async () => {
    let resolve!: (value: unknown) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    );
    fragment("first");
    runtime.onQuiet();
    await vi.advanceTimersByTimeAsync(100);
    const signal = fetcher.mock.calls[0][1].signal as AbortSignal;
    runtime.onSpeechStarted(true);
    expect(signal.aborted).toBe(false);
    respond({ intent: "describe-strategy", quote: "second" });
    fragment("second");
    runtime.onQuiet();
    expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(JSON.parse(fetcher.mock.calls[1][1].body).learnerTurns).toHaveLength(2);
    resolve({
      json: async () => ({ status: "ok", interpretations: [{ intent: "describe-strategy", quote: "first" }] }),
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(messages).toHaveLength(1);
  });

  it("keeps a read when speech starts but no words follow (noise or the tutor's echo)", async () => {
    let resolve!: (value: unknown) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    );
    fragment("flip the second fraction");
    runtime.onQuiet();
    await vi.advanceTimersByTimeAsync(100);
    runtime.onSpeechStarted(true);
    state = { ...state, childTurnId: ++turn, hasChildTranscript: false };
    runtime.onQuiet();
    resolve({
      json: async () => ({
        status: "ok",
        interpretations: [proposal({ kind: "division-to-reciprocal", partId: part("divisor") })],
      }),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.snapshot().session?.pending?.status).toBe("interpreted");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("re-reads earlier speech when the latest turn never gets a transcript", async () => {
    let resolve!: (value: unknown) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    );
    fragment("factor out y");
    runtime.onQuiet();
    await vi.advanceTimersByTimeAsync(100);
    runtime.cancelCheck();
    resolve({ json: async () => ({ status: "ok", interpretations: [] }) });
    await vi.advanceTimersByTimeAsync(0);
    state = { ...state, childTurnId: ++turn, hasChildTranscript: false };
    respond({ intent: "describe-strategy", quote: "factor out y" });
    runtime.onQuiet();
    await vi.advanceTimersByTimeAsync(499);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[1][1].body).learnerTurns.map((t: { text: string }) => t.text)).toEqual([
      "factor out y",
    ]);
  });

  it("discards a read that finishes after the learner said more", async () => {
    let resolve!: (value: unknown) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    );
    fragment("y times open bracket six x minus five y");
    runtime.onQuiet();
    await vi.advanceTimersByTimeAsync(700);
    fragment("close bracket");
    resolve({
      json: async () => ({
        status: "ok",
        interpretations: [proposal({ kind: "replace-line", expression: expression("y") }, "report")],
      }),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.report().visits[0].requests[0].status).toBe("superseded");
    expect(runtime.snapshot().session?.pending).toBeNull();
  });

  it("ignores late responses after stop or a revision-changing undo", async () => {
    await say("flip", proposal({ kind: "division-to-reciprocal", partId: part("divisor") }));
    let resolve!: (value: unknown) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    );
    fragment("change the line");
    runtime.onQuiet();
    await vi.advanceTimersByTimeAsync(100);
    runtime.ui("undo");
    const count = messages.length;
    resolve({
      json: async () => ({ status: "ok", interpretations: [{ intent: "describe-strategy", quote: "next" }] }),
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(messages).toHaveLength(count);
    expect(runtime.report().visits[0].requests.at(-1)?.status).toBe("stale");
    fetcher.mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    );
    fragment("more");
    runtime.onQuiet();
    await vi.advanceTimersByTimeAsync(100);
    runtime.onStop();
    resolve({
      json: async () => ({ status: "ok", interpretations: [{ intent: "describe-strategy", quote: "more" }] }),
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(messages).toHaveLength(count);
  });

  it("re-reads speech whose response went stale after a UI undo", async () => {
    await say("flip", proposal({ kind: "division-to-reciprocal", partId: part("divisor") }));
    let resolve!: (value: unknown) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    );
    fragment("check that step");
    runtime.onQuiet();
    await vi.advanceTimersByTimeAsync(100);
    runtime.ui("undo");
    resolve({ json: async () => ({ status: "ok", interpretations: [{ intent: "request-check", quote: "check" }] }) });
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.report().visits[0].requests.at(-1)?.status).toBe("stale");
    respond({ intent: "describe-strategy", quote: "check that step" });
    await vi.advanceTimersByTimeAsync(100);
    const resent = JSON.parse(fetcher.mock.calls.at(-1)![1].body);
    expect(resent.learnerTurns.map((t: { text: string }) => t.text)).toEqual(["check that step"]);
    expect(resent.pendingStatus).toBe("none");
  });

  it("frames tutor messages as application instructions", async () => {
    await say("flip", proposal({ kind: "division-to-reciprocal", partId: part("divisor") }));
    expect(messages.at(-1)).toMatch(/^Application update from the scribe\. Say only this/);
    expect(messages.at(-1)).toContain("say check when you're ready");
  });

  it("holds a check spoken in the same breath as the change it would judge", async () => {
    await say(
      "flip the second fraction and check it",
      proposal({ kind: "division-to-reciprocal", partId: part("divisor") }),
      { intent: "request-check", quote: "check it" },
    );
    expect(logs.some(entry => entry.type === "math-scribe.check-deferred")).toBe(true);
    expect(runtime.snapshot().session?.lastCheck).toBeNull();
    expect(runtime.snapshot().session?.pending?.status).toBe("interpreted");
    expect(messages.at(-1)).toContain("Have a look first");
    await say("check that step", { intent: "request-check", quote: "check that step" });
    expect(runtime.snapshot().session?.history.at(-1)?.status).toBe("verified");
  });

  it("drops part references after a batch changes the line", async () => {
    await say(
      "flip and edit",
      proposal({ kind: "division-to-reciprocal", partId: part("divisor") }),
      proposal({ kind: "replace-part", partId: "p1", expression: expression("12") }, "report"),
    );
    expect(logs.some(entry => entry.type === "math-scribe.stale-part")).toBe(true);
    expect(messages.at(-1)).toContain("Which part");
  });

  it("applies edits to separate parts named in one breath", async () => {
    await say("flip", proposal({ kind: "division-to-reciprocal", partId: part("divisor") }));
    await say("check", { intent: "request-check", quote: "check" });
    const numerator = part("numerator of factor 1");
    const denominator = part("denominator of factor 2");
    messages.length = 0;
    await say(
      "the first numerator is y times six x minus five y and the second denominator is two x times six x minus five y",
      proposal({ kind: "replace-part", partId: numerator, expression: expression("y(6x-5y)") }, "report"),
      proposal({ kind: "replace-part", partId: denominator, expression: expression("2x(6x-5y)") }, "report"),
    );
    expect(logs.some(entry => entry.type === "math-scribe.stale-part")).toBe(false);
    expect(runtime.snapshot().session?.workingLine.latex).toBe(
      String.raw`\frac{y(6x-5y)}{4x+10y}\cdot \frac{12x+30y}{2x(6x-5y)}`,
    );
    expect(messages).toHaveLength(1);
  });

  it("still refuses a part inside one the same breath already changed", async () => {
    await say("flip", proposal({ kind: "division-to-reciprocal", partId: part("divisor") }));
    await say("check", { intent: "request-check", quote: "check" });
    const numerator = part("numerator of factor 1");
    const inner = listParts(runtime.snapshot().session!.workingLine.expression).find(
      item => item.latex === "6xy" && item.path.length > 2,
    )!.id;
    await say(
      "numerator then its first term",
      proposal({ kind: "replace-part", partId: numerator, expression: expression("y(6x-5y)") }, "report"),
      proposal({ kind: "replace-part", partId: inner, expression: expression("6yx") }, "report"),
    );
    expect(logs.some(entry => entry.type === "math-scribe.stale-part")).toBe(true);
  });

  it("refuses a part whose ancestor the same breath replaced, even if its text survived", async () => {
    await say("flip", proposal({ kind: "division-to-reciprocal", partId: part("divisor") }));
    await say("check", { intent: "request-check", quote: "check" });
    const numerator = part("numerator of factor 1");
    const term = part("term 1 of numerator of factor 1");
    await say(
      "numerator is six x y minus five y, and change its first term",
      proposal({ kind: "replace-part", partId: numerator, expression: expression("6xy-5y") }, "report"),
      proposal({ kind: "replace-part", partId: term, expression: expression("7xy") }, "report"),
    );
    expect(logs.some(entry => entry.type === "math-scribe.stale-part")).toBe(true);
    expect(runtime.snapshot().session?.workingLine.latex).toContain("6xy-5y");
  });

  it("refuses later parts after a whole-line or restructuring change in the same breath", async () => {
    const divisor = part("divisor");
    const dividend = part("dividend");
    await say(
      "flip the second fraction and change the first",
      proposal({ kind: "division-to-reciprocal", partId: divisor }),
      proposal({ kind: "replace-part", partId: dividend, expression: expression("3y/(2x)") }, "report"),
    );
    expect(logs.filter(entry => entry.type === "math-scribe.stale-part")).toHaveLength(1);
    await say("check", { intent: "request-check", quote: "check" });
    const numerator = part("numerator of factor 1");
    await say(
      "the line is three y over two x, numerator is y",
      proposal({ kind: "replace-line", expression: expression("3y/(2x)") }, "report"),
      proposal({ kind: "replace-part", partId: numerator, expression: expression("y") }, "report"),
    );
    expect(logs.filter(entry => entry.type === "math-scribe.stale-part")).toHaveLength(2);
  });

  it("asks again at once when every reading is rejected, then asks the learner to repeat", async () => {
    const rejected = () =>
      fetcher.mockResolvedValueOnce({
        json: async () => ({
          status: "ok",
          interpretations: [],
          diagnostics: { dropped: [{ reason: "unquoted", value: {} }] },
        }),
      });
    rejected();
    respond(proposal({ kind: "division-to-reciprocal", partId: part("divisor") }));
    await say("flip the second fraction");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(runtime.snapshot().session?.pending?.status).toBe("interpreted");
    expect(runtime.report().visits[0].requests.map(request => request.status)).toEqual(["rejected", "ok"]);

    fetcher.mockReset();
    rejected();
    rejected();
    messages.length = 0;
    fragment("two times two uh two times open bracket two x plus five y close bracket");
    runtime.onQuiet();
    await vi.advanceTimersByTimeAsync(100);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(messages.at(-1)).toContain("Please say that again");
    runtime.onQuiet();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not ask what to change when the same breath also asks for a check", async () => {
    await say("flip", proposal({ kind: "division-to-reciprocal", partId: part("divisor") }));
    messages.length = 0;
    await say(
      "let's reduce this now, let's verify this",
      { intent: "describe-strategy", quote: "let's reduce this now" },
      { intent: "request-check", quote: "let's verify this" },
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).not.toContain("What would you like to change");
    expect(messages[0]).toContain("That step follows");
  });

  it("acknowledges edits briefly instead of asking 'is that what you meant?' each time", async () => {
    await say("flip", proposal({ kind: "division-to-reciprocal", partId: part("divisor") }));
    expect(messages.at(-1)).toContain("Got it — say check when you're ready.");
    await say(
      "numerator is y",
      proposal({ kind: "replace-part", partId: part("numerator of factor 1"), expression: expression("y") }, "report"),
    );
    expect(messages.at(-1)).toMatch(/"Got it\."$/);
    await say("yes", { intent: "confirm", quote: "yes" });
    expect(messages.at(-1)).toMatch(/"Okay\."$/);
    expect(messages.join(" ")).not.toContain("Is that what you meant");
  });

  it("speaks once per utterance: a check replaces the confirmation before it", async () => {
    await say(
      "y times six x minus five y",
      proposal({ kind: "replace-line", expression: expression("3y/(2x)") }, "report"),
    );
    messages.length = 0;
    await say("yes, verify", { intent: "confirm", quote: "yes" }, { intent: "request-check", quote: "verify" });
    expect(messages).toHaveLength(1);
    expect(messages[0]).not.toContain("recorded");
    expect(messages[0]).toMatch(/That step follows|doesn't follow|couldn't check/);
  });

  it("does not ask for a result the learner gives in the same breath", async () => {
    await say("flip", proposal({ kind: "division-to-reciprocal", partId: part("divisor") }));
    await say("check", { intent: "request-check", quote: "check" });
    messages.length = 0;
    await say(
      "it cancels, so the first numerator is just y",
      {
        intent: "propose",
        source: "instruction",
        quote: "it cancels",
        operation: { kind: "non-unique", name: "cancel" },
      },
      proposal({ kind: "replace-part", partId: part("numerator of factor 1"), expression: expression("y") }, "report"),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).not.toContain("Ask what");
    expect(messages[0]).toContain("Got it");
  });

  it("still asks for a result about a part the same breath did not change", async () => {
    await say("flip", proposal({ kind: "division-to-reciprocal", partId: part("divisor") }));
    await say("check", { intent: "request-check", quote: "check" });
    messages.length = 0;
    await say(
      "factor the second denominator, and the first numerator is y times six x minus five y",
      {
        intent: "propose",
        source: "instruction",
        quote: "factor the second denominator",
        operation: { kind: "non-unique", name: "factor", partId: part("denominator of factor 2") },
      },
      proposal(
        { kind: "replace-part", partId: part("numerator of factor 1"), expression: expression("y(6x-5y)") },
        "report",
      ),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("What does the denominator of the second fraction look like after factoring?");
    expect(messages[0]).toContain("Got it");
  });

  it("drops a batch's updates when the visit changes while it is being read", async () => {
    publish.mockImplementation(() => {
      if (runtime.snapshot().session?.pending) runtime.onVisitChange("negative-exponent", 2, "skipped");
    });
    messages.length = 0;
    await say("flip", proposal({ kind: "division-to-reciprocal", partId: part("divisor") }));
    expect(messages).toHaveLength(0);
  });

  it("times a spoken check once, when its update is delivered", async () => {
    await say("flip", proposal({ kind: "division-to-reciprocal", partId: part("divisor") }));
    await say("yes, check", { intent: "confirm", quote: "yes" }, { intent: "request-check", quote: "check" });
    expect(runtime.report().visits[0].checkRequestToInstructionMs).toHaveLength(1);
  });

  it("ignores an in-flight response after changing visits", async () => {
    let resolve!: (value: unknown) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    );
    fragment("rewrite this");
    runtime.onQuiet();
    await vi.advanceTimersByTimeAsync(100);
    runtime.onVisitChange("negative-exponent", 2, "skipped");
    resolve({
      json: async () => ({ status: "ok", interpretations: [{ intent: "describe-strategy", quote: "rewrite" }] }),
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(messages).toEqual([]);
    expect(runtime.snapshot().problem?.id).toBe("negative-exponent");
    expect(runtime.report().visits[0].requests[0].status).toBe("cancelled");
  });

  it("checks a spoken request only once", async () => {
    await say("flip", proposal({ kind: "division-to-reciprocal", partId: part("divisor") }));
    await say("check", { intent: "request-check", quote: "check" });
    await say("check again", { intent: "request-check", quote: "check again" });
    expect(runtime.snapshot().metrics?.checks.equivalent).toBe(1);
  });

  it("ignores filler and retries once before asking again", async () => {
    fragment("um [breath]");
    runtime.onQuiet();
    await vi.advanceTimersByTimeAsync(100);
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRejectedValue(new Error("network"));
    fragment("something");
    runtime.onQuiet();
    await vi.advanceTimersByTimeAsync(100);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(messages.at(-1)).toContain("say that again");
  });

  it("mentions changed or unverified domains without giving mathematics", () => {
    for (const domainStatus of ["restriction-lost", "restriction-added"] as const) {
      expect(scribeInstruction({ kind: "checked", verdict: "equivalent", reason: "", domainStatus })).toBe(
        "That step follows, but it changes which values are allowed — the screen shows the detail. What would you like to do next?",
      );
    }
    expect(
      scribeInstruction({ kind: "checked", verdict: "equivalent", reason: "", domainStatus: "restriction-unverified" }),
    ).toBe(
      "That step follows, but I couldn't verify which values are allowed — the screen shows the detail. What would you like to do next?",
    );
  });

  it("keeps the usual equivalent message for preserved or absent domain status", () => {
    expect(scribeInstruction({ kind: "checked", verdict: "equivalent", reason: "", domainStatus: "preserved" })).toBe(
      "That step follows. What would you like to do next?",
    );
    expect(scribeInstruction({ kind: "checked", verdict: "equivalent", reason: "" })).toBe(
      "That step follows. What would you like to do next?",
    );
  });

  it("never exposes discrepancy expressions in instructions", () => {
    const text = scribeInstruction({
      kind: "checked",
      verdict: "not-equivalent",
      reason: "",
      discrepancy: {
        status: "localized",
        role: "reciprocal-numerator",
        previousPart: "12x+30y",
        proposedPart: "12+30y",
      },
    });
    expect(text).toContain("numerator of the second fraction");
    expect(text).not.toContain("12x+30y");
    expect(text).not.toContain("12+30y");
  });
});
