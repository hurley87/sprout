import { describe, expect, it } from "vitest";
import {
  appendCorrection,
  appendStep,
  auditSequence,
  auditSummary,
  createAuditTrail,
  AUDIT_TRAIL_LIMIT,
} from "../lib/math-audit/audit";

const first = String.raw`\frac{6xy-5y^2}{4x+10y}`;
const original = String.raw`\frac{6xy-5y^2}{4x+10y} \div \frac{12x^2-10xy}{12x+30y}`;
const reciprocal = `${first} ${String.raw`\times \frac{12x+30y}{12x^2-10xy}`}`;
const wrong = `${first} ${String.raw`\times \frac{12+30y}{12x^2-10xy}`}`;
const sequence = [
  original,
  reciprocal,
  String.raw`\frac{y(6x-5y)}{4x+10y}\times\frac{12x+30y}{12x^2-10xy}`,
  String.raw`\frac{y(6x-5y)}{2(2x+5y)}\times\frac{12x+30y}{12x^2-10xy}`,
  String.raw`\frac{y(6x-5y)}{2(2x+5y)}\times\frac{6(2x+5y)}{12x^2-10xy}`,
  String.raw`\frac{y(6x-5y)}{2(2x+5y)}\times\frac{6(2x+5y)}{2x(6x-5y)}`,
  String.raw`\frac{6y(6x-5y)}{4x(6x-5y)}`,
  String.raw`\frac{6y}{4x}`,
  String.raw`\frac{3y}{2x}`,
];
const unwrap = <T extends { ok: boolean }>(value: T): Extract<T, { ok: true }> => {
  if (!value.ok) throw new Error(JSON.stringify(value));
  return value as Extract<T, { ok: true }>;
};
const expr = (latex: string) => ({ latex });

