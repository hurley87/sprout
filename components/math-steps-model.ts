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

export function spokenTrail<
  T extends { parent: number | null; cause: "edit" | "recognition-correction"; quote: string },
>(versions: readonly T[], current: number | undefined): { quotes: string[]; misheard: T[] } {
  const chain: T[] = [];
  const visited = new Set<number>();
  while (current !== undefined && current !== null && versions[current] && !visited.has(current)) {
    visited.add(current);
    const version: T = versions[current];
    chain.push(version);
    current = version.parent ?? undefined;
  }
  chain.reverse();
  return {
    quotes: chain.map(version => version.quote),
    misheard: chain.filter((_, index) => chain[index + 1]?.cause === "recognition-correction"),
  };
}

const DOMAIN_BADGES: Record<string, string> = {
  "restriction-lost": "✓ Valid · allows more values",
  "restriction-added": "✓ Valid · allows fewer values",
  "restriction-unverified": "✓ Valid · allowed values unchecked",
};

/** The restrictions behind a domain badge, as KaTeX, so the learner sees which rule changed. */
export function domainNotes(changes: { lost: string[]; added: string[]; unverified: string[] } | undefined) {
  const latex = (restriction: string) => restriction.replace("≠", String.raw`\neq`);
  return [
    ...(changes?.lost ?? []).map(item => ({ label: "Dropped the rule", latex: latex(item) })),
    ...(changes?.added ?? []).map(item => ({ label: "Added the rule", latex: latex(item) })),
    ...(changes?.unverified ?? []).map(item => ({ label: "Couldn't confirm the rule", latex: latex(item) })),
  ];
}

export function historyRows(session: Session) {
  return session.history.map((line, index) => ({
    id: line.id,
    latex: line.latex,
    withdrawn: !!line.withdrawn,
    versions: line.pending?.versions ?? [],
    current: line.pending?.current,
    domainNotes: domainNotes(line.domainChanges),
    badge:
      index === 0
        ? "Problem"
        : line.status === "unverified"
          ? "? Continued unverified"
          : line.domainStatus && DOMAIN_BADGES[line.domainStatus]
            ? DOMAIN_BADGES[line.domainStatus]
            : "✓ Verified",
  }));
}
