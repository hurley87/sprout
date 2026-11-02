import { describe, expect, it } from "vitest";
import { checkTransformation } from "../lib/math-audit/check";

const original = String.raw`\frac{6xy-5y^2}{4x+10y} \div \frac{12x^2-10xy}{12x+30y}`;
const reciprocal = String.raw`\frac{6xy-5y^2}{4x+10y} \times \frac{12x+30y}{12x^2-10xy}`;
const missing = String.raw`\frac{6xy-5y^2}{4x+10y} \times \frac{12+30y}{12x^2-10xy}`;
const check = (previous: string, proposed: string) =>
  checkTransformation({ previous: { latex: previous }, proposed: { latex: proposed } });

describe("transformation checking", () => {
  it("checks the reciprocal and detects the missing x", () => {
    expect(check(original, reciprocal)).toMatchObject({ verdict: "equivalent", domain: { status: "preserved" } });
    expect(check(original, missing)).toMatchObject({
      verdict: "not-equivalent",
      reason: "exact-difference",
      evidence: {
        difference: expect.any(String),
        witness: { previous: expect.any(String), proposed: expect.any(String) },
      },
    });
  });
  it("accepts alternative steps and flags cancellation", () => {
    const factored = String.raw`\frac{y(6x-5y)}{2(2x+5y)} \div \frac{2x(6x-5y)}{6(2x+5y)}`;
    expect(check(original, factored)).toMatchObject({ verdict: "equivalent", domain: { status: "preserved" } });
    expect(check(original, String.raw`\frac{3y}{2x}`)).toMatchObject({
      verdict: "equivalent",
      domain: {
        status: "restriction-lost",
        lost: expect.arrayContaining([expect.objectContaining({ witness: expect.any(Object) })]),
      },
    });
  });
  it.each([
    ["(x+y)^2", "x^2+2xy+y^2"],
    ["y(6x-5y)", "6xy-5y^2"],
  ])("compares expansion both ways", (left, right) => {
    expect(check(left, right).verdict).toBe("equivalent");
    expect(check(right, left).verdict).toBe("equivalent");
  });
  it.each([String.raw`\frac{(2+3x^2)^3}{(x^2+2x)^2}`, String.raw`\frac{(2+3x^2)^3}{x^2(x+2)^2}`])(
    "retains negative power domain",
    right => {
      expect(check(String.raw`(2 + 3x^2)^3 (x^2 + 2x)^{-2}`, right)).toMatchObject({
        verdict: "equivalent",
        domain: { status: "preserved" },
      });
    },
  );
  it.each([
    [String.raw`\frac{x^2-1}{x-1}`, "x+1"],
    [String.raw`\frac{x}{x}`, "1"],
  ])("detects lost restrictions", (left, right) => {
    expect(check(left, right)).toMatchObject({
      verdict: "equivalent",
      domain: { status: "restriction-lost", lost: [{ witness: { x: left.includes("x^2") ? "1" : "0" } }] },
    });
  });
  it("detects added restrictions and undefined expressions", () => {
    expect(check("1", String.raw`\frac{x}{x}`)).toMatchObject({
      verdict: "equivalent",
      domain: { status: "restriction-added" },
    });
    for (const invalid of [String.raw`\frac{1}{x-x}`, String.raw`\frac{1}{0}`]) {
      expect(check(invalid, "1")).toMatchObject({ verdict: "unsupported", reason: "previous-undefined" });
      expect(check("1", invalid)).toMatchObject({ verdict: "not-equivalent", reason: "proposed-undefined" });
    }
  });
  it("uses exact rational roots and abstains when no witness is found", () => {
    expect(check(String.raw`\frac{x}{3x-2}`, "x")).toMatchObject({ domain: { lost: [{ witness: { x: "2/3" } }] } });
    expect(check(String.raw`\frac{x^2+y^2-3}{x^2+y^2-3}`, "1")).toMatchObject({
      domain: { status: "restriction-unverified" },
    });
  });
  it("abstains on malformed, unsupported, ambiguous, and oversized inputs", () => {
    for (const input of [String.raw`\sin x`, "z"]) expect(check(input, "1").verdict).toBe("unsupported");
    expect(check("1", "1/2x")).toMatchObject({
      verdict: "ambiguous",
      reason: "ambiguous-proposed",
      position: expect.any(Number),
    });
    expect(check("x".repeat(2001), "1")).toMatchObject({ verdict: "unsupported", reason: "limit" });
    expect(
      checkTransformation({ previous: { ast: { op: "number", value: 1, extra: true } }, proposed: { latex: "1" } }),
    ).toMatchObject({ verdict: "unsupported", reason: "malformed-previous" });
    expect(checkTransformation(null as never)).toMatchObject({ verdict: "unsupported", reason: "malformed-input" });
    expect(
      checkTransformation({ previous: { latex: "x" }, proposed: { latex: "y" }, operation: { kind: "differentiate" } }),
    ).toMatchObject({ verdict: "unsupported", reason: "requires-rule-validator" });
  });
  it("echoes metadata and is JSON serializable", () => {
    const result = checkTransformation({
      previous: { latex: original },
      proposed: { latex: missing },
      operation: { kind: "algebraic", description: "reciprocal" },
      provenance: { previousId: "a", proposedId: "b", sourceIds: ["c"] },
    });
    expect(result).toMatchObject({
      operation: { kind: "algebraic", description: "reciprocal" },
      provenance: { previousId: "a", proposedId: "b", sourceIds: ["c"] },
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
