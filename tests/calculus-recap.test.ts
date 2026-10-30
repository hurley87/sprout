import { expect, it } from "vitest";
import { CALCULUS_PROBLEM_IDS } from "../lib/calculus/problems";
import { emptyWork } from "../lib/calculus/work-check";
import { calculusRecap, visitSummary, type CalculusVisit } from "../lib/lesson-runtime/calculus-runtime";

type Kind = "first-try" | "hint" | "another-look" | "hint-and-look" | "skipped";
const visit = (index: number, kind: Kind, visitId = index + 1): CalculusVisit => {
  const problemId = CALCULUS_PROBLEM_IDS[index];
  const looked = kind === "another-look" || kind === "hint-and-look";
  return {
    visitId,
    problemId,
    work: emptyWork(problemId),
    outcome: kind === "skipped" ? "skipped" : "completed",
    help: kind === "hint" || kind === "hint-and-look" ? 1 : 0,
    checks: looked
      ? [
          {
            requestId: "r",
            learnerTurns: [],
            status: "ok",
            extraction: null,
            outcome: "incorrect",
            instruction: null,
            current: true,
          },
        ]
      : [],
  };
};
const recap = (...kinds: Kind[]) => calculusRecap(kinds.map((kind, index) => visit(index, kind)));

it("summarizes each problem the way the recap card does", () => {
  expect(
    (["first-try", "hint", "another-look", "hint-and-look", "skipped"] as const).map(kind =>
      visitSummary(visit(0, kind)),
    ),
  ).toEqual(["first-try", "hint", "another-look", "hint-and-look", "skipped"]);
  expect(visitSummary({ ...visit(0, "first-try"), outcome: "stopped" })).toBe("unfinished");
});

it("names what the checks recorded for each problem", () => {
  expect(recap("first-try", "first-try", "first-try")).toBe(
    "You got every problem right on the first try. Thanks for practicing.",
  );
  expect(recap("skipped", "skipped", "skipped")).toBe("You skipped every problem. Thanks for practicing.");
  expect(recap("first-try", "another-look", "first-try")).toBe(
    "You got the polynomial and the composite function right on the first try. You finished the product after another look. Thanks for practicing.",
  );
  expect(recap("hint-and-look", "skipped", "hint")).toBe(
    "You finished the polynomial and the composite function after a hint. You skipped the product. Thanks for practicing.",
  );
});

it("uses the latest visit of a problem", () => {
  const visits = [visit(0, "skipped"), visit(1, "first-try"), visit(2, "first-try"), visit(0, "first-try", 4)];
  expect(calculusRecap(visits)).toBe("You got every problem right on the first try. Thanks for practicing.");
});

it("is spoken words only, so transcription cannot turn it into digits or symbols", () => {
  const kinds: Kind[] = ["first-try", "hint", "another-look", "hint-and-look", "skipped"];
  for (const a of kinds)
    for (const b of kinds)
      for (const c of kinds) {
        const text = recap(a, b, c);
        expect(text).toMatch(/^[A-Za-z ,.]+$/);
      }
});
