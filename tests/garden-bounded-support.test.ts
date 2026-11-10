import { describe, expect, it } from "vitest";
import {
  GARDEN_RESCUE_LESSON as lesson,
  GARDEN_RESCUE_NODE_IDS as ids,
} from "../lib/lesson-runtime/garden-rescue-lesson";
import { validateLessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import { runtimeSource, classificationSource } from "../lib/lesson-runtime/lesson-runtime-reducer";
import { classifierProposal } from "./helpers/runtime-classifier";
import { createReducerHarness, prepareLearnerClassification } from "./helpers/runtime-harness";

function harness() {
  return createReducerHarness("bounded", { lesson, quietDrainMs: 250 });
}
function attempt(
  h: ReturnType<typeof harness>,
  revision: number,
  outcome: "incorrect" | "correct" | "unclear",
  text = "Three",
) {
  const source = prepareLearnerClassification(h, revision);
  const result = h.send({
    type: "proposal.received",
    source,
    transcriptSnapshot: `Child: ${text}`,
    proposal: classifierProposal(source, {
      answerOutcome: outcome,
      answerCommitment: outcome === "unclear" ? "unresolved" : "committed",
      tutorState: "unknown",
    }),
  });
  return { source, result };
}
function close(h: ReturnType<typeof harness>, source: NonNullable<ReturnType<typeof classificationSource>>) {
  h.send({ type: "support.close.sent", source });
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "active" });
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
  return h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 250);
}
function commit(h: ReturnType<typeof harness>) {
  return h.send({ type: "render.confirmed", runtimeId: h.state.runtimeId, identity: h.state.pendingRender!.identity });
}

describe("bounded support", () => {
  it("validates the authored policy", () => {
    for (const maxDifficulties of [0, -1, 1.5])
      expect(() =>
        validateLessonDefinition({ ...lesson, supportLimit: { maxDifficulties, instruction: "close" } }),
      ).toThrow(/Support limit/);
    expect(() =>
      validateLessonDefinition({ ...lesson, supportLimit: { maxDifficulties: 3, instruction: " " } }),
    ).toThrow(/Support limit/);
  });
  it("counts settled incorrect turns once and permits later success", () => {
    const h = harness();
    const first = attempt(h, 1, "incorrect");
    h.send({ type: "transcript.updated", source: runtimeSource(h.state), speaker: "child", revision: 2 });
    const revised = classificationSource(h.state)!;
    h.send({
      type: "proposal.received",
      source: revised,
      transcriptSnapshot: "Child: Three",
      proposal: classifierProposal(revised, {
        answerOutcome: "incorrect",
        answerCommitment: "committed",
        tutorState: "unknown",
      }),
    });
    expect(h.state.difficulties).toEqual([{ source: first.source, kind: "incorrect" }]);
    attempt(h, 3, "correct");
    h.send({ type: "output.activity", source: runtimeSource(h.state), state: "active" });
    h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
    h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 3000);
    expect(h.state.phase).toBe("rendering");
    commit(h);
    expect(h.state.visitOutcomes?.[0].outcome).toBe("succeeded");
  });
  it("does not count unclear speech or unfinished guesses", () => {
    const h = harness();
    for (let i = 1; i <= 5; i++) attempt(h, i, "unclear");
    expect(h.state.difficulties).toEqual([]);
    expect(h.state.supportLimitReached).toBeNull();
  });
  it("releases only after close output drains and commits the outcome", () => {
    const h = harness();
    attempt(h, 1, "incorrect");
    attempt(h, 2, "incorrect");
    const third = attempt(h, 3, "incorrect");
    expect(third.result.effects).toEqual([{ type: "support.limit.reached", source: third.source }]);
    expect(h.state.answerAccepted).toBe(false);
    expect(h.state.visitOutcomes).toEqual([]);
    const requested = close(h, third.source);
    expect(requested.effects).toContainEqual(expect.objectContaining({ type: "render.requested" }));
    expect(h.state.visitOutcomes).toEqual([]);
    expect(h.state.conceptEvidence).toEqual({});
    commit(h);
    expect(h.state.visitOutcomes).toEqual([
      { nodeId: ids[0], visitId: 1, outcome: "released_after_support_limit", source: third.source },
    ]);
    expect(h.state.supportLimitReached).toBeNull();
    attempt(h, 4, "incorrect");
    expect(h.state.difficulties?.filter(d => d.source.visitId === 2)).toHaveLength(1);
  });
  it("lets correct evidence win before departure and stop prevents outcomes", () => {
    const h = harness();
    attempt(h, 1, "incorrect");
    attempt(h, 2, "incorrect");
    const third = attempt(h, 3, "incorrect");
    h.send({ type: "support.close.sent", source: third.source });
    attempt(h, 4, "correct");
    h.send({ type: "output.activity", source: runtimeSource(h.state), state: "active" });
    h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
    h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 3000);
    commit(h);
    expect(h.state.visitOutcomes?.[0].outcome).toBe("succeeded");
    const stopped = harness();
    attempt(stopped, 1, "incorrect");
    attempt(stopped, 2, "incorrect");
    const last = attempt(stopped, 3, "incorrect");
    close(stopped, last.source);
    stopped.send({ type: "stop", runtimeId: stopped.state.runtimeId });
    expect(stopped.state.visitOutcomes).toEqual([]);
  });
});

