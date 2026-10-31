import { describe, expect, it } from "vitest";
import { COUNTING_HALLOWEEN_LESSON } from "../lib/lesson-runtime/counting-halloween-lesson";
import { COUNTING_LESSON } from "../lib/lesson-runtime/counting-lesson";
import { validateLessonDefinition, type LessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import { LESSON_TIMING, transitionQuietMs } from "../lib/lesson-runtime/lesson-runtime";
import { runtimeSource } from "../lib/lesson-runtime/lesson-runtime-reducer";
import { classifierProposal } from "./helpers/runtime-classifier";
import { SHARED_WINDOW_COUNTING_LESSON } from "./helpers/counting-runtime";
import { createReducerHarness, prepareLearnerClassification } from "./helpers/runtime-harness";

/** Replays live attempt 5c98607e: a correct answer is accepted, the tutor confirms it, pauses
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

describe("counting scene transitions wait for the whole tutor reply", () => {
  it("documents the live failure under the shared 250 ms window", () => {
    const { h, pause } = replayPausedAcknowledgment(SHARED_WINDOW_COUNTING_LESSON);
    expect(transitionQuietMs(SHARED_WINDOW_COUNTING_LESSON)).toBe(LESSON_TIMING.quietDrainMs);
    expect(pause.effects).toContainEqual(expect.objectContaining({ type: "render.requested" }));
    expect(h.state.phase).toBe("stopped");
  });

  it.each([
    { lesson: COUNTING_HALLOWEEN_LESSON, first: "count-1-ghost", next: "count-2-bats" },
    { lesson: COUNTING_LESSON, first: "count-1-duck", next: "count-2-ducks" },
  ])(
    "$lesson.id holds the scene through a mid-reply pause and advances after sustained quiet",
    ({ lesson, first, next }) => {
      const { h, pause } = replayPausedAcknowledgment(lesson);
      expect(transitionQuietMs(lesson)).toBe(1_000);
      expect(pause.effects).not.toContainEqual(expect.objectContaining({ type: "render.requested" }));
      expect(h.state).toMatchObject({ phase: "active", nodeId: first, answerAccepted: true });

      h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" }, 900);
      const early = h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 999);
      expect(early.effects).not.toContainEqual(expect.objectContaining({ type: "render.requested" }));
      const settled = h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 1);
      expect(settled.effects).toContainEqual(
        expect.objectContaining({
          type: "render.requested",
          identity: expect.objectContaining({ nodeId: next }),
        }),
      );
      expect(h.state.phase).toBe("rendering");
    },
  );

  it("gives both counting lessons the same window and rejects invalid authored windows", () => {
    expect(COUNTING_LESSON.transitionQuietMs).toBe(1_000);
    expect(COUNTING_HALLOWEEN_LESSON.transitionQuietMs).toBe(1_000);
    for (const transitionQuietMs of [0, -1, 1.5, 5_001])
      expect(() => validateLessonDefinition({ ...COUNTING_HALLOWEEN_LESSON, transitionQuietMs })).toThrow(
        /Transition quiet/,
      );
  });
});
