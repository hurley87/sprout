import { describe, expect, it } from "vitest";
import { checkTransformation } from "../lib/math-audit/check";
import { equivalentExpressions } from "../lib/math-audit/equivalent";
import { formatExpression } from "../lib/math-audit/format";
import type { AlgebraExpression as E } from "../lib/math-audit/expression";
import { readAlgebraLatex } from "../lib/math-audit/latex";

const first = String.raw`\frac{6xy-5y^2}{4x+10y}`;
const divisor = String.raw`\frac{12x^2-10xy}{12x+30y}`;
const original = `${first} \\div ${divisor}`;
const reciprocal = String.raw`\frac{12x+30y}{12x^2-10xy}`;
const missing = String.raw`\frac{12+30y}{12x^2-10xy}`;
const check = (previous: string, proposed: string) =>
  checkTransformation({ previous: { latex: previous }, proposed: { latex: proposed } });
const discrepancy = (previous: string, proposed: string) => {
  const result = check(previous, proposed);
  expect(result.verdict).toBe("not-equivalent");
  return result.verdict === "not-equivalent" ? result.discrepancy : undefined;
};

describe("defensible discrepancy localization", () => {
  it("localizes the missing-x reciprocal numerator without explaining the cause", () => {
    expect(discrepancy(original, `${first} \\times ${missing}`)).toEqual({
      status: "localized",
      basis: "reciprocal-alignment",
      role: "reciprocal-numerator",
      path: ["factor 2", "numerator"],
      description:
        "The numerator of the reciprocal factor does not match the denominator of the divisor in the previous expression.",
      previousPart: "12x+30y",
      proposedPart: "12+30y",
    });
  });
  it("localizes reciprocal denominator and swapped factors", () => {
    const wrong = String.raw`\frac{12x+30y}{12x^2-11xy}`;
    expect(discrepancy(original, `${first} \\times ${wrong}`)).toMatchObject({
      status: "localized",
      role: "reciprocal-denominator",
    });
    expect(discrepancy(original, `${missing} \\times ${first}`)).toMatchObject({
      status: "localized",
      role: "reciprocal-numerator",
      path: ["factor 1", "numerator"],
    });
  });
  it("refines an unchanged factor and refuses multiple errors or unrelated shapes", () => {
    const wrongFirst = String.raw`\frac{6xy-4y^2}{4x+10y}`;
    expect(discrepancy(original, `${wrongFirst} \\times ${reciprocal}`)).toMatchObject({
      status: "localized",
      role: "numerator",
      path: ["factor 1", "numerator"],
    });
    expect(discrepancy(original, `${wrongFirst} \\times ${missing}`)).toMatchObject({ status: "not-localized" });
    for (const expression of [String.raw`\frac{3y}{3x}`, String.raw`\frac{2y}{x}`])
      expect(discrepancy(original, expression)).toMatchObject({ status: "not-localized" });
  });
  it.each([
    [String.raw`\frac{x+1}{x}`, String.raw`\frac{x+2}{x}`, "numerator"],
    ["(x+y)(x-y)", "(x+y)(x+y)", "factor"],
    ["x^2+2xy+y^2", "x^2+3xy+y^2", "term"],
  ])("localizes structural differences", (previous, proposed, role) => {
    expect(discrepancy(previous, proposed)).toMatchObject({ status: "localized", basis: "structural-alignment", role });
  });
  it("does not add discrepancies to other outcomes, including undefined proposals", () => {
    for (const result of [
      check(original, `${first} \\times ${reciprocal}`),
      check("x", "sin(x)"),
      check("x", "1/xy"),
      check("x", "1/0"),
    ])
      expect(result).not.toHaveProperty("discrepancy");
    expect(() => JSON.stringify(check(original, `${first} \\times ${missing}`))).not.toThrow();
  });
  it.each([
    original,
    `${first} \\times ${missing}`,
    `${first} \\times ${reciprocal}`,
    "(x+y)(x-y)",
    "x^2+3xy+y^2",
    "-x^{-2}",
  ])("round-trips %s", source => {
    const parsed = readAlgebraLatex(source);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const roundtrip = readAlgebraLatex(formatExpression(parsed.expression));
    expect(roundtrip.ok).toBe(true);
    if (roundtrip.ok) expect(equivalentExpressions(parsed.expression, roundtrip.expression)).toBe(true);
  });
  it("renders compact LaTeX for the issue fixture", () => {
    const parsed = readAlgebraLatex(original);
    expect(parsed.ok && formatExpression(parsed.expression)).toBe(
      String.raw`\frac{\frac{6xy-5y^2}{4x+10y}}{\frac{12x^2-10xy}{12x+30y}}`,
    );
    const negatives = readAlgebraLatex("x - -y + (-3)x^{-2}");
    expect(negatives.ok && formatExpression(negatives.expression)).toBe("x-(-y)+(-3)x^{-2}");
  });
  it("round-trips generated expressions through the reader, including signs and powers", () => {
    let seed = 7;
    const random = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
    const leaf = (): E =>
      random(3) === 0 ? { op: "number", value: random(13) - 4 } : { op: "variable", name: random(2) ? "x" : "y" };
    const build = (depth: number): E => {
      if (depth === 0) return leaf();
      const child = () => build(depth - 1);
      switch (random(7)) {
        case 0:
          return { op: "add", args: [child(), child(), child()].slice(0, 2 + random(2)) };
        case 1:
          return { op: "multiply", args: [child(), child(), child()].slice(0, 2 + random(2)) };
        case 2:
          return { op: "subtract", left: child(), right: child() };
        case 3:
          return { op: "negate", argument: child() };
        case 4:
          return { op: "power", base: child(), exponent: random(5) - 2 || 2 };
        case 5:
          return { op: "divide", left: child(), right: { op: "add", args: [child(), { op: "number", value: 7 }] } };
        default:
          return leaf();
      }
    };
    for (let i = 0; i < 300; i++) {
      const expression = build(3);
      const text = formatExpression(expression);
      const read = readAlgebraLatex(text);
      expect(read.ok ? "ok" : `${text}: ${read.detail}`).toBe("ok");
      if (read.ok) expect([text, equivalentExpressions(expression, read.expression)]).not.toEqual([text, false]);
    }
  });
});
