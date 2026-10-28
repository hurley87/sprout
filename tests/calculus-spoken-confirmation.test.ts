import { expect, it } from "vitest";
import {
  isSpokenAffirmation,
  isSpokenAffirmationPrefix,
  isSpokenMathConfirmationPrefix as prefix,
  parseSpokenMathConfirmation as parse,
} from "../lib/calculus/spoken-confirmation";
it("parses explicit single and numbered mixed commands in order", () => {
  expect(parse("Confirm differentiation.", 1)).toEqual(["differentiate"]);
  expect(parse("confirm rewrite", 1)).toEqual(["rewrite"]);
  expect(parse("confirm without checking", 1)).toEqual(["unassessed"]);
  expect(parse("action 1 confirm rewrite; action 2 confirm differentiation", 2)).toEqual(["rewrite", "differentiate"]);
});
it("applies one spoken command to every displayed action", () => {
  expect(parse("Confirm differentiation.", 3)).toEqual(["differentiate", "differentiate", "differentiate"]);
  expect(parse("Confirm, without checking!", 2)).toEqual(["unassessed", "unassessed"]);
});
it("accepts numbered commands as speech recognition punctuates them", () => {
  expect(parse("Action 1, confirm rewrite. Action 2, confirm differentiation.", 2)).toEqual([
    "rewrite",
    "differentiate",
  ]);
  expect(parse("action one confirm rewrite action two confirm without checking", 2)).toEqual(["rewrite", "unassessed"]);
});
it.each([
  "yes",
  "correct",
  "confirm",
  "not confirm rewrite",
  "I said confirm rewrite",
  '"confirm rewrite"',
  "if so confirm rewrite",
  "confirm rewrite except the sign",
  "confirm rewrite and undo",
  "confirm rewrite confirm rewrite",
  "__proto__",
])("rejects %s", text => {
  expect(parse(text, 1)).toBeNull();
  expect(parse(text, 3)).toBeNull();
});
it("requires the complete ordered batch and enforces bounds", () => {
  expect(parse("action 1 confirm rewrite", 2)).toBeNull();
  expect(parse("action 2 confirm rewrite; action 1 confirm differentiation", 2)).toBeNull();
  expect(parse("action 1 confirm rewrite; action 2 confirm rewrite", 1)).toBeNull();
  expect(parse("x".repeat(601), 1)).toBeNull();
  expect(parse("confirm rewrite", 9)).toBeNull();
});
it("keeps only possible command prefixes open while the learner speaks", () => {
  for (const text of [
    "",
    "Con",
    "confirm ",
    "Confirm, differ",
    "confirm differentiation.",
    "action 1, confirm rewrite, act",
  ])
    expect(prefix(text, 2), text).toBe(true);
  for (const text of [
    "confirm rewrite and",
    "yes",
    "action 2",
    "action 1 confirm rewrite action 2 confirm rewrite action",
  ])
    expect(prefix(text, 2), text).toBe(false);
});
it("recognizes a bare affirmation only as a whole utterance", () => {
  expect(isSpokenAffirmation("Correct.")).toBe(true);
  expect(isSpokenAffirmation("Yes, that's right.")).toBe(true);
  expect(isSpokenAffirmation("yes but the sign is wrong")).toBe(false);
  expect(isSpokenAffirmationPrefix("Cor")).toBe(true);
  expect(isSpokenAffirmationPrefix("no")).toBe(false);
});
