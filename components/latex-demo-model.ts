import { auditSequence, type AuditSummary } from "@/lib/math-audit/audit";
import { checkTransformation, type TransformationResult } from "@/lib/math-audit/check";

const original = String.raw`\frac{6xy-5y^2}{4x+10y} \div \frac{12x^2-10xy}{12x+30y}`;
const first = String.raw`\frac{6xy-5y^2}{4x+10y}`;
const wrong = `${first} ${String.raw`\times \frac{12+30y}{12x^2-10xy}`}`;
const reciprocal = `${first} ${String.raw`\times \frac{12x+30y}{12x^2-10xy}`}`;

export const presets = [
  { label: "Missing x (issue #90)", lines: [original, wrong, wrong, wrong] },
  {
    label: "Valid reciprocal + factoring",
    lines: [original, reciprocal, String.raw`\frac{y(6x-5y)}{4x+10y}\times\frac{12x+30y}{12x^2-10xy}`],
  },
  { label: "Cancellation drops a restriction", lines: [original, String.raw`\frac{3y}{2x}`] },
  {
    label: "Negative exponent",
    lines: [String.raw`(2+3x^2)^3(x^2+2x)^{-2}`, String.raw`\frac{(2+3x^2)^3}{(x^2+2x)^2}`],
  },
  { label: "Unsupported / ambiguous", lines: ["x", "1/2x", String.raw`\sin x`] },
];

export type Category = "verified" | "invalid" | "domain-changed" | "unverified";
export const labels: Record<Category, string> = {
  verified: "✓ Verified",
  invalid: "✗ Not equivalent",
  "domain-changed": "⚠ Domain changed",
  unverified: "? Unverified",
};

export function category(result: TransformationResult): Category {
  if (result.verdict === "not-equivalent") return "invalid";
  if (result.verdict !== "equivalent" || !result.domain || result.domain.status === "restriction-unverified")
    return "unverified";
  return result.domain.status === "preserved" ? "verified" : "domain-changed";
}

export function discrepancyText(result: TransformationResult): string {
  if (result.verdict !== "not-equivalent" || result.discrepancy?.status !== "localized")
    return "Could not localize the difference";
  const { role, proposedPart, previousPart } = result.discrepancy;
  const part = role === "reciprocal-numerator" ? "reciprocal's numerator" : role.replaceAll("-", " ");
  return `Check the ${part}: ${proposedPart} vs ${previousPart}`;
}

export function builtOnLine(summary: AuditSummary, id: string): number | null {
  return summary.firstIssue && summary.dependsOnIssue.includes(id) ? summary.firstIssue.index + 1 : null;
}

export function restrictions(latex: string): string[] | null {
  const result = checkTransformation({ previous: { latex }, proposed: { latex } });
  return result.domain?.proposedRestrictions ?? null;
}

export function auditText(text: string) {
  const lines = text
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
  return { lines, result: lines.length ? auditSequence(lines) : null };
}
