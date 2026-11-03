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
    runtime = new MathScribeRuntime(
      "runtime",
      () => ({ state, fragments, quiet: true, steering: false }),
      vi.fn(),
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
    expect(signal.aborted).toBe(true);
    respond({ intent: "describe-strategy", quote: "second" });
    fragment("second");
    runtime.onQuiet();
    await vi.advanceTimersByTimeAsync(100);
    expect(JSON.parse(fetcher.mock.calls[1][1].body).learnerTurns).toHaveLength(2);
    resolve({
      json: async () => ({ status: "ok", interpretations: [{ intent: "describe-strategy", quote: "first" }] }),
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(messages).toHaveLength(1);
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

  it("drops part references after a batch changes the line", async () => {
    await say(
      "flip and edit",
      proposal({ kind: "division-to-reciprocal", partId: part("divisor") }),
      proposal({ kind: "replace-part", partId: "p1", expression: expression("12") }, "report"),
    );
    expect(logs.some(entry => entry.type === "math-scribe.stale-part")).toBe(true);
    expect(messages.at(-1)).toContain("Which part");
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
