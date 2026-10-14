import { expect, it } from "vitest";
import { CATCHING_UNICORNS_LESSON as lesson } from "../lib/lesson-runtime/catching-unicorns-lesson";
import { currentNodeContext } from "../lib/lesson-runtime/lesson-definition";
import { createLessonRuntime } from "../lib/lesson-runtime/lesson-runtime-reducer";
import { answerRecoveryInstruction, createLiveSessionConfig, teachingInstruction } from "../lib/lesson-runtime/live-context";

it.each(Object.keys(lesson.nodes))("bounds scene and recovery updates and explicitly requests speech for %s", nodeId => {
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
  const state = { ...createLessonRuntime("budget", { lesson: { ...lesson, initialNodeId: nodeId } }), hasChildTranscript: true };
  expect(Buffer.byteLength(answerRecoveryInstruction(lesson, state))).toBeLessThanOrEqual(1000);
});

it("keeps durable teaching and recovery guidance in startup instructions", () => {
  const setup = createLiveSessionConfig(lesson);
  expect(setup.instructions).toContain(lesson.tutor.nodeInstruction);
  expect(setup.instructions).toContain(lesson.recovery.answerRecoveryInstruction);
  expect(setup.instructions).toContain("On each new rendered-scene update, ask its displayed question aloud immediately");
  expect(JSON.stringify(setup.input)).not.toContain('"nodeId":"compare"');
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
