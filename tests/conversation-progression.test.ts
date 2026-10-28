import { expect, it } from "vitest";
import { parseLearnerNavigationText } from "../lib/lesson-runtime/conversation-progression";

it.each([false, true])("preserves whole-turn problem navigation aliases with authored=%s", authored => {
  for (const [alias, equivalent] of [
    ["next problem", "next question"],
    ["skip this problem", "skip this question"],
    ["skip the problem", "skip the question"],
  ]) {
    for (const punctuation of ["", ".", "!"]) {
      expect(
        parseLearnerNavigationText(`  ${alias.toUpperCase().replaceAll(" ", "  ")}${punctuation}  `, authored),
      ).toEqual(parseLearnerNavigationText(`${equivalent}${punctuation}`, authored));
    }
  }
  expect(parseLearnerNavigationText("next", authored)).toEqual({ action: "next", scope: "subpart" });
});

it.each([
  "next problem?",
  "next problem!!",
  "please next problem",
  "skip that problem",
  "could we skip this problem",
  "I don't know. Next problem.",
  "Next problem. Next question.",
  '"next problem"',
  "the next problem is difficult",
])("does not broaden problem navigation to %s", text => {
  expect(parseLearnerNavigationText(text)).toBeNull();
  expect(parseLearnerNavigationText(text, false)).toBeNull();
});
