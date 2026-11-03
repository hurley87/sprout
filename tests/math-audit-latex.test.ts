import { describe, expect, it } from "vitest";
import type { AlgebraExpression as Expression } from "../lib/math-audit/expression";
import { readAlgebraLatex } from "../lib/math-audit/latex";
import { reduceRational } from "../lib/math-audit/rational";

const number = (value: number): Expression => ({ op: "number", value });
const x: Expression = { op: "variable", name: "x" };
const y: Expression = { op: "variable", name: "y" };
const add = (...args: Expression[]): Expression => ({ op: "add", args });
const multiply = (...args: Expression[]): Expression => ({ op: "multiply", args });
const subtract = (left: Expression, right: Expression): Expression => ({ op: "subtract", left, right });
const divide = (left: Expression, right: Expression): Expression => ({ op: "divide", left, right });
const power = (base: Expression, exponent: number): Expression => ({ op: "power", base, exponent });
const first = divide(
  subtract(multiply(number(6), x, y), multiply(number(5), power(y, 2))),
  add(multiply(number(4), x), multiply(number(10), y)),
);
const numerator = subtract(multiply(number(12), power(x, 2)), multiply(number(10), x, y));
const denominator = add(multiply(number(12), x), multiply(number(30), y));
const original = String.raw`\frac{6xy-5y^2}{4x+10y} \div \frac{12x^2-10xy}{12x+30y}`;

describe("bounded LaTeX reader", () => {
  it("preserves the issue's reciprocal structures exactly", () => {
    expect(readAlgebraLatex(original)).toEqual({ ok: true, expression: divide(first, divide(numerator, denominator)) });
    expect(readAlgebraLatex(String.raw`\frac{6xy-5y^2}{4x+10y} \times \frac{12x+30y}{12x^2-10xy}`)).toEqual({
      ok: true,
      expression: multiply(first, divide(denominator, numerator)),
    });
    expect(readAlgebraLatex(String.raw`\frac{6xy-5y^2}{4x+10y} \times \frac{12+30y}{12x^2-10xy}`)).toEqual({
      ok: true,
      expression: multiply(first, divide(add(number(12), multiply(number(30), y)), numerator)),
    });
    const parsed = readAlgebraLatex(original);
    expect(parsed.ok && reduceRational(parsed.expression).ok).toBe(true);
  });
  it("reads the power fixtures and precedence", () => {
    const outer = add(number(2), multiply(number(3), power(x, 2)));
    const inner = add(power(x, 2), multiply(number(2), x));
    expect(readAlgebraLatex("(2 + 3x^2)^3 (x^2 + 2x)^{-2}")).toEqual({
      ok: true,
      expression: multiply(power(outer, 3), power(inner, -2)),
    });
    expect(readAlgebraLatex(String.raw`\frac{(2+3x^2)^3}{(x^2+2x)^2}`)).toEqual({
      ok: true,
      expression: divide(power(outer, 3), power(inner, 2)),
    });
    expect(readAlgebraLatex("3x^2")).toEqual({ ok: true, expression: multiply(number(3), power(x, 2)) });
    expect(readAlgebraLatex("-x^2")).toEqual({ ok: true, expression: { op: "negate", argument: power(x, 2) } });
    expect(readAlgebraLatex("2(x+1)")).toEqual({ ok: true, expression: multiply(number(2), add(x, number(1))) });
    expect(readAlgebraLatex("6xy-5y^2")).toEqual({
      ok: true,
      expression: subtract(multiply(number(6), x, y), multiply(number(5), power(y, 2))),
    });
  });
  it.each([
    "x/y/x",
    "1/2x",
    "x/xy",
    String.raw`x \div y \div x`,
    String.raw`x \div 2x`,
    String.raw`x \div y \times x`,
    String.raw`3\frac{1}{2}`,
    "12 3",
    "x^2^3",
  ])("rejects ambiguous %s", source => {
    expect(readAlgebraLatex(source)).toMatchObject({ ok: false, reason: "ambiguous", position: expect.any(Number) });
  });
  it.each([
    "1/2",
    "x/(x+1)",
    "(x)/(y)",
    String.raw`\left(x\right)\cdot\dfrac{x}{y}`,
    String.raw`x\,\;\ y`,
    "x^{12}",
    "x^{-2}",
  ])("accepts unambiguous %s", source => {
    expect(readAlgebraLatex(source).ok).toBe(true);
  });
  it.each([
    String.raw`\sin x`,
    String.raw`\frac\sqrt{x}{y}`,
    String.raw`\sqrt{x}`,
    String.raw`\ln x`,
    String.raw`\pi`,
    String.raw`x\pm y`,
    "z",
    "a",
    "1.2",
    "x=y",
    "x'",
    "x!",
    "x^y",
    "x^{1.5}",
  ])("rejects unsupported %s", source => {
    expect(readAlgebraLatex(source)).toMatchObject({ ok: false, reason: "unsupported", position: expect.any(Number) });
  });
  it.each(["", "(", "x+", "}", "x}", String.raw`\frac{x}{}`, "x^"])("rejects malformed %s", source => {
    expect(readAlgebraLatex(source)).toMatchObject({ ok: false, reason: "malformed" });
  });
  it("enforces source, integer, exponent, operand, and depth limits", () => {
    for (const source of [
      "x".repeat(2001),
      "1000000",
      "x^13",
      Array(9).fill("x").join("+"),
      Array(9).fill("x").join("*"),
      "(".repeat(20) + "x" + ")".repeat(20),
    ]) {
      expect(readAlgebraLatex(source)).toMatchObject({ ok: false, reason: "limit" });
    }
  });
});
