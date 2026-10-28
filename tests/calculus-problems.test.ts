import { describe, expect, it } from "vitest";
import { CALCULUS_PROBLEM_IDS, getCalculusPresentation, getCalculusReviewKey } from "../lib/calculus/problems";
import { parseMathExpression, type MathExpression } from "../lib/calculus/math-expression";

// A test-only readable serialization for direct review, not mathematical validation.
function text(e: MathExpression): string {
  switch (e.op) {
    case "number":
      return String(e.value);
    case "variable":
      return e.name;
    case "add":
    case "multiply":
      return `(${e.args.map(text).join(e.op === "add" ? "+" : "*")})`;
    case "subtract":
    case "divide":
    case "equal":
      return `(${text(e.left)}${{ subtract: "-", divide: "/", equal: "=" }[e.op]}${text(e.right)})`;
    case "power":
      return `${text(e.base)}^${e.exponent}`;
    default:
      return `${e.op}(${text(e.argument)})`;
  }
}

describe("three authored calculus problems", () => {
  it("contains exactly the requested functions and projects no answer key into initial context", () => {
    expect(CALCULUS_PROBLEM_IDS.map(id => text(getCalculusPresentation(id).functionExpression))).toEqual([
      "(x^3-(4*x))",
      "(x^2*sin(x))",
      "((3*x^2)+1)^5",
    ]);
    for (const id of CALCULUS_PROBLEM_IDS) {
      expect(Object.keys(getCalculusPresentation(id)).sort()).toEqual([
        "functionExpression",
        "id",
        "initialTutorContext",
        "prompt",
      ]);
      expect(JSON.stringify(getCalculusPresentation(id))).not.toMatch(
        /finalForms|reasoningCriteria|commonErrors|30\*x|cos\(x\)/,
      );
    }
  });
  it("records directly reviewable correct finals including finite alternate forms", () => {
    expect(getCalculusReviewKey("cubic-minus-linear").finalForms.map(text)).toEqual(["((3*x^2)-4)", "((3*x^2)+-4)"]);
    expect(getCalculusReviewKey("quadratic-sine").finalForms.map(text)).toEqual([
      "((2*x*sin(x))+(x^2*cos(x)))",
      "((x^2*cos(x))+(2*x*sin(x)))",
      "(x*((2*sin(x))+(x*cos(x))))",
    ]);
    expect(getCalculusReviewKey("composite-fifth").finalForms.map(text)).toEqual([
      "(30*x*((3*x^2)+1)^4)",
      "(5*((3*x^2)+1)^4*(6*x))",
      "((2430*x^9)+(3240*x^7)+(1620*x^5)+(360*x^3)+(30*x))",
    ]);
  });
  it("records the expanded chain route with the correct binomial coefficients", () => {
    const route = getCalculusReviewKey("composite-fifth").routes[1];
    expect(route.steps.map(s => text(s.expression))).toEqual([
      "((243*x^10)+(405*x^8)+(270*x^6)+(90*x^4)+(15*x^2)+1)",
      "((2430*x^9)+(3240*x^7)+(1620*x^5)+(360*x^3)+(30*x))",
    ]);
  });
  it.each(CALCULUS_PROBLEM_IDS)("keeps every authored expression in the bounded grammar: %s", id => {
    const key = getCalculusReviewKey(id);
    const expressions = [
      getCalculusPresentation(id).functionExpression,
      ...key.finalForms,
      ...key.routes.flatMap(r => r.steps.map(s => s.expression)),
      ...key.commonErrors.map(e => e.expression),
    ];
    for (const e of expressions) expect(parseMathExpression(e)).toEqual(e);
    expect(key.routes.length).toBeGreaterThanOrEqual(2);
    expect(key.commonErrors.length).toBeGreaterThanOrEqual(3);
    expect(key.nonLeadingProbes.length).toBeGreaterThanOrEqual(2);
    expect(key.reasoningCriteria.length).toBeGreaterThanOrEqual(3);
    expect(key.completionConditions.join(" ")).toMatch(/assistance/);
    expect(key.completionConditions.join(" ")).toMatch(/navigation intents/);
    expect(key.equivalenceBoundary).toMatch(/not implemented equivalence rules/);
    const finals = key.finalForms.map(text);
    for (const error of key.commonErrors) expect(finals).not.toContain(text(error.expression));
  });
  it("retains the product-rule sign error as authored rather than repairing it", () => {
    expect(text(getCalculusReviewKey("quadratic-sine").commonErrors[2].expression)).toBe("((2*x*sin(x))-(x^2*cos(x)))");
  });
});
