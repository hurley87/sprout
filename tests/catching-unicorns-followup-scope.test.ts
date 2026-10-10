import { expect, it } from "vitest";
import { CATCHING_UNICORNS_LESSON as lesson } from "../lib/lesson-runtime/catching-unicorns-lesson";
import { currentNodeContext } from "../lib/lesson-runtime/lesson-definition";
import { transcriptMessages } from "../lib/lesson-runtime/tutor-observation";
import { teachingInstruction } from "../lib/lesson-runtime/live-context";
import {
  classificationSource,
  createLessonRuntime,
  meetsAuthoredCompletionPolicy,
  reduceLessonRuntime,
  runtimeSource,
  type LessonRuntimeEvent,
} from "../lib/lesson-runtime/lesson-runtime-reducer";

const instruction = (nodeId: string) => teachingInstruction(currentNodeContext(lesson, nodeId), lesson);

it("limits exographics follow-ups to unshown meaning, retaining abstraction already explained", () => {
  const text = instruction("exographics");
  expect(text).toContain("Visual symbols representing abstract ideas already establishes abstraction");
  expect(text).toContain("do not require another relationship, example, or physical-object contrast");
  expect(text).toContain(
    "If shared meaning is the only gap, ask only how people understand their symbols the same way",
  );
  expect(text).toContain("only if abstraction is still unclear");
  expect(text).toContain("When all four are explained, briefly acknowledge and pause without further elaboration");
  expect(text).toContain("Naming math or a map alone does not establish shared meanings or abstraction");
  expect(lesson.nodes.exographics.concepts!.map(c => c.id)).toEqual([
    "visual-symbols",
    "cultural-agreement",
    "beyond-prose",
    "abstract-concepts",
  ]);
});

it("targets discovery rather than repeating an explanation of paper tracking intermediate steps", () => {
  const text = instruction("why-exographics");
  expect(text).toContain("keeping intermediate steps on paper instead of in the head can explain memory extension");
  expect(text).toContain("Do not ask what paper does for tracking steps after that explanation");
  expect(text).toContain("Those ideas alone do not establish discovery");
  expect(text).toContain(
    "whether working on paper helped them reach an idea or result they had not already worked out",
  );
  expect(text).toContain("do not supply the claim or an example answer");
  expect(text).toContain(
    "Once all three ideas are explained, briefly acknowledge and pause without further elaboration",
  );
  expect(lesson.nodes["why-exographics"].concepts!.map(c => c.id)).toEqual([
    "reification",
    "memory-extension",
    "discovery",
  ]);
});

function harness(nodeId: string) {
  // Controlled observer proposals exercise accumulation/closure, not provider semantics.
  let state = createLessonRuntime("followup-scope", { lesson: { ...lesson, initialNodeId: nodeId }, quietDrainMs: 50 });
  let transcript = "";
  const send = (event: Record<string, unknown>) => {
    state = reduceLessonRuntime(
      state,
      { ...event, atMs: event.atMs ?? state.nowMs + 1 } as LessonRuntimeEvent,
      lesson,
    ).state;
  };
  const answer = (text: string, criteria: string[]) => {
    send({ type: "child.turn.started", source: runtimeSource(state) });
    send({
      type: "transcript.updated",
      source: runtimeSource(state),
      speaker: "child",
      revision: state.transcriptRevision + 1,
    });
    send({ type: "child.turn.ended", source: runtimeSource(state) });
    if (transcript)
      transcript += `\nTutor: ${nodeId === "exographics" ? "How do people understand those symbols the same way?" : "Did working on paper help you reach something you had not already worked out?"}`;
    transcript += `${transcript ? "\n" : ""}Child: ${text}`;
    const source = classificationSource(state)!;
    send({
      type: "proposal.received",
      source,
      transcriptSnapshot: transcript,
      proposal: {
        nodeId,
        transcriptRevision: source.transcriptRevision,
        answerOutcome: "unclear",
        childActivity: "unknown",
        supportState: "none",
        tutorState: "unknown",
        conceptObservations: criteria.map(criterionId => ({
          criterionId,
          observation: "demonstrated_independent",
          childMessageIndex: transcriptMessages(transcript)!.length - 1,
        })),
      },
    });
  };
  return {
    get state() {
      return state;
    },
    answer,
    acknowledge() {
      transcript += "\nTutor: Thanks for explaining that.";
      send({
        type: "transcript.updated",
        source: runtimeSource(state),
        speaker: "tutor",
        revision: state.transcriptRevision + 1,
      });
      const source = classificationSource(state)!;
      send({
        type: "proposal.received",
        source,
        transcriptSnapshot: transcript,
        proposal: {
          nodeId,
          transcriptRevision: source.transcriptRevision,
          answerOutcome: "unclear",
          childActivity: "unknown",
          supportState: "none",
          tutorState: "acknowledging",
          conceptObservations: [],
        },
      });
      send({ type: "output.activity", source: runtimeSource(state), state: "active" });
      expect(state.nodeId).toBe(nodeId);
      send({ type: "output.activity", source: runtimeSource(state), state: "quiet" });
      send({ type: "clock.tick", source: runtimeSource(state), atMs: state.nowMs + 100 });
    },
  };
}

