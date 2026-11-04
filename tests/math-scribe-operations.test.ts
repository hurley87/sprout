import { describe, expect, it } from "vitest";
import { readAlgebraLatex } from "../lib/math-audit/latex";
import { checkTransformation } from "../lib/math-audit/check";
import type { AlgebraExpression } from "../lib/math-audit/expression";
import { applyOperation, describeOperation, type ScribeOperation } from "../lib/math-scribe/operations";
import { listParts } from "../lib/math-scribe/parts";

const original = String.raw`\frac{6xy-5y^2}{4x+10y} \div \frac{12x^2-10xy}{12x+30y}`;
const reciprocal = String.raw`\frac{6xy-5y^2}{4x+10y} \times \frac{12x+30y}{12x^2-10xy}`;
function read(latex: string): AlgebraExpression {
  const result = readAlgebraLatex(latex);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.expression;
}
function freeze(value: object): void {
  Object.freeze(value);
  for (const child of Object.values(value))
    if (child && typeof child === "object" && !Object.isFrozen(child)) freeze(child);
}
function part(expression: AlgebraExpression, description: string): string {
  const found = listParts(expression).find(item => item.description === description);
  if (!found) throw new Error(description);
  return found.id;
}
function apply(expression: AlgebraExpression, operation: ScribeOperation) {
  const result = applyOperation(expression, operation);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result;
}
const audit = (previous: AlgebraExpression, proposed: AlgebraExpression) =>
  checkTransformation({ previous: { ast: previous }, proposed: { ast: proposed } });

