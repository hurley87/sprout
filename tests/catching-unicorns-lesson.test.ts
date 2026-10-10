import { transcriptMessages } from "../lib/lesson-runtime/tutor-observation";
import { describe, expect, it } from "vitest";
import { currentNodeContext, validateLessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import { conversationStateQuestions } from "../lib/lesson-runtime/conversation-observer-contract";
import { createLessonRuntime, reduceLessonRuntime, runtimeSource } from "../lib/lesson-runtime/lesson-runtime-reducer";
import {
  CATCHING_UNICORNS_LESSON,
  CATCHING_UNICORNS_PRESENTATION,
  CATCHING_UNICORNS_SCENE_IDS,
  validateCatchingUnicornsPresentation,
} from "../lib/lesson-runtime/catching-unicorns-lesson";
import {
  CATCHING_UNICORNS_TRANSCRIPT_FIXTURES,
  CATCHING_UNICORNS_TRANSFER_FIXTURES,
  type FixtureObservation,
  REQUIRED_TRANSCRIPT_VARIANTS,
} from "./fixtures/catching-unicorns-transcripts";

describe("isolated Catching Unicorns lesson content", () => {
  it("authors nine ordered, removable scenes with mastery completion policies", () => {
    expect(CATCHING_UNICORNS_SCENE_IDS).toEqual([
      "engram",
      "exogram",
      "compare",
      "exographics",
      "why-exographics",
      "techno-literate-culture",
      "caf-application",
      "synthesis",
      "recap",
    ]);
    expect(CATCHING_UNICORNS_LESSON.initialNodeId).toBe("engram");
    const nodes = Object.values(CATCHING_UNICORNS_LESSON.nodes);
    expect(nodes.slice(0, -1).filter(node => node.id !== "techno-literate-culture").every(node => node.completionPolicy === "all_demonstrated")).toBe(true);
    expect(nodes.at(-1)?.onSuccess).toEqual({ kind: "complete" });
    expect(nodes.slice(0, -1).every(node => node.concepts?.length)).toBe(true);
    expect(CATCHING_UNICORNS_LESSON.nodes.compare.concepts?.map(item => item.id)).toEqual([
      "engram-biological",
      "exogram-non-biological",
      "exogram-durability",
      "exogram-shareability",
      "exogram-revisability",
    ]);
    expect(CATCHING_UNICORNS_LESSON.nodes["techno-literate-culture"].concepts?.map(item => item.id)).toHaveLength(4);
  });

  it("maps every hidden reveal to a source-linked current-scene criterion", () => {
    expect(() => validateCatchingUnicornsPresentation()).not.toThrow();
    for (const [nodeId, presentation] of Object.entries(CATCHING_UNICORNS_PRESENTATION)) {
      if (!("reveals" in presentation)) continue;
      const concepts = CATCHING_UNICORNS_LESSON.nodes[nodeId].concepts ?? [];
      for (const [criterionId, reveal] of Object.entries(presentation.reveals)) {
        const definition = concepts.find(concept => concept.id === criterionId);
        expect(definition, `${nodeId}:${criterionId}`).toBeDefined();
        expect(definition?.description).toMatch(/Source-backed|Transfer rubric/);
        expect(reveal.source).toBeTruthy();
        expect(reveal.text).toBeTruthy();
      }
    }
    expect(CATCHING_UNICORNS_PRESENTATION["why-exographics"].promptVisual.arithmetic).toBe("84 + 1,045 + 693 + 719");
    expect(CATCHING_UNICORNS_PRESENTATION.recap.groups.map(group => group.id)).toEqual([
      "independent",
      "prompted",
      "unattributed",
      "partial",
      "missing",
    ]);
    expect(CATCHING_UNICORNS_PRESENTATION.recap.policy).toContain("remains unresolved");
    for (const row of CATCHING_UNICORNS_PRESENTATION["caf-application"].framework) {
      expect(
        CATCHING_UNICORNS_LESSON.nodes[row.sourceNodeId].concepts?.some(concept => concept.id === row.criterionId),
      ).toBe(true);
    }
    for (const nodeId of CATCHING_UNICORNS_SCENE_IDS.slice(0, -1)) {
      const expected = (CATCHING_UNICORNS_LESSON.nodes[nodeId].concepts ?? []).map(item => `concept_${item.id}`);
      const questions = conversationStateQuestions(CATCHING_UNICORNS_LESSON, nodeId);
      expect(
        Object.keys(questions)
          .filter(key => key.startsWith("concept_"))
          .sort(),
      ).toEqual(expected.sort());
    }
  });

  it("keeps manuscript-backed paraphrases distinct from partial and transfer evidence", () => {
    const biologicalMemory = observeFixture("engram", "sufficient");
    expect(biologicalMemory.state.conceptEvidence["engram:engram-biological"]?.status).toBe("demonstrated");
    expect(observeFixture("engram", "misconception").state.conceptEvidence["engram:engram-biological"]?.status).toBe(
      "not_yet",
    );

    expect(
      observeFixture("exogram", "sufficient").state.conceptEvidence["exogram:exogram-non-biological"]?.status,
    ).toBe("demonstrated");
    const properties = observeFixture("compare", "sufficient").state.conceptEvidence;
    for (const criterionId of ["exogram-durability", "exogram-shareability", "exogram-revisability"]) {
      expect(properties[`compare:${criterionId}`]?.status, criterionId).toBe("demonstrated");
    }

    const proseOnly = observeFixture("exographics", "partial").state.conceptEvidence;
    expect(proseOnly["exographics:visual-symbols"]?.status).toBe("partial");
    expect(proseOnly["exographics:beyond-prose"]?.status).toBe("not_yet");
    expect(CATCHING_UNICORNS_TRANSCRIPT_FIXTURES.exographics.partial.transcript).toMatch(
      /just an exogram, just writing things down/i,
    );

    const paperReasoning = observeFixture("why-exographics", "sufficient");
    expect(paperReasoning.fixture.transcript).toContain("84 + 1,045 + 693 + 719");
    for (const criterionId of ["reification", "memory-extension", "discovery"]) {
      expect(paperReasoning.state.conceptEvidence[`why-exographics:${criterionId}`]?.status, criterionId).toBe(
        "demonstrated",
      );
    }
    expect(CATCHING_UNICORNS_PRESENTATION["why-exographics"].promptVisual.note).toMatch(/not a mastery criterion/);

    const technologyOnly = observeFixture("techno-literate-culture", "partial").state.conceptEvidence;
    expect(Object.values(technologyOnly).every(item => item.status !== "demonstrated")).toBe(true);
    expect(CATCHING_UNICORNS_LESSON.nodes["techno-literate-culture"].concepts ?? []).toHaveLength(4);

    for (const fixtureName of ["defensibleYes", "defensibleNo"] as const) {
      expect(
        observeFixture("caf-application", fixtureName).state.conceptEvidence[
          "caf-application:caf-defensible-conclusion"
        ]?.status,
        fixtureName,
      ).toBe("demonstrated");
    }
    expect(CATCHING_UNICORNS_LESSON.nodes.synthesis.tutorBrief).toMatch(/not a required source term/);
    expect(CATCHING_UNICORNS_PRESENTATION.recap.groups.map(group => group.title)).toEqual([
      "Demonstrated independently",
      "Demonstrated after a prompt",
      "Demonstrated · prompting unclear",
      "Partly explained",
      "Still unresolved or skipped",
    ]);
  });

  it("projects only current-scene prompt data to tutor context, keeping reveal payloads client-side", () => {
    for (const nodeId of CATCHING_UNICORNS_SCENE_IDS) {
      const context = currentNodeContext(CATCHING_UNICORNS_LESSON, nodeId);
      expect(context.nodeId).toBe(nodeId);
      expect(context.scene.id).toBe(nodeId);
      expect(context.scene).toHaveProperty("prompt");
      expect(context).not.toHaveProperty("onSuccess");
      expect(context.scene).not.toHaveProperty("reveals");
      const currentPresentation = CATCHING_UNICORNS_PRESENTATION[nodeId as keyof typeof CATCHING_UNICORNS_PRESENTATION];
      const currentRevealText =
        "reveals" in currentPresentation ? Object.values(currentPresentation.reveals).map(item => item.text) : [];
      for (const answer of currentRevealText) expect(JSON.stringify(context)).not.toContain(answer);
    }
    expect(CATCHING_UNICORNS_LESSON.tutor.sessionGuidance).toContain(
      "except when the current scene tutor brief explicitly permits targeted scaffolding",
    );
    expect(CATCHING_UNICORNS_LESSON.tutor.sessionGuidance).toContain("cannot gate mastery");
  });
});

function observeFixture(nodeId: keyof typeof CATCHING_UNICORNS_TRANSCRIPT_FIXTURES, fixtureName: string) {
  const lesson = validateLessonDefinition({ ...CATCHING_UNICORNS_LESSON, initialNodeId: nodeId });
  let state = createLessonRuntime(`cu-${nodeId}-${fixtureName}`, { lesson });
  const send = (event: Record<string, unknown>) => {
    const result = reduceLessonRuntime(state, { ...event, atMs: state.nowMs + 1 } as never, lesson);
    state = result.state;
    return result;
  };
  const fixture = (
    CATCHING_UNICORNS_TRANSCRIPT_FIXTURES[nodeId] as Record<
      string,
      { transcript: string; observations: Record<string, FixtureObservation> }
    >
  )[fixtureName];
  if (!fixture) throw new Error(`Unknown Catching Unicorns fixture ${nodeId}:${fixtureName}`);
  send({ type: "child.turn.started", source: runtimeSource(state) });
  send({
    type: "transcript.updated",
    source: runtimeSource(state),
    revision: state.transcriptRevision + 1,
    speaker: "child",
  });
  send({ type: "child.turn.ended", source: runtimeSource(state) });
  const source = {
    runtimeId: state.runtimeId,
    nodeId: state.nodeId,
    visitId: state.visitId,
    childTurnId: state.childTurnId,
    transcriptRevision: state.transcriptRevision,
  };
  const concepts = lesson.nodes[nodeId].concepts ?? [];
  const observations = concepts.map(concept => ({
    criterionId: concept.id,
    observation: fixture.observations[concept.id] ?? "not_yet",
    // Controlled fixture expectations concern the final substantive answer.
    childMessageIndex: transcriptMessages(fixture.transcript)!.findLastIndex(message => message.speaker === "Child"),
  }));
  // These reviewed synthetic expectations are controlled reducer inputs. They do not test live classifier accuracy.
  const result = send({
    type: "proposal.received",
    source,
    transcriptSnapshot: fixture.transcript,
    proposal: {
      nodeId,
      transcriptRevision: state.transcriptRevision,
      childActivity: "unknown",
      answerOutcome: fixtureName === "misconception" ? "incorrect" : fixtureName === "partial" ? "unclear" : "correct",
      supportState: "none",
      tutorState: "unknown",
      conceptObservations: observations,
    },
  });
  return { state, result, fixture };
}

function settleReliableQuiet(state: ReturnType<typeof createLessonRuntime>) {
  const lesson = validateLessonDefinition({ ...CATCHING_UNICORNS_LESSON, initialNodeId: state.nodeId });
  const send = (event: Record<string, unknown>) => {
    const result = reduceLessonRuntime(state, { ...event, atMs: state.nowMs + 1 } as never, lesson);
    state = result.state;
    return result;
  };
  send({ type: "output.activity", source: runtimeSource(state), state: "active" });
  send({ type: "output.activity", source: runtimeSource(state), state: "quiet" });
  const drained = reduceLessonRuntime(
    state,
    { type: "clock.tick", source: runtimeSource(state), atMs: state.quietSinceMs! + state.quietDrainMs },
    lesson,
  );
  return drained.state;
}

describe("Catching Unicorns transcript fixtures and reducer reveal boundaries", () => {
  it("provides all six reviewed transcript shapes with criterion-level expectations", () => {
    expect(Object.keys(CATCHING_UNICORNS_TRANSCRIPT_FIXTURES).sort()).toEqual(
      CATCHING_UNICORNS_SCENE_IDS.slice(0, -1).sort(),
    );
    for (const [nodeId, fixtures] of Object.entries(CATCHING_UNICORNS_TRANSCRIPT_FIXTURES)) {
      for (const variant of REQUIRED_TRANSCRIPT_VARIANTS) {
        const fixture = fixtures[variant];
        expect(fixture.transcript, `${nodeId}:${variant}`).toContain("Child:");
        if (variant === "nonLeadingProbe") expect(fixture.transcript).toContain("Tutor:");
        if (variant === "tutorLeakageEcho") expect(fixture.transcript).toContain("Tutor:");
        const criteria = CATCHING_UNICORNS_LESSON.nodes[nodeId].concepts?.map(concept => concept.id) ?? [];
        for (const criterionId of Object.keys(fixture.observations)) {
          expect(criteria, `${nodeId}:${variant}:${criterionId}`).toContain(criterionId);
        }
      }
    }
    expect(CATCHING_UNICORNS_TRANSFER_FIXTURES.defensibleYes).toContain("I would say yes");
    expect(CATCHING_UNICORNS_TRANSFER_FIXTURES.defensibleNo).toContain("I would say not established");
    expect(CATCHING_UNICORNS_TRANSFER_FIXTURES.weak).toContain("because it is modern");
    expect(CATCHING_UNICORNS_TRANSFER_FIXTURES.defensibleYes).not.toBe(
      CATCHING_UNICORNS_TRANSFER_FIXTURES.defensibleNo,
    );
  });

  it("reduces each criterion expectation independently, including prompts and tutor leakage", () => {
    for (const nodeId of Object.keys(
      CATCHING_UNICORNS_TRANSCRIPT_FIXTURES,
    ) as (keyof typeof CATCHING_UNICORNS_TRANSCRIPT_FIXTURES)[]) {
      for (const fixtureName of REQUIRED_TRANSCRIPT_VARIANTS) {
        const { state, result, fixture } = observeFixture(nodeId, fixtureName);
        let expectedRevealCount = 0;
        for (const concept of CATCHING_UNICORNS_LESSON.nodes[nodeId].concepts ?? []) {
          const expected = fixture.observations[concept.id] ?? "not_yet";
          const demonstrated = expected.startsWith("demonstrated_");
          if (demonstrated) expectedRevealCount += 1;
          expect(
            state.conceptEvidence[`${nodeId}:${concept.id}`],
            `${nodeId}:${fixtureName}:${concept.id}`,
          ).toMatchObject({
            status: demonstrated ? "demonstrated" : expected,
            understanding:
              expected === "demonstrated_independent"
                ? "independent"
                : expected === "demonstrated_prompted"
                  ? "prompted"
                  : null,
          });
        }
        expect(result.effects.filter(effect => effect.type === "concept.revealed")).toHaveLength(expectedRevealCount);
      }
      // These transcripts mention only three compare properties; memory type/location is still unresolved.
      if (nodeId === "compare") {
        const corrected = observeFixture(nodeId, "selfCorrection");
        expect(corrected.state.conceptEvidence["compare:engram-biological"]).toMatchObject({ status: "not_yet" });
        expect(corrected.state.conceptEvidence["compare:exogram-non-biological"]).toMatchObject({ status: "not_yet" });
      }
      // This synthesis probe demonstrates visible symbols extending reasoning, but says nothing about e-Class or culture.
      if (nodeId === "synthesis") {
        const prompted = observeFixture(nodeId, "nonLeadingProbe");
        expect(prompted.state.conceptEvidence["synthesis:synthesis-reasoning"]).toMatchObject({
          status: "demonstrated",
          understanding: "prompted",
        });
        expect(prompted.state.conceptEvidence["synthesis:synthesis-discovery-eclass"]).toMatchObject({
          status: "not_yet",
        });
        expect(prompted.state.conceptEvidence["synthesis:synthesis-culture"]).toMatchObject({ status: "not_yet" });
      }
    }
  });

  it("accepts both evidence-linked CAF conclusions and leaves weak reasoning unresolved", () => {
    for (const fixtureName of ["defensibleYes", "defensibleNo"]) {
      const { state, result } = observeFixture("caf-application", fixtureName);
      expect(state.conceptEvidence["caf-application:caf-defensible-conclusion"]).toMatchObject({
        status: "demonstrated",
        understanding: "independent",
      });
      expect(result.effects.filter(effect => effect.type === "concept.revealed")).toHaveLength(5);
    }
    const qualified = observeFixture("caf-application", "sufficient");
    expect(qualified.state.conceptEvidence["caf-application:caf-literacy-evidence"]).toMatchObject({
      status: "not_yet",
    });
    expect(qualified.state.conceptEvidence["caf-application:caf-defensible-conclusion"]).toMatchObject({
      status: "demonstrated",
    });

    const weak = observeFixture("caf-application", "partial");
    expect(weak.state.conceptEvidence["caf-application:caf-defensible-conclusion"]).toMatchObject({
      status: "partial",
    });
    expect(weak.state.conceptEvidence["caf-application:caf-literacy-evidence"]).toMatchObject({ status: "not_yet" });
    expect(weak.result.effects.filter(effect => effect.type === "concept.revealed")).toHaveLength(0);
  });

  it("keeps compare properties independent when a transcript mixes demonstrated, partial, and missing evidence", () => {
    const { state, result } = observeFixture("compare", "mixedCriteria");
    expect(state.conceptEvidence["compare:engram-biological"]).toMatchObject({
      status: "demonstrated",
      understanding: "independent",
    });
    expect(state.conceptEvidence["compare:exogram-non-biological"]).toMatchObject({
      status: "demonstrated",
      understanding: "independent",
    });
    expect(state.conceptEvidence["compare:exogram-durability"]).toMatchObject({
      status: "partial",
      understanding: null,
    });
    expect(state.conceptEvidence["compare:exogram-shareability"]).toMatchObject({
      status: "not_yet",
      understanding: null,
    });
    expect(state.conceptEvidence["compare:exogram-revisability"]).toMatchObject({
      status: "not_yet",
      understanding: null,
    });
    expect(
      result.effects.filter(effect => effect.type === "concept.revealed").map(effect => effect.criterionId),
    ).toEqual(["engram-biological", "exogram-non-biological"]);
  });

  it("keeps partial evidence on learner stop without emitting a reveal", () => {
    const { state, result } = observeFixture("engram", "partial");
    const stopped = reduceLessonRuntime(
      state,
      {
        type: "stop",
        runtimeId: state.runtimeId,
        atMs: state.nowMs + 1,
      },
      CATCHING_UNICORNS_LESSON,
    );
    expect(stopped.state.phase).toBe("stopped");
    expect(stopped.state.conceptEvidence).toEqual(result.state.conceptEvidence);
    expect(stopped.effects).toEqual([]);
  });

  it("skips through the authored edge without revealing or upgrading unresolved evidence", () => {
    const { state: partialState } = observeFixture("engram", "partial");
    const state = settleReliableQuiet(partialState);
    const skipped = reduceLessonRuntime(
      state,
      {
        type: "scene.skipped",
        source: runtimeSource(state),
        atMs: state.nowMs + 1,
      },
      CATCHING_UNICORNS_LESSON,
    );
    expect(skipped.state).toMatchObject({
      nodeId: "exogram",
      phase: "rendering",
      answerAccepted: false,
      conceptEvidence: { "engram:engram-biological": { status: "partial", understanding: null } },
    });
    expect(skipped.effects).toEqual([{ type: "render.requested", identity: skipped.state.pendingRender?.identity }]);
    const confirmed = reduceLessonRuntime(
      skipped.state,
      {
        type: "render.confirmed",
        runtimeId: skipped.state.runtimeId,
        identity: skipped.state.pendingRender!.identity,
        atMs: skipped.state.nowMs + 1,
      },
      CATCHING_UNICORNS_LESSON,
    );
    expect(confirmed.effects[0]).toMatchObject({ type: "steering.ready", context: { nodeId: "exogram" } });
    expect(confirmed.effects.some(effect => effect.type === "concept.revealed")).toBe(false);
  });

  it("does not skip while learner speech or tutor audio is active", () => {
    const { state: partialState } = observeFixture("engram", "partial");
    const state = settleReliableQuiet(partialState);
    for (const activeState of [
      { ...state, childSpeaking: true },
      { ...state, outputActivity: "active" as const },
    ]) {
      const result = reduceLessonRuntime(
        activeState,
        { type: "scene.skipped", source: runtimeSource(activeState), atMs: activeState.nowMs + 1 },
        CATCHING_UNICORNS_LESSON,
      );
      expect(result.state).toBe(activeState);
      expect(result.effects).toEqual([]);
    }
  });
});

it("orients CAF and synthesis without providing answers, and aligns spoken prompts with the screen", () => {
  for (const id of ["caf-application", "synthesis"]) {
    const node = CATCHING_UNICORNS_LESSON.nodes[id];
    const context = currentNodeContext(CATCHING_UNICORNS_LESSON, id);
    expect(context.scene).toHaveProperty("prompt", node.presentation.prompt);
  }
  expect(CATCHING_UNICORNS_LESSON.nodes["caf-application"].presentation.prompt).toContain(
    "four-characteristic techno-literate-culture framework",
  );
  expect(CATCHING_UNICORNS_LESSON.nodes.synthesis.presentation.prompt).toContain(
    "engrams, exograms, exographics, reasoning, discovery, and techno-literate culture",
  );
  expect(CATCHING_UNICORNS_LESSON.tutor.nodeInstruction).toContain(
    "Do not ask whether the learner is ready to move on",
  );
  expect(CATCHING_UNICORNS_LESSON.tutor.nodeInstruction).toContain(
    "If the learner asks a follow-up, answer it within this scene",
  );
});