it("retains the initial abstract-symbol answer when a targeted shared-meaning reply completes exographics", () => {
  const h = harness("exographics");
  h.answer("Exographics is the visual representation of an abstract idea, like math and the numbers one, two, three.", [
    "visual-symbols",
    "abstract-concepts",
    "beyond-prose",
  ]);
  expect(meetsAuthoredCompletionPolicy(h.state, lesson)).toBe(false);
  const initial = structuredClone(h.state.conceptEvidence["exographics:abstract-concepts"]);
  h.answer("We have a shared language for those math symbols, so we understand the same concepts.", [
    "cultural-agreement",
  ]);
  expect(meetsAuthoredCompletionPolicy(h.state, lesson)).toBe(true);
  expect(h.state.conceptEvidence["exographics:abstract-concepts"]).toEqual(initial);
  expect(initial.source?.childTranscript).toContain("abstract idea");
  h.acknowledge();
  expect(h.state).toMatchObject({ nodeId: "why-exographics", phase: "rendering" });
});

it("leaves discovery unshown after the paper explanation, then accepts new discovery evidence without reasking memory", () => {
  const h = harness("why-exographics");
  h.answer(
    "I stack numbers on paper, add the columns and carry values. Paper keeps track of intermediate steps instead of my head.",
    ["reification", "memory-extension"],
  );
  expect(meetsAuthoredCompletionPolicy(h.state, lesson)).toBe(false);
  expect(h.state.conceptEvidence["why-exographics:discovery"]).toBeUndefined();
  const memory = structuredClone(h.state.conceptEvidence["why-exographics:memory-extension"]);
  h.answer("Working with those written steps lets me reach a result I had not worked out before writing them.", [
    "discovery",
  ]);
  expect(meetsAuthoredCompletionPolicy(h.state, lesson)).toBe(true);
  expect(h.state.conceptEvidence["why-exographics:memory-extension"]).toEqual(memory);
  h.acknowledge();
  expect(h.state).toMatchObject({ nodeId: "techno-literate-culture", phase: "rendering" });
});

it.each([
  ["exographics", "Math.", ["beyond-prose"], "cultural-agreement"],
  ["why-exographics", "Paper holds the steps I cannot keep in my head.", ["memory-extension"], "discovery"],
] as const)("does not manufacture missing %s evidence from an incomplete reply", (nodeId, reply, ids, missing) => {
  const h = harness(nodeId);
  h.answer(reply, [...ids]);
  expect(meetsAuthoredCompletionPolicy(h.state, lesson)).toBe(false);
  expect(h.state.conceptEvidence[`${nodeId}:${missing}`]).toBeUndefined();
});
