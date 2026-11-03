import { describe, expect, it } from "vitest";
import { checkTransformation, type TransformationInput } from "../lib/math-audit/check";
import { auditSequence, type AuditTrail } from "../lib/math-audit/audit";

const valid = { latex: "x" };
const getter = Object.defineProperty({}, "latex", {
  enumerable: true,
  get: () => {
    throw new Error("getter");
  },
});
const sparse = Array(2);
const accessorArray = ["x"];
Object.defineProperty(accessorArray, "0", {
  get: () => {
    throw new Error("getter");
  },
});
const pollutedArray = ["x"];
Object.setPrototypeOf(pollutedArray, Object.create(Array.prototype));
const deep = Array.from({ length: 25 }).reduce<object>(value => ({ op: "negate", argument: value }), {
  op: "variable",
  name: "x",
});
class Expression {
  latex = "x";
}
const hostile = [
  null,
  undefined,
  4,
  Symbol("input"),
  getter,
  new Expression(),
  Object.assign(Object.create({ inherited: true }), valid),
  { latex: "x", [Symbol("extra")]: true },
  { ast: { op: "add", args: sparse } },
  { ast: deep },
  { ast: { op: "add", args: Array(9).fill({ op: "variable", name: "x" }) } },
  { ast: { op: "number", value: 1000000 } },
  { ast: { op: "power", base: { op: "variable", name: "x" }, exponent: 1000000 } },
  { latex: "x".repeat(2001) },
  { latex: "x^1000000" },
];

describe("hostile math audit inputs", () => {
  it("abstains deterministically and serializes malformed transformation inputs", () => {
    for (const bad of hostile) {
      for (const input of [bad, { previous: bad, proposed: valid }, { previous: valid, proposed: bad }]) {
        const result = checkTransformation(input as TransformationInput);
        expect(["unsupported", "ambiguous"]).toContain(result.verdict);
        expect(checkTransformation(input as TransformationInput)).toEqual(result);
        expect(JSON.parse(JSON.stringify(result))).toEqual(result);
      }
    }
    const provenance = { previous: valid, proposed: valid, provenance: { sourceIds: sparse } };
    expect(checkTransformation(provenance as TransformationInput).verdict).toBe("unsupported");
    for (const ids of [accessorArray, pollutedArray]) {
      expect(checkTransformation({ previous: valid, proposed: valid, provenance: { sourceIds: ids } }).verdict).toBe(
        "unsupported",
      );
    }
    expect(
      checkTransformation(
        Object.assign(new Expression(), { previous: valid, proposed: valid }) as unknown as TransformationInput,
      ).verdict,
    ).toBe("unsupported");
  });

  it("rejects hostile sequences or leaves their transitions unverified", () => {
    for (const bad of hostile) {
      const sequence = [valid, bad] as Parameters<typeof auditSequence>[0];
      const result = auditSequence(sequence);
      expect(auditSequence(sequence)).toEqual(result);
      expect(JSON.parse(JSON.stringify(result))).toEqual(result);
      if (result.ok) {
        const entry = result.trail.entries[1] as Exclude<AuditTrail["entries"][number], { kind: "start" }>;
        expect(["unsupported", "ambiguous"]).toContain(entry.result.verdict);
      }
    }
    for (const input of [null, undefined, 7, sparse, accessorArray, pollutedArray, Array(201).fill("x")]) {
      expect(auditSequence(input as Parameters<typeof auditSequence>[0]).ok).toBe(false);
    }
  });
});
