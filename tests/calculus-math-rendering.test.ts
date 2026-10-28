import { expect, it } from "vitest";
import type { MathExpression as E } from "../lib/calculus/math-expression";
import { renderMathExpression, serializeMathExpression } from "../lib/calculus/math-rendering";

const x: E = { op: "variable", name: "x" };
const n = (value: number): E => ({ op: "number", value });
const pow = (base: E, exponent: number): E => ({ op: "power", base, exponent });
const mul = (...args: E[]): E => ({ op: "multiply", args });
const add = (...args: E[]): E => ({ op: "add", args });
const sub = (left: E, right: E): E => ({ op: "subtract", left, right });
const latex = (e: E) => serializeMathExpression(e).latex;

it("writes products like handwriting, without redundant brackets", () => {
  expect(latex(mul(n(3), pow(x, 2)))).toBe("3 x^{2}");
  expect(latex(sub(mul(n(3), pow(x, 2)), n(4)))).toBe("3 x^{2} - 4");
  expect(latex(add(mul(n(2), x, { op: "sin", argument: x }), mul(pow(x, 2), { op: "cos", argument: x })))).toBe(
    "2 x \\sin x + x^{2} \\cos x",
  );
  expect(latex(mul(n(30), x, pow(add(mul(n(3), pow(x, 2)), n(1)), 4)))).toBe("30 x \\left(3 x^{2} + 1\\right)^{4}");
});

it("keeps the brackets that change meaning", () => {
  expect(latex(sub(x, sub(x, n(1))))).toBe("x - \\left(x - 1\\right)");
  expect(latex(mul(add(x, n(1)), x))).toBe("\\left(x + 1\\right) x");
  expect(latex(pow(n(-2), 2))).toBe("\\left(-2\\right)^{2}");
  expect(latex(mul(n(3), n(-4)))).toBe("3 \\left(-4\\right)");
  expect(latex(mul(n(3), n(4)))).toBe("3 \\cdot 4");
  expect(latex(add(x, n(-4)))).toBe("x -4");
  expect(latex({ op: "sin", argument: add(x, n(1)) })).toBe("\\sin \\left(x + 1\\right)");
});

it("reads expressions aloud for screen readers", () => {
  expect(serializeMathExpression(sub(mul(n(3), pow(x, 2)), n(4))).text).toBe("3 times x to the power 2 minus 4");
});

it("renders KaTeX only from validated expressions", () => {
  const ok = renderMathExpression(mul(n(3), pow(x, 2)));
  expect(ok.ok && ok.html).toContain("katex");
  expect(renderMathExpression({ op: "script", value: "<img>" })).toEqual({
    ok: false,
    text: "Equation unavailable: invalid or unsupported expression.",
  });
});