describe("deterministic scribe operations", () => {
  it("combines, scales and flattens fractions without expansion", () => {
    const top = read(String.raw`\frac{x}{x+1}-\frac{x+h}{x+h+1}`);
    expect(apply(top, { kind: "combine-fractions", partId: "p0" }).changed.after).toBe(
      String.raw`\frac{x(x+h+1)-(x+h)(x+1)}{(x+1)(x+h+1)}`,
    );
    expect(
      apply(read(String.raw`\frac{x}{x+1}+\frac{h}{1+x}`), { kind: "combine-fractions", partId: "p0" }).changed.after,
    ).toBe(String.raw`\frac{x+h}{x+1}`);
    expect(
      apply(read(String.raw`\frac{x}{x+1}+\frac{h}{x+h+1}`), { kind: "combine-fractions", partId: "p0" }).changed.after,
    ).toBe(String.raw`\frac{x(x+h+1)+h(x+1)}{(x+1)(x+h+1)}`);
    expect(
      apply(read(String.raw`\frac{x}{h}`), { kind: "scale-fraction", partId: "p0", factor: read("x+1") }).changed.after,
    ).toBe(String.raw`\frac{x(x+1)}{h(x+1)}`);
    expect(apply(read("x"), { kind: "multiply-part", partId: "p0", factor: read("x+1") }).changed.after).toBe("x(x+1)");
    expect(
      apply(read(String.raw`\frac{x}{\frac{h}{x+1}}`), { kind: "flatten-nested-fraction", partId: "p0" }).changed.after,
    ).toBe(String.raw`\frac{x(x+1)}{h}`);
    expect(applyOperation(read("x+y"), { kind: "combine-fractions", partId: "p0" })).toMatchObject({
      ok: false,
      reason: "needs-result",
    });
  });
  it("cancels a negative h only when h is a whole numerator factor", () => {
    const factor = read("h");
    const result = apply(read(String.raw`\frac{-h}{h(x+1)(x+h+1)}`), { kind: "cancel-common-factor", factor });
    expect(result.changed.after).toBe(String.raw`-\frac{1}{(x+1)(x+h+1)}`);
    for (const latex of [
      String.raw`\frac{\frac{x}{x+1}-\frac{x+h}{x+h+1}}{h}`,
      String.raw`\frac{x(x+h+1)-(x+h)(x+1)}{h(x+1)(x+h+1)}`,
    ])
      expect(applyOperation(read(latex), { kind: "cancel-common-factor", factor })).toMatchObject({
        ok: false,
        reason: "needs-result",
      });
  });
  it.each([
    [reciprocal, "denominator of factor 2", "2x", "2x(6x-5y)"],
    [reciprocal, "numerator of factor 1", "y", "y(6x-5y)"],
    [reciprocal, "numerator of factor 2", "6", "6(2x+5y)"],
    ["(2+3x^2)^3(x^2+2x)^{-2}", "base of factor 2", "x", "x(x+2)"],
    ["6xy-5y^2", "whole line", "-y", "-y(-6x+5y)"],
    ["6x", "whole line", "6x", "6x\\cdot 1"],
  ])("factors %s at %s", (latex, description, factor, expected) => {
    const current = read(latex);
    const partId = description === "whole line" ? "p0" : part(current, description);
    const result = apply(current, { kind: "factor-out", partId, factor: read(factor) });
    expect(result.changed.after).toBe(expected);
    expect(result.origin).toBe("scribed-operation");
    expect(audit(current, result.expression).verdict).toBe("equivalent");
  });
  it("asks for the result rather than write fractional brackets", () => {
    for (const [latex, factor] of [
      ["x+y", "2"],
      ["12x+30y", "4"],
    ])
      expect(applyOperation(read(latex), { kind: "factor-out", partId: "p0", factor: read(factor) })).toMatchObject({
        ok: false,
        reason: "needs-result",
      });
  });
  it("asks for the result when factoring cannot be safely completed", () => {
    for (const factor of [read("3x"), 0, 1])
      expect(applyOperation(read("x+y"), { kind: "factor-out", partId: "p0", factor })).toMatchObject({
        reason: "needs-result",
      });
    expect(
      applyOperation(read(String.raw`\frac{x}{y}`), { kind: "factor-out", partId: "p0", factor: read("x") }),
    ).toMatchObject({ reason: "needs-result" });
  });
  it("cancels literal factors across and within fractions in reading order", () => {
    const current = read(String.raw`\frac{y(6x-5y)}{2(2x+5y)}\cdot\frac{6(2x+5y)}{2x(6x-5y)}`);
    const result = apply(current, { kind: "cancel-common-factor", factor: read("6x-5y") });
    expect(audit(current, result.expression)).toMatchObject({ verdict: "equivalent" });
    expect(result.changed.after).toBe(String.raw`\frac{y}{2(2x+5y)}\cdot \frac{6(2x+5y)}{2x}`);
    expect(audit(current, result.expression)).toMatchObject({ domain: { status: "restriction-lost" } });
    const same = read(String.raw`\frac{(x+y)x}{y(x+y)}\frac{x+y}{x+y}`);
    const within = apply(same, { kind: "cancel-common-factor", factor: read("y+x") });
    expect(within.changed.after).toBe(String.raw`\frac{x}{y}\cdot \frac{x+y}{x+y}`);
    const preferred = read(String.raw`\frac{x+y}{x}\cdot\frac{(x+y)y}{x+y}`);
    expect(apply(preferred, { kind: "cancel-common-factor", factor: read("x+y") }).changed.after).toBe(
      String.raw`\frac{x+y}{x}y`,
    );
    const notLiteral = read(String.raw`\frac{x+x}{2x}`);
    expect(applyOperation(notLiteral, { kind: "cancel-common-factor", factor: read("2x") })).toMatchObject({
      reason: "needs-result",
    });
    expect(applyOperation(current, { kind: "cancel-common-factor", factor: read("x+y") })).toMatchObject({
      reason: "needs-result",
    });
    expect(applyOperation(read("x+y"), { kind: "cancel-common-factor", factor: read("x") })).toMatchObject({
      reason: "needs-result",
    });
  });
  it("flips the selected divisor without repairing dictated corrections", () => {
    const current = read(original);
    freeze(current);
    for (const partId of ["p0", part(current, "divisor")]) {
      const result = apply(current, { kind: "division-to-reciprocal", partId });
      expect(result.expression).toEqual(read(reciprocal));
      expect(result.origin).toBe("scribed-operation");
      expect(audit(current, result.expression)).toMatchObject({
        verdict: "equivalent",
        domain: { status: "preserved" },
      });
    }
    const flipped = read(reciprocal);
    const partId = part(flipped, "numerator of factor 2");
    const wrong = apply(flipped, { kind: "replace-part", partId, expression: read("12+30y") });
    expect(wrong.origin).toBe("spoken-expression");
    expect(wrong.expression).toEqual(read(String.raw`\frac{6xy-5y^2}{4x+10y} \times \frac{12+30y}{12x^2-10xy}`));
    expect(audit(current, wrong.expression)).toMatchObject({
      verdict: "not-equivalent",
      discrepancy: { role: "reciprocal-numerator" },
    });
    expect(
      audit(
        current,
        apply(wrong.expression, {
          kind: "replace-part",
          partId: part(wrong.expression, "numerator of factor 2"),
          expression: read("12x+30y"),
        }).expression,
      ).verdict,
    ).toBe("equivalent");
  });
  it("moves negative powers and reverses the rewrite", () => {
    const current = read(String.raw`(2+3x^2)^3(x^2+2x)^{-2}`);
    freeze(current);
    for (const description of ["factor 2", "exponent of factor 2"]) {
      const result = apply(current, { kind: "negative-power-to-denominator", partId: part(current, description) });
      expect(result.expression).toEqual(read(String.raw`\frac{(2+3x^2)^3}{(x^2+2x)^2}`));
      expect(audit(current, result.expression)).toMatchObject({
        verdict: "equivalent",
        domain: { status: "preserved" },
      });
      expect(
        apply(result.expression, {
          kind: "denominator-to-negative-power",
          partId: part(result.expression, "denominator"),
        }).expression,
      ).toEqual(current);
    }
    const single = read(String.raw`x^{-1}`);
    const fraction = apply(single, { kind: "negative-power-to-denominator", partId: "p0" }).expression;
    expect(fraction).toEqual(read(String.raw`\frac{1}{x}`));
    expect(apply(fraction, { kind: "denominator-to-negative-power", partId: "p0" }).expression).toEqual(single);
  });
  it("sets and preserves signs on terms", () => {
    const current = read("6xy-5y^2");
    const second = part(current, "term 2");
    expect(apply(current, { kind: "set-sign", partId: second, sign: "plus" }).expression).toEqual(read("6xy+5y^2"));
    const unchanged = apply(current, { kind: "set-sign", partId: second, sign: "minus" });
    expect(unchanged.changed.before).toBe(unchanged.changed.after);
    const sum = read("x+y");
    const minus = apply(sum, { kind: "set-sign", partId: part(sum, "term 2"), sign: "minus" }).expression;
    expect(minus).toEqual({ op: "add", args: [read("x"), { op: "negate", argument: read("y") }] });
    expect(apply(minus, { kind: "set-sign", partId: part(minus, "term 2"), sign: "plus" }).expression).toEqual(sum);
    expect(apply(sum, { kind: "set-sign", partId: part(sum, "term 1"), sign: "minus" }).expression).toEqual({
      op: "add",
      args: [{ op: "negate", argument: read("x") }, read("y")],
    });
  });
  it("asks for a non-unique result as a direct question naming the part for a learner", () => {
    const question = (latex: string, name: string, description?: string) => {
      const current = read(latex);
      const partId = description && listParts(current).find(item => item.description === description)!.id;
      const result = applyOperation(current, { kind: "non-unique", name, ...(partId ? { partId } : {}) });
      return result.ok ? null : result.detail;
    };
    const line = String.raw`\frac{6xy-5y^2}{4x+10y}\cdot \frac{12x+30y}{12x^2-10xy}`;
    expect(question(line, "factor", "denominator of factor 2")).toBe(
      "What does the denominator of the second fraction look like after factoring?",
    );
    expect(question(line, "cancel")).toBe("What does the line look like after cancelling?");
    expect(question(line, "simplify", "factor 1")).toBe("What does the first fraction look like after simplifying?");
    expect(question(line, "expand", "term 1 of numerator of factor 1")).toBe(
      "What does that part look like after expanding?",
    );
    expect(question("(2+3x^2)^3(x^2+2x)^{-2}", "combine", "factor 2")).toBe(
      "What does the second factor look like after combining?",
    );
    expect(question("x+y", "other")).toBe("What does the line become?");
    for (const name of ["factor", "expand", "simplify", "cancel", "combine", "other"])
      expect(question(line, name, "exponent of factor 2 of term 2 of numerator of factor 1")).not.toMatch(
        /factor \d|term \d|^Ask/,
      );
  });
  it("rejects unsupported actions and malformed objects without throwing", () => {
    const current = read("x+y");
    for (const name of ["factor", "expand", "simplify", "cancel", "combine", "other"] as const)
      expect(applyOperation(current, { kind: "non-unique", name })).toMatchObject({
        ok: false,
        reason: "needs-result",
      });
    expect(applyOperation(current, { kind: "set-sign", partId: "p999", sign: "plus" })).toMatchObject({
      reason: "unknown-part",
    });
    expect(applyOperation(current, { kind: "division-to-reciprocal", partId: "p0" })).toMatchObject({
      reason: "not-applicable",
    });
    expect(applyOperation(read("x^2"), { kind: "negative-power-to-denominator", partId: "p0" })).toMatchObject({
      reason: "not-applicable",
    });
    expect(applyOperation(current, { kind: "set-sign", partId: "p0", sign: "plus" })).toMatchObject({
      reason: "not-applicable",
    });
    for (const input of [
      null,
      {},
      { kind: "oops" },
      { kind: "set-sign", partId: "p0", sign: "plus", extra: true },
      { kind: "replace-line", expression: 1 },
      {
        get kind() {
          throw new Error();
        },
      },
      new Proxy(
        {},
        {
          ownKeys() {
            throw new Error();
          },
        },
      ),
    ])
      expect(applyOperation(current, input)).toMatchObject({ reason: "invalid-operation" });
    expect(describeOperation({ kind: "division-to-reciprocal", partId: "p0" })).toContain("Flipped");
  });
  it("validates exponent replacements and full-line dictation", () => {
    const current = read("x^2");
    expect(
      apply(current, { kind: "replace-part", partId: part(current, "exponent"), expression: -1 }).expression,
    ).toEqual(read(String.raw`x^{-1}`));
    expect(
      applyOperation(current, { kind: "replace-part", partId: part(current, "exponent"), expression: 13 }),
    ).toMatchObject({ reason: "limit" });
    expect(apply(current, { kind: "replace-line", expression: read("y+1") })).toMatchObject({
      expression: read("y+1"),
      origin: "spoken-expression",
      changed: { partId: null },
    });
  });

  it("handles ordinary divisors, multiple factors, and unchanged signs", () => {
    const division = read(String.raw`\frac{x}{y}`);
    expect(
      apply(division, { kind: "division-to-reciprocal", partId: part(division, "denominator") }).expression,
    ).toEqual(read(String.raw`x\times\frac{1}{y}`));
    const product = read(String.raw`xy(x+y)^{-2}`);
    expect(
      apply(product, { kind: "negative-power-to-denominator", partId: part(product, "factor 3") }).expression,
    ).toEqual(read(String.raw`\frac{xy}{(x+y)^2}`));
    const fraction = read(String.raw`\frac{x}{y}`);
    expect(apply(fraction, { kind: "denominator-to-negative-power", partId: "p0" }).expression).toEqual(
      read(String.raw`xy^{-1}`),
    );
    const sum = read("x+y");
    const result = apply(sum, { kind: "set-sign", partId: part(sum, "term 1"), sign: "plus" });
    expect(result.expression).toEqual(sum);
    expect(result.changed.before).toBe(result.changed.after);
  });
});
