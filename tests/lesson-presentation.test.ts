import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Lesson from "../app/lesson";
import { GARDEN_THEME } from "../app/counting-themes";
import { lessonPresentation } from "../app/lesson-presentation";

type Snapshot = NonNullable<Parameters<typeof lessonPresentation>[0]>;
const active: Snapshot = {
  status: "live",
  error: null,
  awaitingSteering: false,
  runtime: {
    phase: "active",
    childSpeaking: false,
    outputActivity: "quiet",
    hasChildTranscript: false,
    transcriptSource: "unknown",
  },
};

describe("counting child presentation", () => {
  it("renders one welcome Play button and no diagnostics by default", () => {
    const markup = renderToStaticMarkup(createElement(Lesson, { theme: GARDEN_THEME }));
    expect(markup).toContain("Come count with Sprout!");
    expect(markup).toContain(">Play</button>");
    expect(markup.match(/<button/g)).toHaveLength(1);
    expect(markup).not.toMatch(/Progression gate|Current visit transcript|Export diagnostics|<details/);
  });

  it("retains gate details, transcript and export in the debug view", () => {
    const markup = renderToStaticMarkup(createElement(Lesson, { theme: GARDEN_THEME, debug: true }));
    expect(markup).toContain("Developer diagnostics");
    expect(markup).toContain("Progression gate");
    expect(markup).toContain("Current visit transcript");
    expect(markup).toContain("Export diagnostics");
    expect(markup).toContain("Diagnostics (latest 100 events; export includes all)");
  });

  it("welcomes without claiming to hear the child", () => {
    expect(lessonPresentation(null)).toEqual({ kind: "welcome", message: "Come count with Sprout!" });
  });

  it.each(["prepared", "connecting"] as const)("does not claim listening while %s", status => {
    expect(lessonPresentation({ ...active, status }).kind).toBe("connecting");
  });

  it("uses observed output and child speech, not transcripts, for activity", () => {
    expect(lessonPresentation(active)).toMatchObject({ kind: "ready", message: "Your turn to count!" });
    expect(lessonPresentation({ ...active, runtime: { ...active.runtime!, childSpeaking: true } }).kind).toBe(
      "listening",
    );
    expect(lessonPresentation({ ...active, runtime: { ...active.runtime!, outputActivity: "active" } }).kind).toBe(
      "speaking",
    );
    expect(lessonPresentation({ ...active, awaitingSteering: true }).kind).toBe("waiting");
    expect(lessonPresentation({ ...active, runtime: { ...active.runtime!, phase: "rendering" } }).kind).toBe("waiting");
  });

  it("shows thinking only for a quiet child transcript in an active live turn", () => {
    const thinking = {
      ...active,
      runtime: { ...active.runtime!, hasChildTranscript: true, transcriptSource: "child" as const },
    };
    expect(lessonPresentation(thinking)).toEqual({ kind: "thinking", message: "Sprout is thinking…" });
    expect(lessonPresentation({ ...thinking, runtime: { ...thinking.runtime, childSpeaking: true } }).kind).toBe(
      "listening",
    );
    expect(lessonPresentation({ ...thinking, runtime: { ...thinking.runtime, outputActivity: "active" } }).kind).toBe(
      "speaking",
    );
    expect(lessonPresentation({ ...thinking, runtime: { ...thinking.runtime, transcriptSource: "tutor" } }).kind).toBe(
      "ready",
    );
    expect(lessonPresentation({ ...thinking, awaitingSteering: true }).kind).toBe("waiting");
    expect(lessonPresentation({ ...thinking, status: "connecting" }).kind).toBe("connecting");
    expect(lessonPresentation({ ...thinking, status: "ended" }).kind).toBe("ended");
    expect(lessonPresentation({ ...thinking, error: "error" }).kind).toBe("error");
    expect(lessonPresentation(thinking, { quantity: 3, object: "butterfly" })).toEqual({
      kind: "understood",
      message: "3 butterflies!",
    });
  });

  it("does not turn a stop or failure into completion", () => {
    const stopped = { ...active, status: "ended" as const, runtime: { ...active.runtime!, phase: "stopped" as const } };
    expect(lessonPresentation(stopped)).toMatchObject({
      kind: "ended",
      message: expect.stringContaining("play again"),
    });
    expect(lessonPresentation({ ...stopped, error: "Provider failure" })).toMatchObject({
      kind: "error",
      message: expect.stringContaining("try Play again"),
    });
    expect(lessonPresentation({ ...stopped, runtime: { ...active.runtime!, phase: "complete" } }).kind).toBe(
      "complete",
    );
  });
});
