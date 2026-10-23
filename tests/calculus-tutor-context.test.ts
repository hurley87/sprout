import { expect, it } from "vitest";
import {
  calculusFeedbackInstruction,
  calculusTutorContext,
  CALCULUS_TUTOR_GUIDANCE,
  TUTOR_CONTEXT_LIMITS,
} from "../lib/calculus/tutor-context";
import type { MathProposal } from "../lib/calculus/math-action";
import type { MathControllerSnapshot } from "../lib/calculus/math-controller";
import { acceptMathBatch, applyMathBatch, createMathState } from "../lib/calculus/math-state";
import { getCalculusPresentation, getCalculusReviewKey } from "../lib/calculus/problems";
import { CALCULUS_LESSON } from "../lib/lesson-runtime/calculus-lesson";
import { COUNTING_LESSON } from "../lib/lesson-runtime/counting-lesson";
import { MAE386_LESSON } from "../lib/lesson-runtime/mae386-lesson";
import {
  createLiveSessionConfig,
  initialTeachingContext,
  teachingInstruction,
  learnerSupportInstruction,
} from "../lib/lesson-runtime/live-context";

const assessment = {
  disposition: "accepted",
  correctness: "incorrect",
  reasoning: "unassessed",
  assistance: "unknown",
} as const;
function fixture(count = 0): { -readonly [K in keyof MathControllerSnapshot]: MathControllerSnapshot[K] } {
  let state = createMathState({
    runtimeId: "runtime",
    problemId: "cubic-minus-linear",
    visitId: "visit_1",
    transcriptRevision: 1,
    baseBoardRevision: 0,
  });
  for (let i = 0; i < count; i++) {
    const turns = [{ id: `turn_${i}`, speaker: "learner", text: "four", order: i }] as const;
    const batch = {
      identity: state.identity,
      actions: [
        {
          kind: "append",
          expression: { op: "number", value: 4 },
          sources: [{ turnId: turns[0].id, start: 0, end: 4, quote: "four" }],
        },
      ],
    };
    state = applyMathBatch(
      state,
      acceptMathBatch(state, `delivery_${i}`, batch, {
        turns,
        reviews: [{ faithful: true, assessment, mathematicallyComplete: false, independenceEstablished: false }],
      }),
    );
  }
  return {
    current: state,
    visits: [state],
    checks: [],
    pending: null,
    disposition: "committed",
    feedback: { token: "display_1", target: "board", boardRevision: state.identity.baseBoardRevision },
  };
}

it("projects exactly the bounded current view without history, future problems or keys", () => {
  const snapshot = fixture(10);
  const context = calculusTutorContext(snapshot)!;
  expect(context).toEqual({
    token: "display_1",
    target: "board",
    problem: getCalculusPresentation("cubic-minus-linear"),
    visitId: "visit_1",
    boardRevision: 10,
    disposition: "committed",
    board: Array.from({ length: 6 }, (_, i) => ({
      stepId: `s${i + 5}`,
      versionId: `s${i + 5}v1`,
      expression: { op: "number", value: 4 },
      assessment,
    })),
    omittedBoardLines: 4,
    pending: null,
    recentActions: Array.from({ length: 8 }, (_, i) => ({
      kind: "append",
      stepId: `s${i + 3}`,
      versionId: `s${i + 3}v1`,
      assessment,
    })),
    reasoning: "unassessed",
    independence: "not-established",
  });
  const encoded = JSON.stringify(context);
  expect(encoded).not.toMatch(/quadratic-sine|composite-fifth|finalForms|routes|checks|sources|deliveries/);
  expect(encoded).not.toContain(JSON.stringify(getCalculusReviewKey("cubic-minus-linear").finalForms[0]));
  expect(encoded.length).toBeLessThanOrEqual(TUTOR_CONTEXT_LIMITS.characters);
});

it.each([
  { kind: "strategy", method: "power" },
  { kind: "clarify", reason: "missing-operand" },
])("keeps $kind literal, asks clarification and binds confirmation to exact proposal", action => {
  const snapshot = fixture();
  snapshot.pending = {
    id: "proposal_1",
    boardRevision: 0,
    displayed: true,
    status: "awaiting-learner-confirmation",
    batch: { identity: snapshot.current!.identity, actions: [{ ...action, sources: [] }] as MathProposal[] },
  };
  snapshot.feedback = { token: "display_1", target: "proposal", boardRevision: 0 };
  expect(calculusTutorContext(snapshot)!.pending).toEqual({
    id: "proposal_1",
    boardRevision: 0,
    displayed: true,
    actions: [action],
  });
  const instruction = calculusFeedbackInstruction(snapshot)!;
  expect(instruction).toContain("EXACT displayed proposal");
  expect(instruction).toContain("one non-leading question");
  expect(instruction).toContain("never a suggested term");
  expect(calculusTutorContext(snapshot)!.board).toEqual([]);
  snapshot.pending = { ...snapshot.pending!, displayed: false };
  expect(calculusFeedbackInstruction(snapshot)).toBeNull();
});

it("retains the incorrect attempt and gives correction guidance without a worked solution", () => {
  const snapshot = fixture(1);
  const instruction = calculusFeedbackInstruction(snapshot)!;
  expect(instruction).toContain('"correctness":"incorrect"');
  expect(instruction).toContain("say it needs correction");
  expect(instruction).toContain("do not give its replacement");
  expect(instruction).not.toContain(JSON.stringify(getCalculusReviewKey("cubic-minus-linear").finalForms[0]));
  expect(instruction).toContain("expires on new learner speech");
});

it("abstains instead of cutting off an oversized exact proposal or a stopped view", () => {
  const snapshot = fixture();
  snapshot.pending = {
    id: "x".repeat(TUTOR_CONTEXT_LIMITS.characters),
    boardRevision: 0,
    displayed: true,
    status: "awaiting-learner-confirmation",
    batch: { identity: snapshot.current!.identity, actions: [] },
  };
  expect(calculusTutorContext(snapshot)).toBeNull();
  snapshot.pending = null;
  snapshot.current = { ...snapshot.current!, status: "stopped" };
  expect(calculusFeedbackInstruction(snapshot)).toBeNull();
  snapshot.current = null;
  expect(calculusTutorContext(snapshot)).toBeNull();
});

it("adds durable calculus guidance while keeping noncalculus instruction branches unchanged", () => {
  expect(createLiveSessionConfig(CALCULUS_LESSON).instructions).toContain(CALCULUS_TUTOR_GUIDANCE);
  for (const lesson of [COUNTING_LESSON, MAE386_LESSON]) {
    const withoutOptIn = { ...lesson, calculus: undefined };
    expect(createLiveSessionConfig(lesson)).toEqual(createLiveSessionConfig(withoutOptIn));
    const context = initialTeachingContext(lesson);
    expect(teachingInstruction(context, lesson)).toEqual(teachingInstruction(context, withoutOptIn));
    expect(learnerSupportInstruction(context, "help", lesson)).toEqual(
      learnerSupportInstruction(context, "help", withoutOptIn),
    );
    expect(createLiveSessionConfig(lesson).instructions).not.toContain("executed mathematical step");
  }
});