describe("ordered math audits", () => {
  it("verifies the difference quotient path and reports the lost h restriction", () => {
    const lines = [
      String.raw`\frac{\frac{x}{x+1}-\frac{x+h}{x+h+1}}{h}`,
      String.raw`\frac{x(x+h+1)-(x+h)(x+1)}{h(x+1)(x+h+1)}`,
      String.raw`\frac{-h}{h(x+1)(x+h+1)}`,
      String.raw`-\frac{1}{(x+1)(x+h+1)}`,
    ];
    const result = unwrap(auditSequence(lines));
    expect(
      result.trail.entries.slice(1).every(entry => entry.kind !== "start" && entry.result.verdict === "equivalent"),
    ).toBe(true);
    expect(result.trail.entries[3]).toMatchObject({
      result: {
        domain: {
          status: "restriction-lost",
          lost: expect.arrayContaining([expect.objectContaining({ restriction: "h ≠ 0" })]),
        },
      },
    });
  });
  it("reports the earliest error with downstream dependencies", () => {
    const result = unwrap(auditSequence([original, wrong, ...sequence.slice(2)]));
    expect(result.summary.firstIssue).toMatchObject({
      entryId: "step-1",
      index: 1,
      category: "invalid",
      discrepancy: { role: "reciprocal-numerator" },
    });
    expect(result.summary.dependsOnIssue).toEqual(sequence.slice(2).map((_, index) => `step-${index + 2}`));
    expect(JSON.parse(JSON.stringify(result.trail))).toEqual(result.trail);
    expect(JSON.parse(JSON.stringify(result.summary))).toEqual(result.summary);
  });
  it("checks intended valid algebra while flagging domain changes", () => {
    const result = unwrap(auditSequence(sequence));
    expect(
      result.trail.entries.slice(1).every(entry => entry.kind !== "start" && entry.result.verdict === "equivalent"),
    ).toBe(true);
    expect(result.summary.firstIssue).toMatchObject({ entryId: "step-6", category: "domain-changed" });
    expect(unwrap(auditSequence(sequence.slice(0, 6))).summary).toMatchObject({ status: "verified", firstIssue: null });
  });
  it("places unsupported or ambiguous work before later invalid work", () => {
    for (const value of [String.raw`\sin x`, "1/2x"]) {
      const result = unwrap(auditSequence(["x", value, "x", "y"]));
      expect(result.summary.firstIssue).toMatchObject({ entryId: "step-1", category: "unverified" });
      expect(result.summary.counts.invalid).toBe(1);
    }
    const start = unwrap(createAuditTrail({ id: "s", expression: expr(String.raw`\sin x`) }));
    expect(unwrap(appendStep(start.trail, { id: "a", expression: expr("x") })).trail.entries[1]).toMatchObject({
      result: { verdict: "unsupported" },
    });
  });
  it("does not judge calculus as algebra", () => {
    const start = unwrap(createAuditTrail({ id: "s", expression: expr("x^2") }));
    const next = unwrap(
      appendStep(start.trail, { id: "d", expression: expr("2x"), operation: { kind: "differentiate" } }),
    );
    expect(auditSummary(next.trail).firstIssue).toMatchObject({
      category: "unverified",
      reason: "requires-rule-validator",
    });
  });
  it("retains negative-power restrictions", () => {
    const result = unwrap(
      auditSequence([String.raw`(2+3x^2)^3(x^2+2x)^{-2}`, String.raw`\frac{(2+3x^2)^3}{(x^2+2x)^2}`]),
    );
    expect(result.summary).toMatchObject({ status: "verified", firstIssue: null });
    expect(result.trail.entries[1]).toMatchObject({
      result: {
        domain: {
          status: "preserved",
          previousRestrictions: expect.any(Array),
          proposedRestrictions: expect.any(Array),
        },
      },
    });
    const entry = result.trail.entries[1];
    if (entry.kind !== "start") expect(entry.result.domain?.previousRestrictions.length).toBeGreaterThan(0);
  });
  it("supersedes corrected entries and followers without mutation", () => {
    const start = unwrap(createAuditTrail({ id: "s", expression: expr("x"), sourceIds: ["source"] }));
    const one = unwrap(appendStep(start.trail, { id: "one", expression: expr("x+x") }));
    const two = unwrap(appendStep(one.trail, { id: "two", expression: expr("2x") }));
    const snapshot = structuredClone(two.trail);
    const corrected = unwrap(appendCorrection(two.trail, { id: "fix", correctsId: "one", expression: expr("x") }));
    expect(two.trail).toEqual(snapshot);
    expect(Object.isFrozen(two.trail.entries[1].expression)).toBe(true);
    expect(auditSummary(corrected.trail)).toMatchObject({
      status: "verified",
      effectiveChain: ["s", "fix"],
      superseded: ["one", "two"],
    });
    expect(appendCorrection(corrected.trail, { id: "a", correctsId: "one", expression: expr("x") })).toMatchObject({
      ok: false,
      reason: "superseded-id",
    });
    expect(appendCorrection(corrected.trail, { id: "a", correctsId: "s", expression: expr("x") })).toMatchObject({
      ok: false,
      reason: "cannot-correct-start",
    });
    expect(appendCorrection(corrected.trail, { id: "a", correctsId: "missing", expression: expr("x") })).toMatchObject({
      ok: false,
      reason: "unknown-id",
    });
  });
  it("corrects a second step against its original predecessor", () => {
    const initial = unwrap(auditSequence(["x", "x+0", "2x", "2x+0"]));
    expect(initial.summary.firstIssue).toMatchObject({ entryId: "step-2" });
    const fixed = unwrap(appendCorrection(initial.trail, { id: "fixed", correctsId: "step-2", expression: expr("x") }));
    expect(auditSummary(fixed.trail)).toMatchObject({
      status: "verified",
      effectiveChain: ["step-0", "step-1", "fixed"],
      superseded: ["step-2", "step-3"],
    });
    expect(
      unwrap(appendStep(fixed.trail, { id: "after", expression: expr("x+0") })).trail.entries.at(-1),
    ).toMatchObject({ previousEntryId: "fixed" });
  });
  it("rejects malformed inputs, duplicate ids and full trails", () => {
    expect(createAuditTrail(null as never)).toMatchObject({ ok: false });
    expect(auditSequence([])).toMatchObject({ ok: false });
    const start = unwrap(createAuditTrail({ id: "s", expression: expr("x") }));
    expect(appendStep(start.trail, { id: "s", expression: expr("x") })).toMatchObject({ reason: "duplicate-id" });
    expect(appendStep(start.trail, { id: "x", expression: null as never })).toMatchObject({
      reason: "malformed-input",
    });
    const full = unwrap(auditSequence(Array(AUDIT_TRAIL_LIMIT).fill("x")));
    expect(appendStep(full.trail, { id: "extra", expression: expr("x") })).toMatchObject({ reason: "trail-limit" });
  });
});
