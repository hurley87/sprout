import { describe, expect, it } from "vitest";
import { parseMathActionBatch, type MathProposalContext } from "../lib/calculus/math-action";
import { parseMathExpression, type MathExpression } from "../lib/calculus/math-expression";

const context: MathProposalContext = {
  identity: {
    runtimeId: "run-1",
    problemId: "quadratic-sine",
    visitId: "visit-1",
    transcriptRevision: 3,
    baseBoardRevision: 2,
  },
  turns: [
    {
      id: "u1",
      speaker: "learner",
      text: "Use product rule. Two x sine x minus x squared cosine x. Replace step one. Undo. Help. Next.",
    },
    { id: "u2", speaker: "learner", text: "then plus" },
    { id: "t1", speaker: "tutor", text: "Two x sine x plus x squared cosine x." },
  ],
  logicalStepIds: ["s1", "s2"],
  latestUndoableStepId: "s2",
};
const source = (quote = "Use product rule.") => ({
  turnId: "u1",
  start: context.turns[0].text.indexOf(quote),
  end: context.turns[0].text.indexOf(quote) + quote.length,
  quote,
});
const x = { op: "variable", name: "x" } as const;
const wrong: MathExpression = {
  op: "subtract",
  left: { op: "multiply", args: [{ op: "number", value: 2 }, x, { op: "sin", argument: x }] },
  right: {
    op: "multiply",
    args: [
      { op: "power", base: x, exponent: 2 },
      { op: "cos", argument: x },
    ],
  },
};
const append = () => ({
  kind: "append",
  expression: wrong,
  sources: [source("Two x sine x minus x squared cosine x.")],
});
const batch = (actions: unknown[] = [append()]) => ({ identity: { ...context.identity }, actions });

describe("bounded math syntax", () => {
  it("retains wrong signs and syntactically complete but mathematically dubious expressions", () => {
    expect(parseMathExpression(wrong)).toEqual(wrong);
    expect(parseMathExpression({ op: "divide", left: x, right: { op: "number", value: 0 } }).op).toBe("divide");
    expect(parseMathExpression({ op: "equal", left: { op: "derivative", argument: x }, right: x }).op).toBe("equal");
  });
  it.each([
    null,
    "x^2",
    { op: "sqrt", argument: x },
    { op: "variable", name: "y" },
    { op: "number", value: Infinity },
    { op: "number", value: 0.5 },
    { op: "number", value: 1000000 },
    { op: "power", base: x, exponent: x },
    { op: "power", base: x, exponent: 13 },
    { op: "sin" },
    { op: "subtract", left: x },
    { op: "add", args: [x] },
    { op: "multiply", args: [x, null] },
    { op: "number", value: 2, correct: true },
    { op: "add", args: Array(2) },
    { op: "add", args: Array(9).fill(x) },
  ])("rejects malformed/unsupported syntax %#", value => expect(() => parseMathExpression(value)).toThrow());
  it("rejects hidden fields, accessors and sparse arrays disguised with extra keys", () => {
    const sparse = [x, ,];
    Object.assign(sparse, { extra: x });
    expect(() => parseMathExpression({ op: "add", args: sparse })).toThrow();
    expect(() => parseMathExpression({ ...x, [Symbol("authority")]: true })).toThrow();
    expect(() =>
      parseMathExpression({
        op: "number",
        get value() {
          return 2;
        },
      }),
    ).toThrow();
    const hidden = Object.defineProperty({ op: "number" }, "value", { value: 2 });
    expect(() => parseMathExpression(hidden)).toThrow();
  });
  it("bounds depth, total nodes and cycles", () => {
    let deep: MathExpression = x;
    for (let i = 0; i < 16; i++) deep = { op: "sin", argument: deep };
    expect(() => parseMathExpression(deep)).toThrow();
    const branch = { op: "add", args: Array(8).fill(x) };
    expect(() =>
      parseMathExpression({ op: "add", args: Array(8).fill({ op: "add", args: Array(8).fill(branch) }) }),
    ).toThrow();
    const cycle: Record<string, unknown> = { op: "sin" };
    cycle.argument = cycle;
    expect(() => parseMathExpression(cycle)).toThrow();
  });
});

