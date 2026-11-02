import { describe, expect, it } from "vitest";
import {
  auditText,
  builtOnLine,
  category,
  discrepancyText,
  presets,
  verifiedText,
} from "@/components/latex-demo-model";

describe("step checker playground", () => {
  it.each([
    [0, "invalid"],
    [1, "verified"],
    [2, "domain-changed"],
    [3, "verified"],
    [4, "unverified"],
  ] as const)("audits preset %i as %s", (index, expected) => {
    const { result } = auditText(presets[index].lines.join("\n"));
    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    const transitions = result.trail.entries.filter(entry => entry.kind !== "start");
    expect(transitions.length).toBeGreaterThan(0);
    expect(category(transitions[0].result)).toBe(expected);
    if (expected === "verified") expect(result.summary.status).toBe("verified");
    if (index === 0) {
      expect(discrepancyText(transitions[0].result)).toContain("reciprocal's numerator: 12+30y vs 12x+30y");
      expect(builtOnLine(result.summary, transitions[1].id)).toBe(2);
      expect(builtOnLine(result.summary, transitions[0].id)).toBeNull();
      // The continuation is algebraically sound relative to the wrong line.
      expect(transitions[1].result.verdict).toBe("equivalent");
      expect(transitions[2].result.verdict).toBe("equivalent");
    }
    if (index === 2) expect(transitions[0].result.domain?.lost.length).toBeGreaterThan(0);
  });

  it("pluralizes the verified banner", () => {
    expect(verifiedText(1)).toBe("All 1 step verified");
    expect(verifiedText(3)).toBe("All 3 steps verified");
  });

  it("ignores blank lines", () => {
    expect(auditText("x\n\n x ").lines).toEqual(["x", "x"]);
    expect(auditText("\n ").result).toBeNull();
  });
});
