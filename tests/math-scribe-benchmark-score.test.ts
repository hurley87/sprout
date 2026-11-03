import { describe, expect, it } from "vitest";
import { scoreInterpretation, summarizeScores } from "../lib/math-scribe/benchmark-score";

describe("scribe benchmark scoring", () => {
  it("compares ordered intents and expression structure independently of object key order", () => {
    const expected = [{ intent: "propose", operation: { expression: { op: "number", value: 2 } } }];
    const actual = [{ intent: "propose", operation: { expression: { value: 2, op: "number" } } }];
    expect(scoreInterpretation(expected, { status: "ok", interpretations: actual })).toMatchObject({
      exact: true,
      intent: true,
      faithfulExpression: true,
      clarification: null,
    });
    expect(
      scoreInterpretation(expected, {
        status: "ok",
        interpretations: [{ intent: "propose", operation: { expression: { op: "number", value: 3 } } }],
      }),
    ).toMatchObject({ exact: false, intent: true, faithfulExpression: false });
  });

  it("counts false commits, drops, and failed requests without awarding empty matches", () => {
    expect(scoreInterpretation([], { status: "timeout" })).toMatchObject({
      exact: false,
      intent: false,
      falseCommit: false,
    });
    expect(
      scoreInterpretation([{ intent: "clarify" }], {
        status: "ok",
        interpretations: [{ intent: "correct" }],
        diagnostics: { dropped: [1, 2] },
      }),
    ).toMatchObject({ clarification: false, falseCommit: true, drops: 2 });
    expect(scoreInterpretation([], { status: "ok", interpretations: [{ intent: "propose" }] }).falseCommit).toBe(true);
  });

  it("uses applicable denominators and nearest-rank latency percentiles", () => {
    const first = scoreInterpretation([{ intent: "clarify" }], {
      status: "ok",
      interpretations: [{ intent: "clarify" }],
    });
    const second = scoreInterpretation([], { status: "ok", interpretations: [] });
    expect(
      summarizeScores([
        { score: first, latencyMs: 10 },
        { score: second, latencyMs: 30 },
      ]),
    ).toMatchObject({ clarificationRate: 1, faithfulExpressionRate: null, latencyP50Ms: 10, latencyP95Ms: 30 });
  });
});
