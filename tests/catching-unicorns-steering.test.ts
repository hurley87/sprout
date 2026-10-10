import { expect, it } from "vitest";
import { CATCHING_UNICORNS_LESSON as lesson } from "../lib/lesson-runtime/catching-unicorns-lesson";
import { currentNodeContext } from "../lib/lesson-runtime/lesson-definition";
import { createLessonRuntime } from "../lib/lesson-runtime/lesson-runtime-reducer";
import {
  answerRecoveryInstruction,
  createLiveSessionConfig,
  teachingInstruction,
} from "../lib/lesson-runtime/live-context";

it.each(Object.keys(lesson.nodes))(
  "bounds scene and recovery updates and explicitly requests speech for %s",
  nodeId => {
    const context = currentNodeContext(lesson, nodeId);
    const instruction = teachingInstruction(context, lesson, nodeId === lesson.initialNodeId);
    // Regression budget for the authored English text, independently measured
    // below 350 tokens with two tokenizers. This is not a provider token counter.
    expect(Buffer.byteLength(instruction)).toBeLessThanOrEqual(2000);
    expect(instruction).toContain(String(lesson.nodes[nodeId].presentation.prompt));
    expect(instruction).toContain("Ask the displayed question aloud now, then wait for the learner");
    expect(instruction).toContain("listen instead of interrupting");
    expect(instruction).not.toContain("source inventory");
    expect(instruction).not.toContain(lesson.tutor.nodeInstruction);
    const state = {
      ...createLessonRuntime("budget", { lesson: { ...lesson, initialNodeId: nodeId } }),
      hasChildTranscript: true,
    };
    expect(Buffer.byteLength(answerRecoveryInstruction(lesson, state))).toBeLessThanOrEqual(1000);
  },
);

it("keeps durable teaching and recovery guidance in startup instructions", () => {
  const setup = createLiveSessionConfig(lesson);
  expect(setup.instructions).toContain(lesson.tutor.nodeInstruction);
  expect(setup.instructions).toContain(lesson.recovery.answerRecoveryInstruction);
  expect(setup.instructions).toContain(
    "On each new rendered-scene update, ask its displayed question aloud immediately",
  );
  expect(JSON.stringify(setup.input)).not.toContain('"nodeId":"compare"');
});

// Authored-contract checks only: these cannot establish live model behavior.
it("delivers bounded reasoning probes without turning hidden targets into a conversational checklist", () => {
  const startup = createLiveSessionConfig(lesson).instructions;
  expect(startup).toContain("two per scene, at most one per connection");
  expect(startup).toContain("a limitation question spends a probe too");
  expect(startup).toContain("Recovery reminders do not reset this budget");
  expect(startup).toContain("Ask one question per turn");
  expect(startup).toContain("they do not authorize a new probe sequence");
  const instruction = teachingInstruction(currentNodeContext(lesson, "synthesis"), lesson);
  expect(instruction).toContain("only names a connection");
  expect(instruction).toContain("using their own example");
  expect(instruction).toContain("without stating the causal answer or introducing unresolved concepts");
  expect(instruction).toContain("already explain the mechanism adequately");
  expect(instruction).toContain("close without redundant rephrasing");
  expect(instruction).toContain("If asked what you mean");
});

it("delivers CAF clarification as limited assistance and keeps institutional claims tentative", () => {
  const instruction = teachingInstruction(currentNodeContext(lesson, "caf-application"), lesson);
  expect(instruction).toContain("learner-proposed evidence, not verified facts");
  expect(instruction).toContain("Accept yes, no or qualified conclusions; none is canonical");
  expect(instruction).toContain("education difficulty or a clarification request");
  expect(instruction).toContain("basic education for most from advanced study for some");
  expect(instruction).toContain("ask which their evidence supports");
  expect(instruction).toContain("no institution facts or conclusion");
  expect(instruction).toContain("Tutor words are assistance, not learner evidence");
  expect(instruction).toContain("do not check every characteristic");
});

it("accepts internal memory without requiring a contrast that gives away Exogram", () => {
  const context = currentNodeContext(lesson, "engram");
  expect(context.learningObjective).toContain("inside the mind or brain");
  expect(context.tutorBrief).toContain("without adding examples, contrasts or new definitions");
  expect(context.tutorBrief).toContain("Do not explain exograms");
  expect(context.completionCriteria?.[0].description).toContain("Identifying its internal location is sufficient");
});

it("uses a presence check only for missing transcript, keeping incomplete answers in assessment recovery", () => {
  const state = createLessonRuntime("presence", { lesson });
  const checkIn = answerRecoveryInstruction(lesson, state);
  expect(checkIn).toContain("Speak now:");
  expect(checkIn).toContain("Then pause and listen");
  expect(checkIn).toContain("not evidence of misunderstanding or completion");
  expect(Buffer.byteLength(checkIn)).toBeLessThan(1000);
  const incomplete = answerRecoveryInstruction(lesson, { ...state, hasChildTranscript: true });
  expect(incomplete).not.toContain("Are you still there?");
  expect(incomplete).toContain("assessment uncertainty must not hold this question");
});

it("gives recorded Exogram evidence explicit closure guidance instead of another clarification", () => {
  const state = {
    ...createLessonRuntime("exogram-recovery", { lesson: { ...lesson, initialNodeId: "exogram" } }),
    hasChildTranscript: true,
    conceptEvidence: Object.fromEntries(
      (lesson.nodes.exogram.concepts ?? []).map(concept => [
        `exogram:${concept.id}`,
        {
          criterionId: concept.id,
          status: "demonstrated" as const,
          understanding: "independent" as const,
          source: null,
          promptingHistory: [],
        },
      ]),
    ),
  };
  expect(answerRecoveryInstruction(lesson, state)).toContain("Speak now and finish your acknowledgment");
  expect(answerRecoveryInstruction(lesson, state)).not.toContain("ask one useful");
  const partial = {
    ...state,
    conceptEvidence: {
      ...state.conceptEvidence,
      "exogram:exogram-non-biological": {
        ...state.conceptEvidence["exogram:exogram-non-biological"],
        status: "partial" as const,
      },
    },
  };
  expect(answerRecoveryInstruction(lesson, partial)).toContain("assessment uncertainty must not hold");
});
