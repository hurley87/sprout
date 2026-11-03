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
