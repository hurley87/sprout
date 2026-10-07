import { describe, expect, it } from "vitest";
import { CATCHING_UNICORNS_LESSON, CATCHING_UNICORNS_SCENE_IDS } from "../lib/lesson-runtime/catching-unicorns-lesson";
import {
  classificationSource,
  createLessonRuntime,
  reduceLessonRuntime,
  runtimeSource,
} from "../lib/lesson-runtime/lesson-runtime-reducer";
import {
  mapConversationObservation,
  type ConversationStateOutputs,
} from "../lib/lesson-runtime/conversation-observer-contract";
import exogramReplay from "./fixtures/catching-unicorns-exogram-replay.json";
import laterReplay from "./fixtures/catching-unicorns-compare-exographics-replay.json";
import confirmationReplay from "./fixtures/catching-unicorns-exogram-confirmation-replay.json";
import acceptanceReplay from "./fixtures/catching-unicorns-engram-acceptance-replay.json";
import type { LessonRuntimeEvent } from "../lib/lesson-runtime/lesson-runtime-reducer";
import type { LessonDefinition } from "../lib/lesson-runtime/lesson-definition";

// Explicit manual variant exercises the shared optional continuation contract.
const MANUAL_LESSON = { ...CATCHING_UNICORNS_LESSON, requirePresentationConfirmation: true };

