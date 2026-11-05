import { expect, it } from "vitest";
import { readAlgebraLatex } from "../lib/math-audit/latex";
import { conceptHint } from "../lib/math-scribe/hints";
import { createSession, reduceSession, sessionMetrics } from "../lib/math-scribe/session";
import { scribeInstruction } from "../lib/lesson-runtime/math-scribe-runtime";
import { parseScribeInput, parseScribeWithDrops } from "../lib/math-scribe/interpretation";
import { checkTransformation } from "../lib/math-audit/check";

it("rejects a dictated limit result as a simplification", () => {
  expect(
    checkTransformation({
      previous: { latex: String.raw`\frac{\frac{x}{x+1}-\frac{x+h}{x+h+1}}{h}` },
      proposed: { latex: String.raw`-\frac{1}{(x+1)^2}` },
    }).verdict,
  ).toBe("not-equivalent");
});

it.each([
  [String.raw`\frac{\frac{x}{x+1}-\frac{x+h}{x+h+1}}{h}`, "common denominator"],
  [String.raw`\frac{\frac{x}{x+1}}{h}`, "Dividing by h"],
  [String.raw`\frac{x(x+1)-x}{h}`, "expanding"],
  [String.raw`\frac{-h}{h(x+1)}`, "whole numerator"],
  ["x", "What would you like to try next?"],
])("chooses a structural hint for %s", (latex, expected) => {
  const parsed = readAlgebraLatex(latex);
  if (!parsed.ok) throw new Error(parsed.reason);
  expect(conceptHint(parsed.expression)).toContain(expected);
});

it("logs and speaks hints and rejects calculus drift without a proposal", () => {
  const session = createSession({
    problemId: "difference-quotient",
    latex: String.raw`\frac{\frac{x}{x+1}-\frac{x+h}{x+h+1}}{h}`,
  });
  if (!session.ok) throw new Error(session.reason);
  const help = reduceSession(session.state, {
    type: "interpretation",
    requestId: "1",
    basedOnRevision: 0,
    at: 1,
    interpretation: { intent: "request-help", quote: "hint" },
  });
  expect(scribeInstruction(help.notice)).toContain("common denominator");
  expect(help.state.log.at(-1)?.hint).toContain("common denominator");
  expect(sessionMetrics(help.state).hints).toBe(1);
  const input = parseScribeInput({
    workingLatex: "x",
    baseLatex: "x",
    pendingStatus: "none",
    learnerTurns: [{ id: "1", text: "take the derivative" }],
    tutorTurns: [],
  });
  const result = parseScribeWithDrops(
    {
      interpretations: [
        {
          intent: "propose",
          source: "instruction",
          quote: "take the derivative",
          operation: { kind: "non-unique", name: "calculus" },
        },
      ],
    },
    input,
  );
  expect(result.dropped).toEqual([]);
  const drift = reduceSession(help.state, {
    type: "interpretation",
    requestId: "2",
    basedOnRevision: 0,
    at: 2,
    interpretation: result.interpretations[0],
  });
  expect(drift.state.pending).toBeNull();
  expect(drift.state.revision).toBe(0);
  expect(scribeInstruction(drift.notice)).toContain("not take a limit or derivative");
});
