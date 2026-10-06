import { describe, expect, it } from "vitest";
import { CATCHING_UNICORNS_LESSON, CATCHING_UNICORNS_SCENE_IDS } from "../lib/lesson-runtime/catching-unicorns-lesson";
import {
  classificationSource,
  createLessonRuntime,
  reduceLessonRuntime,
  runtimeSource,
} from "../lib/lesson-runtime/lesson-runtime-reducer";
import type { LessonDefinition } from "../lib/lesson-runtime/lesson-definition";

function reducerHarness(lesson: LessonDefinition = CATCHING_UNICORNS_LESSON) {
  let state = createLessonRuntime("catching-unicorns-completion", { lesson, quietDrainMs: 50 });
  const send = (event: Record<string, unknown>) => {
    const result = reduceLessonRuntime(state, { ...event, atMs: event.atMs ?? state.nowMs + 1 } as never, lesson);
    state = result.state;
    return result;
  };
  return {
    get state() {
      return state;
    },
    send,
  };
}

function settleScene(
  harness: ReturnType<typeof reducerHarness>,
  observationByCriterion: Readonly<Record<string, "partial" | "demonstrated_independent" | "demonstrated_prompted">>,
) {
  const childText = "I can explain the idea in my own words.";
  harness.send({ type: "child.turn.started", source: runtimeSource(harness.state) });
  harness.send({
    type: "transcript.updated",
    source: runtimeSource(harness.state),
    revision: harness.state.transcriptRevision + 1,
    speaker: "child",
  });
  harness.send({ type: "child.turn.ended", source: runtimeSource(harness.state) });

  const childSource = classificationSource(harness.state)!;
  harness.send({
    type: "proposal.received",
    source: childSource,
    transcriptSnapshot: `Child: ${childText}`,
    proposal: {
      nodeId: childSource.nodeId,
      transcriptRevision: childSource.transcriptRevision,
      childActivity: "unknown",
      answerOutcome: "correct",
      supportState: "none",
      tutorState: "unknown",
      conceptObservations: Object.entries(observationByCriterion).map(([criterionId, observation]) => ({
        criterionId,
        observation,
      })),
    },
  });

  harness.send({
    type: "transcript.updated",
    source: runtimeSource(harness.state),
    revision: harness.state.transcriptRevision + 1,
    speaker: "tutor",
  });
  const acknowledgedSource = classificationSource(harness.state)!;
  harness.send({
    type: "proposal.received",
    source: acknowledgedSource,
    transcriptSnapshot: `Child: ${childText}\nTutor: I heard your explanation.`,
    proposal: {
      nodeId: acknowledgedSource.nodeId,
      transcriptRevision: acknowledgedSource.transcriptRevision,
      childActivity: "unknown",
      answerOutcome: "correct",
      supportState: "none",
      tutorState: "acknowledging",
      conceptObservations: [],
    },
  });

  // Satisfy the reducer's eligible tutor-media and sustained quiet gates.
  harness.send({ type: "output.activity", source: runtimeSource(harness.state), state: "active" });
  harness.send({ type: "output.activity", source: runtimeSource(harness.state), state: "quiet" });
  harness.send({ type: "clock.tick", source: runtimeSource(harness.state), atMs: harness.state.nowMs + 100 });
  return harness.state;
}

function allCriteria(nodeId: string, observation: "demonstrated_independent" | "demonstrated_prompted") {
  return Object.fromEntries((CATCHING_UNICORNS_LESSON.nodes[nodeId].concepts ?? []).map(({ id }) => [id, observation]));
}

