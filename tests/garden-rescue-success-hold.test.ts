import { describe, expect, it } from "vitest";
import { GARDEN_RESCUE_LESSON, GARDEN_RESCUE_NODE_IDS as ids } from "../lib/lesson-runtime/garden-rescue-lesson";
import { validateLessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import { transitionQuietMs } from "../lib/lesson-runtime/lesson-runtime";
import { runtimeSource } from "../lib/lesson-runtime/lesson-runtime-reducer";
import { classifierProposal } from "./helpers/runtime-classifier";
import { createReducerHarness, prepareLearnerClassification } from "./helpers/runtime-harness";

const hold = GARDEN_RESCUE_LESSON.successHoldMs!;

/** Replays live attempt 9e4646cd: the tutor's whole reply plays and goes quiet before the answer is
 * classified, so without a hold the next scene was requested ~0.35 s after success became visible. */
function acceptAfterTutorReply() {
  const h = createReducerHarness("success-hold", {
    lesson: GARDEN_RESCUE_LESSON,
    quietDrainMs: transitionQuietMs(GARDEN_RESCUE_LESSON),
  });
  const source = prepareLearnerClassification(h, 1);
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "active" }, 50);
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" }, 5_600);
  h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 650);
  const accepted = h.send({
    type: "proposal.received",
    source,
    proposal: classifierProposal(source, {
      answerOutcome: "correct",
      answerCommitment: "committed",
      tutorState: "acknowledging",
    }),
    transcriptSnapshot: "Child: Three.",
  });
  return { h, accepted };
}

describe("Garden Rescue success hold", () => {
  it("keeps an accepted success on the answered scene for the authored hold", () => {
    const { h, accepted } = acceptAfterTutorReply();
    expect(hold).toBe(3_000);
    expect(accepted.effects).not.toContainEqual(expect.objectContaining({ type: "render.requested" }));
    expect(h.state).toMatchObject({ phase: "active", nodeId: ids[0], answerAccepted: true });
    const since = h.state.successSinceMs!;
    expect(since).toBe(h.state.nowMs);

    // The ordinary 1 s quiet drain has long passed; only the hold keeps the scene.
    const early = h.send({ type: "clock.tick", source: runtimeSource(h.state) }, hold - 1);
    expect(early.effects).not.toContainEqual(expect.objectContaining({ type: "render.requested" }));
    expect(h.state.tutorOutputDrained).toBe(false);

    const settled = h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 1);
    expect(settled.effects).toContainEqual(
      expect.objectContaining({ type: "render.requested", identity: expect.objectContaining({ nodeId: ids[1] }) }),
    );
    expect(h.state.phase).toBe("rendering");
  });

  it("restarts the hold when renewed speech clears the success", () => {
    const { h } = acceptAfterTutorReply();
    h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 1_000);
    h.send({ type: "child.turn.started", source: runtimeSource(h.state) });
    expect(h.state.answerAccepted).toBe(false);
    expect(h.state.successSinceMs).toBeNull();
    expect(h.state.phase).toBe("active");
  });

  it("rejects invalid authored holds", () => {
    for (const successHoldMs of [0, -1, 1.5, 5_001])
      expect(() => validateLessonDefinition({ ...GARDEN_RESCUE_LESSON, successHoldMs })).toThrow(/Success hold/);
  });
});