function reducerHarness(lesson: LessonDefinition = MANUAL_LESSON) {
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
  it("replays the recorded Engram media and microphone activity and advances at the first accepted confirmation", () => {
    const lesson = CATCHING_UNICORNS_LESSON;
    let state = createLessonRuntime(acceptanceReplay.runtimeId, { lesson });
    for (const recorded of acceptanceReplay.reducerEvents) {
      // Clock ticks are not retained in the journal; replay them before each
      // recorded event without moving past that event's timestamp.
      while (state.nowMs + 50 < recorded.atMs)
        state = reduceLessonRuntime(state, { type: "clock.tick", source: runtimeSource(state), atMs: state.nowMs + 50 }, lesson).state;
      state = reduceLessonRuntime(state, recorded as unknown as LessonRuntimeEvent, lesson).state;
    }
    expect(acceptanceReplay.reducerEvents.some(event => event.type === "child.candidate.discarded")).toBe(true);
    expect(state).toMatchObject({ nodeId: "exogram", phase: "rendering" });
    expect(state.nowMs).toBe(acceptanceReplay.reducerEvents.at(-1)!.atMs);
    expect(state.conceptEvidence["engram:engram-biological"]).toMatchObject({ status: "demonstrated", understanding: "independent" });
  });

  it("advances the recorded third question using carried definitions and the learner's three differences", () => {
    const lesson = CATCHING_UNICORNS_LESSON;
    const harness = reducerHarness(lesson);
    for (const nodeId of ["engram", "exogram"]) {
      const previous = settleScene(harness, allCriteria(nodeId, "demonstrated_independent"));
      harness.send({ type: "render.confirmed", runtimeId: previous.runtimeId, identity: previous.pendingRender!.identity });
    }
    harness.send({ type: "child.turn.started", source: runtimeSource(harness.state) });
    harness.send({ type: "transcript.updated", source: runtimeSource(harness.state), revision: harness.state.transcriptRevision + 1, speaker: "child" });
    harness.send({ type: "child.turn.ended", source: runtimeSource(harness.state) });
    harness.send({ type: "transcript.updated", source: runtimeSource(harness.state), revision: harness.state.transcriptRevision + 1, speaker: "tutor" });
    const source = classificationSource(harness.state)!;
    const recorded = laterReplay.scenes.compare;
    const decision = mapConversationObservation({ lesson, ...source, transcript: recorded.transcript }, recorded.outputs as ConversationStateOutputs);
    expect(decision.outcome).toBe("allow_semantic_completion_evidence");
    harness.send({ type: "proposal.received", source, proposal: decision.proposal, transcriptSnapshot: recorded.transcript });
    harness.send({ type: "output.activity", source: runtimeSource(harness.state), state: "active" });
    harness.send({ type: "output.activity", source: runtimeSource(harness.state), state: "quiet" });
    harness.send({ type: "clock.tick", source: runtimeSource(harness.state), atMs: harness.state.nowMs + 100 });
    expect(harness.state).toMatchObject({ phase: "rendering", nodeId: "exographics" });
  });

  it.each(["demonstrated_independent", "demonstrated_prompted"] as const)(
    "automatically advances the demo with %s evidence after confirmation and quiet media",
    observation => {
      const harness = reducerHarness(CATCHING_UNICORNS_LESSON);
      const advanced = settleScene(harness, allCriteria("engram", observation));
      expect(CATCHING_UNICORNS_LESSON.requirePresentationConfirmation).not.toBe(true);
      expect(advanced).toMatchObject({ phase: "rendering", nodeId: "exogram" });
      harness.send({
        type: "render.confirmed",
        runtimeId: advanced.runtimeId,
        identity: advanced.pendingRender!.identity,
      });
      const next = settleScene(harness, { "exogram-non-biological": observation });
      expect(next).toMatchObject({ phase: "rendering", nodeId: "compare" });
    },
  );

  it.each(["accepted", "missing_carried_evidence", "negative_summary", "uncertain_confirmation"] as const)(
    "replays the recorded exogram answer through mapping and automatic completion: %s",
    scenario => {
      const lesson =
        scenario === "missing_carried_evidence"
          ? { ...CATCHING_UNICORNS_LESSON, initialNodeId: "exogram" }
          : CATCHING_UNICORNS_LESSON;
      const harness = reducerHarness(lesson);
      if (scenario !== "missing_carried_evidence") {
        const previous = settleScene(harness, allCriteria("engram", "demonstrated_independent"));
        harness.send({
          type: "render.confirmed",
          runtimeId: previous.runtimeId,
          identity: previous.pendingRender!.identity,
        });
      }
      harness.send({ type: "child.turn.started", source: runtimeSource(harness.state) });
      harness.send({
        type: "transcript.updated",
        source: runtimeSource(harness.state),
        revision: harness.state.transcriptRevision + 1,
        speaker: "child",
      });
      harness.send({ type: "child.turn.ended", source: runtimeSource(harness.state) });
      harness.send({
        type: "transcript.updated",
        source: runtimeSource(harness.state),
        revision: harness.state.transcriptRevision + 1,
        speaker: "tutor",
      });
      const source = classificationSource(harness.state)!;
      const outputs = structuredClone(exogramReplay.outputs) as ConversationStateOutputs;
      if (scenario === "negative_summary")
        outputs.objectiveState = {
          choice: "incorrect",
          confidence: 0.97,
          probabilities: {
            completed: 0.01,
            incorrect: 0.97,
            unclear_or_incomplete: 0.01,
            unresolved_help: 0.01,
            no_attempt: 0,
          },
        };
      if (scenario === "uncertain_confirmation")
        outputs.tutorState = {
          choice: "confirmed_completion",
          confidence: 0.75,
          probabilities: { confirmed_completion: 0.75, clarifying: 0, helping: 0.23, asking: 0.01, other: 0.01 },
        };
      const decision = mapConversationObservation({ lesson, ...source, transcript: exogramReplay.transcript }, outputs);
      expect(decision.proposal?.conceptObservations).toEqual([
        { criterionId: "exogram-non-biological", observation: "demonstrated_independent" },
      ]);
      harness.send({
        type: "proposal.received",
        source,
        proposal: decision.proposal,
        transcriptSnapshot: exogramReplay.transcript,
      });
      harness.send({ type: "output.activity", source: runtimeSource(harness.state), state: "active" });
      expect(harness.state.nodeId).toBe("exogram");
      harness.send({ type: "output.activity", source: runtimeSource(harness.state), state: "quiet" });
      harness.send({ type: "clock.tick", source: runtimeSource(harness.state), atMs: harness.state.nowMs + 100 });
      expect(harness.state.nodeId).toBe(scenario === "accepted" ? "compare" : "exogram");
    },
  );

  it.each([true, false])("replays the latest exogram confirmation with carried evidence present: %s", carried => {
    const lesson = carried ? CATCHING_UNICORNS_LESSON : { ...CATCHING_UNICORNS_LESSON, initialNodeId: "exogram" };
    const harness = reducerHarness(lesson);
    if (carried) {
      const previous = settleScene(harness, allCriteria("engram", "demonstrated_independent"));
      harness.send({ type: "render.confirmed", runtimeId: previous.runtimeId, identity: previous.pendingRender!.identity });
    }
    harness.send({ type: "child.turn.started", source: runtimeSource(harness.state) });
    harness.send({ type: "transcript.updated", source: runtimeSource(harness.state), revision: harness.state.transcriptRevision + 1, speaker: "child" });
    harness.send({ type: "child.turn.ended", source: runtimeSource(harness.state) });
    harness.send({ type: "transcript.updated", source: runtimeSource(harness.state), revision: harness.state.transcriptRevision + 1, speaker: "tutor" });
    const source = classificationSource(harness.state)!;
    const decision = mapConversationObservation({ lesson, ...source, transcript: confirmationReplay.transcript }, confirmationReplay.outputs as ConversationStateOutputs);
    expect(decision.outcome).toBe("allow_semantic_completion_evidence");
    harness.send({ type: "proposal.received", source, proposal: decision.proposal, transcriptSnapshot: confirmationReplay.transcript });
    harness.send({ type: "output.activity", source: runtimeSource(harness.state), state: "active" });
    expect(harness.state.nodeId).toBe("exogram");
    harness.send({ type: "output.activity", source: runtimeSource(harness.state), state: "quiet" });
    harness.send({ type: "clock.tick", source: runtimeSource(harness.state), atMs: harness.state.nowMs + 100 });
    expect(harness.state.nodeId).toBe(carried ? "compare" : "exogram");
  });

  it("treats confident tutor affirmation as an observation, not proof of learner mastery", () => {
    const outputs = structuredClone(confirmationReplay.outputs) as ConversationStateOutputs;
    outputs.concepts = { ...outputs.concepts, "concept_exogram-non-biological": { choice: "partial", confidence: 0.99,
      probabilities: { not_yet: 0, partial: 0.99, demonstrated_independent: 0.01, demonstrated_prompted: 0 } } };
    const decision = mapConversationObservation({ lesson: CATCHING_UNICORNS_LESSON, nodeId: "exogram", transcriptRevision: 1, transcript: confirmationReplay.transcript }, outputs);
    expect(decision.outcome).toBe("hold_scene");
    expect(decision.proposal?.answerOutcome).not.toBe("correct");
  });

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
