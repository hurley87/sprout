import { expect, it } from "vitest";
import { UtteranceAccumulator } from "../lib/transcript";
it("does not clarify full canonical text using a truncated window or a different display of the same scene", () => {
  const accumulator = new UtteranceAccumulator();
  const context = {
    providerTiming: { clock: "provider" as const, startMs: 0, endMs: 100, sourceId: 1 },
    responseScene: {
      provenance: "application_transcript_context" as const,
      sceneId: "ducks",
      displayedAtMs: 0,
      status: "stable" as const,
    },
    recognition: "needs_confirmation" as const,
  };
  accumulator.append("Unclear. ", 0, 100, true, 100, context, "first");
  accumulator.append("One", 100, 200, true, 200, context, "second");
  expect(
    accumulator.retainRecognition(
      { text: "One", startMs: 0, fragments: [{ key: "second", sourceId: 1 }], fragmentsComplete: true },
      "no_ambiguity_detected",
    ),
  ).toBe("needs_confirmation");
  accumulator.append(
    "Two",
    200,
    300,
    true,
    300,
    { ...context, responseScene: { ...context.responseScene, displayedAtMs: 150 } },
    "third",
  );
  const full = {
    text: "Unclear. OneTwo",
    startMs: 0,
    fragments: ["first", "second", "third"].map(key => ({ key, sourceId: 1 })),
    fragmentsComplete: true,
  };
  expect(accumulator.retainRecognition(full, "no_ambiguity_detected")).toBe("needs_confirmation");
  expect(accumulator.take()?.context).toMatchObject({
    recognition: "needs_confirmation",
    responseScene: { status: "changed" },
  });
});
