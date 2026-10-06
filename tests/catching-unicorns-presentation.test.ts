import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CATCHING_UNICORNS_LESSON } from "../lib/lesson-runtime/catching-unicorns-lesson";
import { createLessonRuntime, type ConceptEvidenceRecord } from "../lib/lesson-runtime/lesson-runtime-reducer";
import { ScenePresentation } from "../components/catching-unicorns-demo";

function evidence(
  criterionId: string,
  understanding: "independent" | "prompted" = "independent",
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
    promptingHistory: [{ source, prompted: understanding === "prompted" }],
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
  it("keeps canonical engram and exogram definitions out of the initial DOM", () => {
    const html = renderScene("engram");
    expect(html).toContain("What is an engram?");
    expect(html).not.toContain("Biological memory: memory held within a biological mind.");
    expect(html).not.toContain("Non-biological memory: a representation kept outside biological memory.");
  });

  it("reveals a demonstrated paraphrase and carries it only where the authored lesson permits", () => {
    const carried = renderScene("exogram", {
      "exogram:engram-biological": evidence(
        "engram-biological",
        "independent",
        "Memory inside a person is different from a record outside them.",
      ),
    });
    expect(carried).toContain("Carried forward from your earlier explanation");
    expect(carried).toContain("Biological memory: memory held within a biological mind.");
    expect(carried).not.toContain("Non-biological memory: a representation kept outside biological memory.");

    const revealed = renderScene("engram", { "engram:engram-biological": evidence("engram-biological") });
    expect(revealed).toContain("Biological memory: memory held within a biological mind.");
  });

  it("reveals comparison rows and culture characteristics independently", () => {
    const comparison = renderScene("compare", {
      "compare:engram-biological": evidence("engram-biological"),
      "compare:exogram-non-biological": evidence("exogram-non-biological"),
      "compare:exogram-durability": evidence("exogram-durability"),
    });
    expect(comparison).toContain("Durable");
    expect(comparison).toContain("The source describes exograms as durable");
    expect(comparison).toContain("Comparison 2");
    expect(comparison).not.toContain("Shareable</h3>");

    const culture = renderScene("techno-literate-culture", {
      "techno-literate-culture:idea-discoverers": evidence("idea-discoverers"),
    });
    expect(culture).toContain("A smaller group discovers ideas");
    expect(culture).toContain("Characteristic 1");
    expect(culture).toContain("Characteristic 3");
    expect(culture).toContain("Characteristic 4");
    expect(culture).not.toContain("Widespread basic literacy");
  });

  it("shows multiple visual forms only after exographics evidence and keeps CAF rows distinct", () => {
    const hiddenForms = renderScene("exographics");
    expect(hiddenForms).not.toContain("Exographics</h2>");
    expect(hiddenForms).not.toContain("What does exographics mean");
    expect(hiddenForms).not.toContain("Equation</p>");
    expect(hiddenForms).not.toContain("Graph</p>");

    const visibleForms = renderScene("exographics", {
      "exographics:beyond-prose": evidence("beyond-prose"),
    });
    expect(visibleForms).toContain("Equation</p>");
    expect(visibleForms).toContain("Graph</p>");
    expect(visibleForms).toContain("Map</p>");

    const namedPractice = renderScene("exographics", {
      "exographics:visual-symbols": evidence("visual-symbols"),
    });
    expect(namedPractice).toContain("Exographics</h2>");

    const culture = renderScene("techno-literate-culture");
    expect(culture).toContain("Culture and literacy</h2>");
    expect(culture).not.toContain("Techno-literate culture</h2>");

    const application = renderScene("caf-application", {
      "techno-literate-culture:widespread-literacy": evidence("widespread-literacy"),
      "caf-application:caf-defensible-conclusion": evidence(
        "caf-defensible-conclusion",
        "prompted",
        "A qualified yes fits the evidence I gave, with limits.",
      ),
    });
    expect(application).toContain("Transfer prompt · not a source-canonical answer");
    expect(application).toContain("Previously demonstrated framework");
    expect(application).toContain("Widespread basic literacy");
    expect(application).toContain("Your conclusion");
    expect(application).toContain("Application evidence 1");
  });

  it("projects actual independent, prompted, partial, and unresolved evidence into recap", () => {
    const recap = renderScene("recap", {
      "engram:engram-biological": evidence("engram-biological", "independent", "Memory held in a biological mind."),
      "why-exographics:reification": evidence(
        "reification",
        "prompted",
        "Paper lets me look at the idea and move the symbols around.",
      ),
      "why-exographics:memory-extension": {
        ...evidence("memory-extension"),
        status: "partial",
        understanding: null,
      },
      "techno-literate-culture:education-system": {
        ...evidence("education-system"),
        status: "partial",
        understanding: null,
      },
      "caf-application:caf-defensible-conclusion": evidence(
        "caf-defensible-conclusion",
        "independent",
        "No, I cannot support that conclusion with the evidence here.",
      ),
    });
    expect(recap).toContain("Demonstrated independently");
    expect(recap).toContain("Demonstrated after a prompt");
    expect(recap).toContain("Partly explained");
    expect(recap).toContain("Still unresolved or skipped");
    expect(recap).toContain("Memory held in a biological mind.");
    expect(recap).toContain("No, I cannot support that conclusion with the evidence here.");
    expect(recap).toContain("Transfer/application reasoning");
    expect(recap).not.toContain("Supporting longer threads of reasoning");
    expect(recap).not.toContain("Substantial education</p>");
    expect(recap).toContain("one unresolved item");
  });
});
