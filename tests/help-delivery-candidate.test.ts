import { expect, it } from "vitest";
import { helpCandidateKind } from "../lib/session-recorder";

it("classifies actionable help separately from neutral speech clarification", () => {
  expect(helpCandidateKind("Point to each butterfly as you count it once.")).toBe("instructional_help");
  expect(helpCandidateKind("Let's count the ducks together.")).toBe("instructional_help");
  expect(helpCandidateKind("I want to make sure I heard you. Could you say your number again?")).toBe("clarification");
  expect(helpCandidateKind("I heard you say three.")).toBeUndefined();
});

it("retains instructional help classification when a turn also asks for clarification", () => {
  expect(helpCandidateKind("Could you repeat your number? Point to each butterfly as you count it once.")).toBe(
    "instructional_help",
  );
});