describe("Catching Unicorns normal completion policy", () => {
  it("requires all authored scene criteria and uses the prompted-permitted policy", () => {
    for (const nodeId of CATCHING_UNICORNS_SCENE_IDS.slice(0, -1)) {
      expect(CATCHING_UNICORNS_LESSON.nodes[nodeId].completionPolicy).toBe("all_demonstrated");
    }
    expect(CATCHING_UNICORNS_LESSON.nodes.engram.completionPolicy).not.toBe("all_independent");
  });

  it.each([
    ["partial", { "engram-biological": "partial" }],
    ["absent", {}],
  ] as const)(
    "blocks ordinary advance when criterion evidence is %s, despite settled answer and media gates",
    (_label, observations) => {
      const harness = reducerHarness();
      const final = settleScene(harness, observations);
      expect(final.answerAccepted).toBe(true);
      expect(final.acknowledgmentObserved).toBe(true);
      expect(final.tutorOutputDrained).toBe(true);
      expect(final.phase).toBe("active");
      expect(final.nodeId).toBe("engram");
      expect(final.conceptEvidence["engram:engram-biological"]?.status ?? "not_yet").toBe(
        _label === "partial" ? "partial" : "not_yet",
      );
    },
  );

  it.each(["demonstrated_independent", "demonstrated_prompted"] as const)(
    "allows normal advance after all criteria are %s",
    observation => {
      const harness = reducerHarness();
      const ready = settleScene(harness, allCriteria("engram", observation));
      expect(ready.phase).toBe("active");
      expect(ready.transitionReady).toBe(true);
      expect(ready.nodeId).toBe("engram");
      const final = harness.send({ type: "presentation.continued", source: classificationSource(ready)! }).state;
      expect(final.phase).toBe("rendering");
      expect(final.nodeId).toBe("exogram");
      expect(final.conceptEvidence["exogram:engram-biological"]).toMatchObject({
        status: "demonstrated",
        understanding: observation === "demonstrated_independent" ? "independent" : "prompted",
      });
    },
  );

  it("keeps partial evidence unresolved on explicit skip even with eligible quiet media", () => {
    const harness = reducerHarness();
    const state = settleScene(harness, { "engram-biological": "partial" });
    expect(state.outputActivity).toBe("quiet");
    expect(state.phase).toBe("active");

    const skipped = harness.send({ type: "scene.skipped", source: runtimeSource(state) });
    expect(skipped.state).toMatchObject({ nodeId: "exogram", phase: "rendering", answerAccepted: false });
    expect(skipped.state.conceptEvidence["engram:engram-biological"]).toMatchObject({
      status: "partial",
      understanding: null,
    });
    expect(skipped.state.conceptEvidence).not.toHaveProperty("exogram:engram-biological");
    expect(skipped.effects.some(effect => effect.type === "concept.revealed")).toBe(false);
  });

  it("preserves partial evidence when the learner stops", () => {
    const harness = reducerHarness();
    const beforeStop = settleScene(harness, { "engram-biological": "partial" });
    const stopped = harness.send({ type: "stop", runtimeId: beforeStop.runtimeId });
    expect(stopped.state.phase).toBe("stopped");
    expect(stopped.state.conceptEvidence).toEqual(beforeStop.conceptEvidence);
    expect(stopped.effects).toEqual([]);
  });

  it("uses demonstrated carry-forward evidence to complete the next scene", () => {
    const harness = reducerHarness();
    const ready = settleScene(harness, allCriteria("engram", "demonstrated_independent"));
    const first = harness.send({ type: "presentation.continued", source: classificationSource(ready)! }).state;
    const confirmed = harness.send({
      type: "render.confirmed",
      runtimeId: first.runtimeId,
      identity: first.pendingRender!.identity,
    });
    expect(confirmed.state.conceptEvidence["exogram:engram-biological"]).toMatchObject({
      status: "demonstrated",
      understanding: "independent",
    });

    const nextReady = settleScene(harness, { "exogram-non-biological": "demonstrated_prompted" });
    const final = harness.send({ type: "presentation.continued", source: classificationSource(nextReady)! }).state;
    expect(final.phase).toBe("rendering");
    expect(final.nodeId).toBe("compare");
    expect(final.conceptEvidence["exogram:exogram-non-biological"].status).toBe("demonstrated");
  });

  it("does not advance from a reveal while tutor audio is active again", () => {
    const harness = reducerHarness();
    const ready = settleScene(harness, allCriteria("engram", "demonstrated_independent"));
    expect(ready.transitionReady).toBe(true);

    const resumed = harness.send({ type: "output.activity", source: runtimeSource(ready), state: "active" });
    expect(resumed.state.transitionReady).toBe(false);
    expect(resumed.state.tutorOutputDrained).toBe(false);
    const blocked = harness.send({
      type: "presentation.continued",
      source: classificationSource(resumed.state)!,
    });
    expect(blocked.state.phase).toBe("active");
    expect(blocked.effects).toEqual([]);

    harness.send({ type: "output.activity", source: runtimeSource(blocked.state), state: "quiet" });
    const drained = harness.send({
      type: "clock.tick",
      source: runtimeSource(harness.state),
      atMs: harness.state.nowMs + 100,
    });
    const advanced = harness.send({
      type: "presentation.continued",
      source: classificationSource(drained.state)!,
    });
    expect(advanced.state.phase).toBe("rendering");
    expect(advanced.state.nodeId).toBe("exogram");
  });

  it("revokes a ready continuation when a newer tutor transcript revision needs reclassification", () => {
    const harness = reducerHarness();
    const ready = settleScene(harness, allCriteria("engram", "demonstrated_independent"));
    expect(ready.transitionReady).toBe(true);

    const revised = harness.send({
      type: "transcript.updated",
      source: runtimeSource(ready),
      revision: ready.transcriptRevision + 1,
      speaker: "tutor",
    }).state;
    expect(revised).toMatchObject({
      phase: "active",
      nodeId: "engram",
      transitionReady: false,
      answerAccepted: false,
      acknowledgmentObserved: false,
      tutorOutputDrained: true,
    });

    const staleContinuation = harness.send({
      type: "presentation.continued",
      source: classificationSource(ready)!,
    });
    expect(staleContinuation.state).toBe(revised);
    expect(staleContinuation.effects).toEqual([]);

    const freshSource = classificationSource(revised)!;
    harness.send({
      type: "proposal.received",
      source: freshSource,
      transcriptSnapshot: "Child: I can explain the idea in my own words.\nTutor: Yes, and another detail.",
      proposal: {
        nodeId: freshSource.nodeId,
        transcriptRevision: freshSource.transcriptRevision,
        childActivity: "unknown",
        answerOutcome: "correct",
        supportState: "none",
        tutorState: "acknowledging",
        conceptObservations: [],
      },
    });
    const revalidated = harness.state;
    expect(revalidated.transitionReady).toBe(true);
    const staleAfterRevalidation = harness.send({
      type: "presentation.continued",
      source: classificationSource(ready)!,
    });
    expect(staleAfterRevalidation.state).toBe(revalidated);
    expect(staleAfterRevalidation.effects).toEqual([]);
    const continued = harness.send({
      type: "presentation.continued",
      source: classificationSource(revalidated)!,
    });
    expect(continued.state).toMatchObject({ phase: "rendering", nodeId: "exogram" });
  });
});
