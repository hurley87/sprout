import { describe, expect, it } from "vitest";
import { discrepancyArea, historyRows, proposalLabel } from "../components/math-steps-model";
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
          { ...start, id: "verified", domainStatus: "restriction-lost" },
          { ...start, id: "continued", status: "unverified", withdrawn: true },
        ],
      }),
    ).toMatchObject([
      { badge: "Problem" },
      { badge: "⚠ Domain changed" },
      { badge: "? Continued unverified", withdrawn: true },
    ]);
  });
});
