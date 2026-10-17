import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CATCHING_UNICORNS_LESSON } from "../lib/lesson-runtime/catching-unicorns-lesson";
import { createLessonRuntime, type ConceptEvidenceRecord } from "../lib/lesson-runtime/lesson-runtime-reducer";
import CatchingUnicornsDemo, { ScenePresentation } from "../components/catching-unicorns-demo";

function evidence(
  criterionId: string,
  understanding: "independent" | "prompted" | null = "independent",
  transcript = "I explained it in my own words.",
): ConceptEvidenceRecord {
  const source = {
    runtimeId: "presentation-test",
    nodeId: "test-scene",
    visitId: 1,
    childTurnId: 1,
    transcriptRevision: 1,
    childMessageIndex: 0,
    childTranscript: transcript,
  };
  return {
    criterionId,
    status: "demonstrated",
    understanding,
    source,
    promptingHistory: [{ source, prompted: understanding === null ? null : understanding === "prompted" }],
  };
}

function renderScene(nodeId: string, conceptEvidence: Readonly<Record<string, ConceptEvidenceRecord>> = {}) {
  const runtime = {
    ...createLessonRuntime("presentation-test", { lesson: CATCHING_UNICORNS_LESSON }),
    nodeId,
    conceptEvidence,
  };
  return renderToStaticMarkup(createElement(ScenePresentation, { state: runtime }));
}

describe("Catching Unicorns scene presentation", () => {
  it.each(["engram", "exogram", "compare", "exographics"])(
    "shows only the %s question regardless of accepted evidence",
    nodeId => {
      const accepted = Object.fromEntries(
        Object.values(CATCHING_UNICORNS_LESSON.nodes).flatMap(node =>
          (node.concepts ?? []).map(concept => [`${node.id}:${concept.id}`, evidence(concept.id)]),
        ),
      );
      const html = renderScene(nodeId, accepted);
      expect(html).toBe(renderScene(nodeId));
      expect(html.match(/<h2/g)).toHaveLength(1);
      expect(html).not.toMatch(/<p|<details|<section|<ul|<svg/);
      expect(html).not.toContain("Learned so far");
      expect(html).toContain(String(CATCHING_UNICORNS_LESSON.nodes[nodeId].presentation.prompt));
    },
  );

  it("requires explicit debug opt-in for transcript, evidence and exports", () => {
    const normal = renderToStaticMarkup(createElement(CatchingUnicornsDemo));
    const debug = renderToStaticMarkup(createElement(CatchingUnicornsDemo, { debug: true }));
    for (const label of [
      "Session details",
      "Conversation so far",
      "Current evidence",
      "Export session",
      "Session diagnostics",
    ]) {
      expect(normal).not.toContain(label);
      expect(debug).toContain(label);
    }
    expect(normal).toContain('aria-valuemax="4"');
    expect(normal).toContain('aria-valuenow="0"');
  });

  it("leaves the final recap as the evidence summary", () => {
    const html = renderScene("recap", { "engram:engram-biological": evidence("engram-biological") });
    expect(html).toContain("What this conversation showed");
    expect(html).toContain("You independently explained engrams");
    expect(html).not.toContain("Learned so far");
  });

  it("renders the frozen delivery snapshot even if evidence changes during delivery", () => {
    const recapText = "You independently explained sharing. Thanks for the discussion.";
    const state = { ...createLessonRuntime("snapshot", { lesson: CATCHING_UNICORNS_LESSON }), nodeId: "recap" };
    const before = renderToStaticMarkup(createElement(ScenePresentation, { state, recapText }));
    const changed = { ...state, conceptEvidence: { "engram:engram-biological": evidence("engram-biological") } };
    const after = renderToStaticMarkup(createElement(ScenePresentation, { state: changed, recapText }));
    expect(after).toBe(before);
    expect(after).toContain(recapText);
    expect(after).not.toContain("You independently explained engrams");
  });

  it("keeps demonstrated evidence with uncertain prompting visible in the recap", () => {
    const recap = renderScene("recap", {
      "engram:engram-biological": evidence(
        "engram-biological",
        null,
        "A memory inside my brain, unlike an external note.",
      ),
    });
    expect(recap).toContain("You explained engrams, with prompting unclear.");
    expect(recap).not.toContain("A memory inside my brain, unlike an external note.");
  });

  it("shows independent, prompted and partial evidence without listing unresolved topics", () => {
    const recap = renderScene("recap", {
      "engram:engram-biological": evidence("engram-biological", "independent", "Memory held in a biological mind."),
      "exogram:exogram-non-biological": evidence("exogram-non-biological", "prompted", "A note outside my brain."),
      "exographics:visual-symbols": { ...evidence("visual-symbols"), status: "partial", understanding: null },
    });
    expect(recap).toContain("You independently explained engrams");
    expect(recap).toContain("After a prompt, you explained exograms.");
    expect(recap).toContain("Partly explained: visual symbols");
    expect(recap).not.toMatch(/unresolved or skipped/i);
    expect(recap).toContain("Memory held in a biological mind”");
    expect(recap).not.toContain("A note outside my brain.");
    expect(recap).not.toContain("Supporting longer threads of reasoning");
    expect(recap).not.toContain("Substantial education</p>");
    expect(recap).not.toContain("abstract ideas");
  });
});
