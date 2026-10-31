import { describe, expect, it } from "vitest";
import { COUNTING_HALLOWEEN_LESSON } from "../lib/lesson-runtime/counting-halloween-lesson";
import { COUNTING_LESSON } from "../lib/lesson-runtime/counting-lesson";
import { validateLessonDefinition, type LessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import { LESSON_TIMING, transitionQuietMs } from "../lib/lesson-runtime/lesson-runtime";
import { runtimeSource } from "../lib/lesson-runtime/lesson-runtime-reducer";
import { classifierProposal } from "./helpers/runtime-classifier";
import { createReducerHarness, prepareLearnerClassification } from "./helpers/runtime-harness";

/** Replays live attempt 5c98607e: "Two" is accepted, the tutor says "Yes, two helpers!", pauses
 * ~300 ms, then continues its story line 11 ms after the next scene was requested. */
function replayPausedAcknowledgment(lesson: LessonDefinition) {
  const h = createReducerHarness("paused-acknowledgment", { lesson, quietDrainMs: transitionQuietMs(lesson) });
  const source = prepareLearnerClassification(h, 1);
  h.send({
    type: "proposal.received",
    source,
    proposal: classifierProposal(source, {
      answerOutcome: "correct",
      answerCommitment: "committed",
      tutorState: "acknowledging",
    }),
    transcriptSnapshot: "Child: One.",
  });
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "active" }, 50);
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" }, 600);
  const pause = h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 290);
  // The story line resumes after the pause.
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "active" }, 11);
  return { h, pause };
}

describe("Halloween scene transitions wait for the whole tutor reply", () => {
  it("documents the live failure under the shared 250 ms window", () => {
    const { h, pause } = replayPausedAcknowledgment(COUNTING_LESSON);
    expect(transitionQuietMs(COUNTING_LESSON)).toBe(LESSON_TIMING.quietDrainMs);
    expect(pause.effects).toContainEqual(expect.objectContaining({ type: "render.requested" }));
    expect(h.state.phase).toBe("stopped");
  });

  it("holds the scene through a mid-reply pause and advances after sustained quiet", () => {
    const { h, pause } = replayPausedAcknowledgment(COUNTING_HALLOWEEN_LESSON);
    expect(transitionQuietMs(COUNTING_HALLOWEEN_LESSON)).toBe(1_000);
    expect(pause.effects).not.toContainEqual(expect.objectContaining({ type: "render.requested" }));
    expect(h.state).toMatchObject({ phase: "active", nodeId: "count-1-helper", answerAccepted: true });

    h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" }, 900);
    const early = h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 999);
    expect(early.effects).not.toContainEqual(expect.objectContaining({ type: "render.requested" }));
    const settled = h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 1);
    expect(settled.effects).toContainEqual(
      expect.objectContaining({
        type: "render.requested",
        identity: expect.objectContaining({ nodeId: "count-2-helpers" }),
      }),
    );
    expect(h.state.phase).toBe("rendering");
  });

  it("keeps the garden on the shared window and rejects invalid authored windows", () => {
    expect(COUNTING_LESSON.transitionQuietMs).toBeUndefined();
    for (const transitionQuietMs of [0, -1, 1.5, 5_001])
      expect(() => validateLessonDefinition({ ...COUNTING_HALLOWEEN_LESSON, transitionQuietMs })).toThrow(
        /Transition quiet/,
      );
  });
});
