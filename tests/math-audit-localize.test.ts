import { describe, expect, it } from "vitest";
import { checkTransformation } from "../lib/math-audit/check";
import { equivalentExpressions } from "../lib/math-audit/equivalent";
import { formatExpression } from "../lib/math-audit/format";
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
      previousPart: "((12)\\times (x))+((30)\\times (y))",
      proposedPart: "(12)+((30)\\times (y))",
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
});
