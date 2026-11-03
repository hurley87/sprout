import { describe, expect, it } from "vitest";
import { discrepancyArea, earlierVersionLabel, historyRows, proposalLabel } from "../components/math-steps-model";
import { createSession, snapshot } from "../lib/math-scribe/session";

describe("math steps view model", () => {
  it("labels each proposal without revealing a correction", () => {
    expect(proposalLabel("interpreted")).toBe("Is this what you meant?");
    expect(proposalLabel("confirmed")).toBe("Confirmed");
    expect(proposalLabel("invalid", "reciprocal-numerator")).toBe("Doesn't follow — look at the reciprocal numerator");
    expect(proposalLabel("unverified")).toBe("Couldn't check");
    expect(discrepancyArea("unexpected")).toBe("this line");
  });

  it("labels the initial line and preserves history state", () => {
    const result = createSession({ problemId: "example", latex: "x" });
    if (!result.ok) throw new Error(result.reason);
    const session = snapshot(result.state);
    const start = session.history[0];
    expect(
      historyRows({
        ...session,
        history: [
          start,
          {
            ...start,
            id: "verified",
            domainStatus: "restriction-lost",
            domainChanges: { lost: ["12x^2 - 10xy ≠ 0"], added: [], unverified: [] },
          },
          { ...start, id: "continued", status: "unverified", withdrawn: true },
        ],
      }),
    ).toMatchObject([
      { badge: "Problem" },
      {
        badge: "✓ Valid · allows more values",
        domainNotes: [{ label: "Dropped the rule", latex: String.raw`12x^2 - 10xy \neq 0` }],
      },
      { badge: "? Continued unverified", withdrawn: true },
    ]);
  });

  it("labels earlier versions by what replaced them, not always as a correction", () => {
    const edit = { parent: 0, cause: "edit" as const };
    const fix = { parent: 0, cause: "recognition-correction" as const };
    const start = { parent: null, cause: "edit" as const };
    expect(earlierVersionLabel([start, edit], 0)).toBe("Earlier version:");
    expect(earlierVersionLabel([start, fix], 0)).toBe("You corrected:");
    expect(earlierVersionLabel([start, edit, { parent: 0, cause: "edit" as const }], 1)).toBe("Undone:");
  });
});