describe("proposal boundary (no reducer or math assessment)", () => {
  it("preserves an incorrect expression and returns detached data", () => {
    const input = batch();
    const parsed = parseMathActionBatch(input, context);
    expect(parsed.actions[0]).toEqual(append());
    input.identity.baseBoardRevision = 99;
    expect(parsed.identity.baseBoardRevision).toBe(2);
    expect(parsed).not.toHaveProperty("correctness");
    expect(parsed).not.toHaveProperty("acceptanceId");
  });
  it("supports an ordered multi-turn batch without combining expressions into one step", () => {
    const input = batch([
      { kind: "strategy", method: "product", sources: [source()] },
      append(),
      { kind: "clarify", reason: "missing-operand", sources: [{ turnId: "u2", start: 0, end: 9, quote: "then plus" }] },
    ]);
    expect(parseMathActionBatch(input, context).actions.map(a => a.kind)).toEqual(["strategy", "append", "clarify"]);
  });
  it.each([
    { kind: "replace", targetStepId: "s1", expression: wrong },
    { kind: "undo", targetStepId: "s2" },
    { kind: "help" },
    { kind: "next" },
    { kind: "clarify", reason: "ambiguous" },
    { kind: "clarify", reason: "unsupported" },
  ])("accepts supported action $kind", action => {
    expect(parseMathActionBatch(batch([{ ...action, sources: [source()] }]), context).actions).toHaveLength(1);
  });
  it.each([
    { kind: "replace", expression: wrong },
    { kind: "replace", targetStepId: "missing", expression: wrong },
    { kind: "undo", targetStepId: "s1" },
    { kind: "undo" },
    { kind: "append", expression: wrong, targetStepId: "s1" },
    { kind: "clarify", reason: "missing-operand", expression: x },
    { kind: "help", expression: x },
    { kind: "next", targetStepId: "s1" },
    { kind: "strategy", method: "product", expression: wrong },
    { kind: "strategy", method: "integrate" },
    { kind: "accepted", expression: x },
    { kind: "clarify", reason: "guess" },
  ])("rejects invalid action/target combination %#", action => {
    expect(() => parseMathActionBatch(batch([{ ...action, sources: [source()] }]), context)).toThrow();
  });
  it.each(["correctness", "reasoning", "assistance", "authenticated", "accepted", "disposition", "acceptanceId"])(
    "rejects model authority claim %s at all levels",
    field => {
      for (const input of [
        { ...batch(), [field]: true },
        batch([{ ...append(), [field]: true }]),
        { ...batch(), identity: { ...context.identity, [field]: true } },
        batch([{ ...append(), sources: [{ ...source(), [field]: true }] }]),
      ])
        expect(() => parseMathActionBatch(input, context)).toThrow();
    },
  );
  it.each([
    { runtimeId: "other" },
    { problemId: "composite-fifth" },
    { visitId: "visit-2" },
    { transcriptRevision: 4 },
    { baseBoardRevision: 1 },
    { transcriptRevision: -1 },
    { problemId: "unknown" },
    { baseBoardRevision: 1.5 },
  ])("rejects forged/stale identity %#", patch => {
    expect(() => parseMathActionBatch({ ...batch(), identity: { ...context.identity, ...patch } }, context)).toThrow();
  });
  it.each([
    { turnId: "t1", start: 0, end: 5, quote: "Two x" },
    { turnId: "unknown", start: 0, end: 3, quote: "Use" },
    { ...source(), start: -1 },
    { ...source(), end: 2000 },
    { ...source(), quote: "invented answer" },
    { ...source(), start: 1 },
    { ...source(), end: 0 },
    { ...source(), start: 0.5 },
  ])("rejects forged spans %#", span => {
    expect(() => parseMathActionBatch(batch([{ ...append(), sources: [span] }]), context)).toThrow();
  });
  it("rejects a corrected transcript and duplicate turn identities", () => {
    for (const turns of [[{ ...context.turns[0], text: "Changed" }], [...context.turns, context.turns[0]]]) {
      expect(() => parseMathActionBatch(batch(), { ...context, turns })).toThrow();
    }
  });
  it("rejects empty/excess batches and source arrays; a malformed tail cannot yield a partial result", () => {
    for (const actions of [
      [],
      Array(9).fill(append()),
      [append(), { kind: "append", sources: [source()] }],
      [{ ...append(), sources: [] }],
      [{ ...append(), sources: Array(9).fill(source()) }],
    ]) {
      expect(() => parseMathActionBatch(batch(actions), context)).toThrow();
    }
    expect(() =>
      parseMathActionBatch(batch([{ kind: "undo", targetStepId: "s2", sources: [source()] }]), {
        ...context,
        latestUndoableStepId: null,
      }),
    ).toThrow();
  });
});
