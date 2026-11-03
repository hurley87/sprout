import type { LineStatus } from "@/lib/math-scribe/session";
import type { snapshot } from "@/lib/math-scribe/session";

type Session = ReturnType<typeof snapshot>;

export function discrepancyArea(role: string | undefined): string {
  const areas: Record<string, string> = {
    numerator: "the numerator",
    denominator: "the denominator",
    term: "the term",
    factor: "the factor",
    base: "the base",
    exponent: "the exponent",
    "unchanged-factor": "the unchanged factor",
    "reciprocal-numerator": "the reciprocal numerator",
    "reciprocal-denominator": "the reciprocal denominator",
    "reciprocal-factor": "the reciprocal factor",
  };
  return (role && areas[role]) || "this line";
}

export function proposalLabel(status: LineStatus, role?: string): string {
  switch (status) {
    case "interpreted":
      return "Is this what you meant?";
    case "confirmed":
      return "Confirmed";
    case "invalid":
      return `Doesn't follow — look at ${discrepancyArea(role)}`;
    case "unverified":
      return "Couldn't check";
    case "verified":
      return "✓ Verified";
  }
}

export function historyRows(session: Session) {
  return session.history.map((line, index) => ({
    id: line.id,
    latex: line.latex,
    withdrawn: !!line.withdrawn,
    versions: line.pending?.versions ?? [],
    current: line.pending?.current,
    badge:
      index === 0
        ? "Problem"
        : line.status === "unverified"
          ? "? Continued unverified"
          : line.domainStatus && line.domainStatus !== "preserved"
            ? "⚠ Domain changed"
            : "✓ Verified",
  }));
}