it("counts explicit child help once, but not tutor snapshots or unclear uncertainty", () => {
  const h = harness();
  const source = prepareLearnerClassification(h, 1);
  h.send({
    type: "proposal.received",
    source,
    transcriptSnapshot: "Child: Can you help me?",
    proposal: classifierProposal(source, {
      answerOutcome: "none",
      answerCommitment: "no_answer",
      supportState: "needs_help",
      tutorState: "unknown",
    }),
  });
  expect(h.state.difficulties).toEqual([{ source, kind: "help_request" }]);
  h.send({ type: "transcript.updated", source: runtimeSource(h.state), speaker: "tutor", revision: 2 });
  const tutorSource = classificationSource(h.state)!;
  h.send({
    type: "proposal.received",
    source: tutorSource,
    transcriptSnapshot: "Child: Can you help me?\nTutor: Let's point.",
    proposal: classifierProposal(tutorSource, {
      answerOutcome: "none",
      answerCommitment: "no_answer",
      supportState: "needs_help",
      tutorState: "helping",
    }),
  });
  expect(h.state.difficulties).toHaveLength(1);
});

it("releases a final edge to complete, and stop during closing records no outcome", () => {
  const finalLesson = { ...lesson, initialNodeId: ids[3] };
  const h = createReducerHarness("final", { lesson: finalLesson, quietDrainMs: 250 });
  attempt(h, 1, "incorrect");
  attempt(h, 2, "incorrect");
  const last = attempt(h, 3, "incorrect");
  h.send({ type: "support.close.sent", source: last.source });
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "active" });
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
  h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 250);
  commit(h);
  expect(h.state.phase).toBe("complete");
  expect(h.state.visitOutcomes?.[0].outcome).toBe("released_after_support_limit");
  const stopped = harness();
  attempt(stopped, 1, "incorrect");
  attempt(stopped, 2, "incorrect");
  const third = attempt(stopped, 3, "incorrect");
  stopped.send({ type: "support.close.sent", source: third.source });
  stopped.send({ type: "stop", runtimeId: stopped.state.runtimeId });
  expect(stopped.state.phase).toBe("stopped");
  expect(stopped.state.visitOutcomes).toEqual([]);
});

it("starts every run with a fresh ledger", () => {
  const first = harness();
  attempt(first, 1, "incorrect");
  expect(first.state.difficulties).toHaveLength(1);
  expect(harness().state.difficulties).toEqual([]);
});
