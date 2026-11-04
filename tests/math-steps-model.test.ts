import { describe, expect, it } from "vitest";
import { discrepancyArea, historyRows, proposalLabel, showDoneHint, spokenTrail } from "../components/math-steps-model";
import { createSession, snapshot } from "../lib/math-scribe/session";
import { readAlgebraLatex } from "../lib/math-audit/latex";

describe("math steps view model", () => {
  it("suggests finishing only for a verified single fraction without sums", () => {
    const result = createSession({ problemId: "example", latex: "x" });
    if (!result.ok) throw new Error(result.reason);
    const session = snapshot(result.state);
    const fraction = readAlgebraLatex(String.raw`\frac{2x}{3y}`);
    const sum = readAlgebraLatex(String.raw`\frac{x+1}{y}`);
    if (!fraction.ok || !sum.ok) throw new Error("invalid test expression");
    const line = { ...session.history[0], id: "step", expression: fraction.expression };
    expect(showDoneHint(session)).toBe(false);
    expect(showDoneHint({ ...session, history: [session.history[0], line] })).toBe(true);
    expect(showDoneHint({ ...session, history: [session.history[0], { ...line, status: "unverified" }] })).toBe(false);
    expect(showDoneHint({ ...session, history: [session.history[0], { ...line, expression: sum.expression }] })).toBe(
      false,
    );
    expect(showDoneHint({ ...session, history: [session.history[0], { ...line, withdrawn: true }] })).toBe(false);
  });
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

  it("lists a chain of spoken edits in order", () => {
    const versions = [
      { parent: null, cause: "edit" as const, quote: "first" },
      { parent: 0, cause: "edit" as const, quote: "second" },
      { parent: 1, cause: "edit" as const, quote: "third" },
    ];
    expect(spokenTrail(versions, 2)).toEqual({ quotes: ["first", "second", "third"], misheard: [] });
  });

  it("retains the version replaced by a recognition correction", () => {
    const misheard = { parent: null, cause: "edit" as const, quote: "x plus two", expression: "x+3" };
    const correction = { parent: 0, cause: "recognition-correction" as const, quote: "x plus two", expression: "x+2" };
    expect(spokenTrail([misheard, correction], 1)).toEqual({
      quotes: ["x plus two", "x plus two"],
      misheard: [misheard],
    });
  });

  it("omits undone branches even when they contain corrections", () => {
    const versions = [
      { parent: null, cause: "edit" as const, quote: "first" },
      { parent: 0, cause: "edit" as const, quote: "undone" },
      { parent: 1, cause: "recognition-correction" as const, quote: "undone correction" },
      { parent: 0, cause: "edit" as const, quote: "replacement" },
    ];
    expect(spokenTrail(versions, 3)).toEqual({ quotes: ["first", "replacement"], misheard: [] });
  });
});
