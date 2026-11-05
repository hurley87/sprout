import { describe, expect, it } from "vitest";
import { readAlgebraLatex } from "../lib/math-audit/latex";
import type { AlgebraExpression } from "../lib/math-audit/expression";
import { getPart, listParts, MATH_SCRIBE_PART_LIMIT, replacePart } from "../lib/math-scribe/parts";

const original = String.raw`\frac{6xy-5y^2}{4x+10y} \div \frac{12x^2-10xy}{12x+30y}`;
const reciprocal = String.raw`\frac{6xy-5y^2}{4x+10y} \times \frac{12x+30y}{12x^2-10xy}`;
const powers = String.raw`(2+3x^2)^3(x^2+2x)^{-2}`;
function read(source: string): AlgebraExpression {
  const result = readAlgebraLatex(source);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.expression;
}

describe("math scribe addressable parts", () => {
  it("names the components of a complex fraction", () => {
    const parts = listParts(read(String.raw`\frac{\frac{x}{x+1}-\frac{x+h}{x+h+1}}{h}`));
    expect(parts.find(part => part.description === "numerator")?.aliases).toContain("the big numerator");
    expect(parts.find(part => part.description === "denominator")?.aliases).toContain("the outside denominator");
    expect(parts.find(part => part.description === "second fraction on top")?.aliases).toContain(
      "the second fraction on top",
    );
    expect(parts.find(part => part.description === "numerator of the second fraction on top")?.latex).toBe("x+h");
  });
  it("describes both fractions of the division with stable addresses", () => {
    const expression = read(original);
    const parts = listParts(expression);
    expect(listParts(expression)).toEqual(parts);
    expect(parts.find(part => part.description === "dividend")?.aliases).toContain("the first fraction");
    expect(parts.find(part => part.description === "divisor")?.aliases).toContain("the second fraction");
    for (const [description, latex] of [
      ["numerator of dividend", "6xy-5y^2"],
      ["denominator of dividend", "4x+10y"],
      ["numerator of divisor", "12x^2-10xy"],
      ["denominator of divisor", "12x+30y"],
    ]) {
      expect(parts.find(part => part.description === description)?.latex).toBe(latex);
    }
    for (const part of parts) expect(getPart(expression, part.id)).toEqual(getPart(expression, part.path));
  });
  it("addresses reciprocal and negative-power components", () => {
    expect(listParts(read(reciprocal)).find(part => part.description === "numerator of factor 2")?.latex).toBe(
      "12x+30y",
    );
    const expression = read(powers);
    const parts = listParts(expression);
    expect(parts.find(part => part.description === "factor 2")?.op).toBe("power");
    expect(parts.find(part => part.description === "base of factor 2")?.latex).toBe("x^2+2x");
    const exponent = parts.find(part => part.description === "exponent of factor 2")!;
    expect(exponent).toMatchObject({ kind: "exponent", latex: "-2" });
    expect(getPart(expression, exponent.id)).toBe(-2);
    expect(replacePart(expression, exponent.path, 2)).toMatchObject({ ok: true });
    expect(replacePart(expression, exponent.path, 0.5)).toEqual({ ok: false, reason: "invalid-replacement" });
    expect(replacePart(expression, exponent.path, 13)).toEqual({ ok: false, reason: "limit" });
  });
  it("replaces structurally without mutation and rejects invalid paths and limits", () => {
    const expression = read(reciprocal);
    const before = structuredClone(expression);
    const part = listParts(expression).find(item => item.description === "numerator of factor 2")!;
    const result = replacePart(expression, part.path, read("12+30y"));
    expect(result).toEqual({
      ok: true,
      expression: read(String.raw`\frac{6xy-5y^2}{4x+10y} \cdot \frac{12+30y}{12x^2-10xy}`),
    });
    expect(expression).toEqual(before);
    expect(replacePart(expression, [{ child: "args", index: 99 }], read("x"))).toEqual({
      ok: false,
      reason: "bad-path",
    });
    expect(replacePart(expression, part.path, { op: "number", value: 1000000 })).toEqual({
      ok: false,
      reason: "limit",
    });
    expect(getPart(expression, "p999")).toBeNull();
  });
  it("bounds large results deterministically and drops leaves first", () => {
    const term: AlgebraExpression = {
      op: "add",
      args: Array.from({ length: 8 }, () => ({ op: "power", base: { op: "variable", name: "x" }, exponent: 2 })),
    };
    const expression: AlgebraExpression = { op: "multiply", args: Array.from({ length: 7 }, () => term) };
    const parts = listParts(expression);
    expect(parts).toHaveLength(MATH_SCRIBE_PART_LIMIT);
    expect(listParts(expression)).toEqual(parts);
    expect(parts.every(part => part.op !== "variable" && part.op !== "number")).toBe(true);
    expect(listParts(expression, { limit: 3 })).toHaveLength(3);
  });
});
