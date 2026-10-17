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
    if (nodeId === "recap") {
      expect(instruction).toContain("terminal recap, not a question");
      expect(instruction).toContain("application ends the session after audio drains");
      expect(instruction).not.toContain("Ask the displayed question");
      return;
    }
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

it("guides concise, varied acknowledgment while retaining natural closure and uncertainty support", () => {
  const instructions = createLiveSessionConfig(lesson).instructions;
  expect(instructions).toContain("one brief, specific acknowledgment");
  expect(instructions).toContain("avoid stacking agreement phrases");
  expect(instructions).toContain("repeating their answer");
  expect(instructions).toContain("Vary the wording naturally");
  expect(instructions).toContain("concise acceptance or move-on signal");
  expect(instructions).toContain("appropriate encouragement or clarification");
  expect(instructions).toContain("app advances after your conversational closure");
});

// Instructional contracts only: these assertions cannot establish live tutor behavior.
it("uses a cumulative explanation without separate criterion interrogation or redundant examples", () => {
  const instruction = teachingInstruction(currentNodeContext(lesson, "exographics"), lesson);
  expect(instruction).toContain("accumulated explanation across replies, not four separate checks");
  expect(instruction).toContain(
    "If their example makes the meaning clear, request no extra example, restatement or elaboration for assessment confidence",
  );
  expect(instruction).not.toContain("Assess four targets separately");
  expect(instruction).not.toContain("For abstraction, ask what idea or relationship the example expresses");
});

it("preserves useful clarification, concise correction and requested help without blanket praise", () => {
  const brief = lesson.nodes.exographics.tutorBrief;
  const session = createLiveSessionConfig(lesson).instructions;
  expect(brief).toContain("Clarify only meaningful ambiguity or an incomplete idea where a useful follow-up helps");
  expect(brief).toContain("Correct errors concisely; offer targeted help after difficulty or a request");
  expect(brief).toContain("specific accurate contribution");
  expect(session).toContain("do not broadly affirm unsupported claims");
  expect(session).toContain('After "I don\'t know", offer at most one useful clarification or hint');
  expect(brief).not.toMatch(/(?:always|exactly) one follow-up/i);
});

it("allows conversational closure with unresolved concepts without claiming complete mastery", () => {
  const instruction = teachingInstruction(currentNodeContext(lesson, "exographics"), lesson);
  const session = createLiveSessionConfig(lesson).instructions;
  expect(instruction).toContain(
    "signal closure and pause for the app when sufficient or the discussion has run its course, even with unresolved concepts",
  );
  expect(instruction).toContain("Closure does not require all four concepts independently demonstrated");
  expect(session).toContain("Never claim unresolved concepts are mastered");
  expect(session).toContain("Assessment uncertainty does not require more answers");
  expect(lesson.nodes.exographics.completionPolicy).toBe("all_demonstrated");
});

it("keeps the four concepts distinct and separates tutor-supplied content from independent understanding", () => {
  const brief = lesson.nodes.exographics.tutorBrief;
  expect(lesson.nodes.exographics.concepts?.map(concept => concept.id)).toEqual([
    "visual-symbols",
    "cultural-agreement",
    "beyond-prose",
    "abstract-concepts",
  ]);
  expect(brief).toContain(
    "An example alone does not establish meaningful visual symbols, abstraction or shared conventions",
  );
  expect(brief).toContain("Tutor-supplied content is not independent learner evidence");
  expect(createLiveSessionConfig(lesson).instructions).toContain(
    "Tutor-supplied content alone never establishes learner mastery",
  );
});

it("honors move-on requests without another question and agrees with durable session guidance", () => {
  const brief = lesson.nodes.exographics.tutorBrief;
  const session = createLiveSessionConfig(lesson).instructions;
  expect(brief).toContain("Honor requests to move on without another question");
  expect(session).toContain("A request to move on needs no clarification");
  expect(session).toContain(
    "You may finish this question when the explanation is sufficient or the discussion has run its course",
  );
  expect(session).toContain("Never reconfirm an adequate accepted answer or request its repetition");
  expect(session).toContain("The app, not you, controls scene changes");
});
