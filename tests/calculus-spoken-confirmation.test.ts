import { expect, it } from "vitest";
import { parseSpokenMathConfirmation as parse } from "../lib/calculus/spoken-confirmation";
it("parses explicit single and numbered mixed commands in order", () => {
  expect(parse("Confirm differentiation.", 1)).toEqual(["differentiate"]);
  expect(parse("confirm rewrite", 1)).toEqual(["rewrite"]);
  expect(parse("confirm without checking", 1)).toEqual(["unassessed"]);
  expect(parse("action 1 confirm rewrite; action 2 confirm differentiation", 2)).toEqual(["rewrite", "differentiate"]);
});
it.each([
  "yes",
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
});
it("requires the complete ordered batch and enforces bounds", () => {
  expect(parse("confirm rewrite", 2)).toBeNull();
  expect(parse("action 2 confirm rewrite; action 1 confirm differentiation", 2)).toBeNull();
  expect(parse("x".repeat(601), 1)).toBeNull();
  expect(parse("confirm rewrite", 9)).toBeNull();
});
