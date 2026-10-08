import { describe, expect, it } from "vitest";
import { CATCHING_UNICORNS_LESSON as conversationalLesson } from "../lib/lesson-runtime/catching-unicorns-lesson";
const lesson = { ...conversationalLesson, conversationFirst: false };
import {
  mapConversationObservation,
  type ConversationStateOutputs,
} from "../lib/lesson-runtime/conversation-observer-contract";
import {
  classificationSource,
  createLessonRuntime,
  meetsAuthoredCompletionPolicy,
  reduceLessonRuntime,
  runtimeSource,
  type LessonRuntimeEvent,
} from "../lib/lesson-runtime/lesson-runtime-reducer";
import { answerRecoveryInstruction, createLiveSessionConfig } from "../lib/lesson-runtime/live-context";
import replay from "./fixtures/catching-unicorns-completion-consistency-replay.json";

function harness(nodeId: string) {
  const definition = { ...lesson, initialNodeId: nodeId };
  let state = createLessonRuntime("completion-replay", { lesson: definition, quietDrainMs: 50 });
  const send = (event: Record<string, unknown>) => {
    state = reduceLessonRuntime(state, { ...event, atMs: state.nowMs + 1 } as LessonRuntimeEvent, definition).state;
  };
  const assess = (checkpoint: { transcript: string; outputs: unknown }, speaker: "child" | "tutor") => {
    if (speaker === "child") send({ type: "child.turn.started", source: runtimeSource(state) });
    else send({ type: "output.activity", source: runtimeSource(state), state: "active" });
    send({ type: "transcript.updated", source: runtimeSource(state), revision: state.transcriptRevision + 1, speaker });
    if (speaker === "child") send({ type: "child.turn.ended", source: runtimeSource(state) });
    const source = classificationSource(state)!;
    const decision = mapConversationObservation(
      { ...source, lesson: definition, transcript: checkpoint.transcript },
      checkpoint.outputs as ConversationStateOutputs,
    );
    if (decision.proposal)
      send({
        type: "proposal.received",
        source,
        proposal: decision.proposal,
        transcriptSnapshot: checkpoint.transcript,
      });
    return decision;
  };
  const drain = () => {
    send({ type: "output.activity", source: runtimeSource(state), state: "active" });
    send({ type: "output.activity", source: runtimeSource(state), state: "quiet" });
    state = reduceLessonRuntime(
      state,
      { type: "clock.tick", source: runtimeSource(state), atMs: state.nowMs + 100 },
      definition,
    ).state;
  };
  return {
    get state() {
      return state;
    },
    assess,
    drain,
    definition,
  };
}

describe("recorded completion consistency", () => {
  it("holds premature tutor completion until discovery is accepted, then advances after valid confirmation", () => {
    const h = harness("why-exographics");
    // Establish a learner turn before replaying the recorded tutor snapshot.
    h.assess(replay.checkpoints.prematureCompletion, "child");
    expect(h.assess(replay.checkpoints.prematureCompletion, "tutor").outcome).toBe("hold_scene");
    h.drain();
    expect(h.state).toMatchObject({ nodeId: "why-exographics", phase: "active" });
    expect(meetsAuthoredCompletionPolicy(h.state, h.definition)).toBe(false);
    const held = answerRecoveryInstruction(h.definition, h.state);
    expect(held).toContain("completion is not authorized");
    expect(held).toContain("Private focus: discovery:");
    expect(held).not.toContain("Yes, that completes this question");

    expect(h.assess(replay.checkpoints.acceptedDiscovery, "child").outcome).toBe("hold_scene");
    expect(meetsAuthoredCompletionPolicy(h.state, h.definition)).toBe(true);
    const accepted = answerRecoveryInstruction(h.definition, h.state);
    expect(accepted).toContain("the required concept evidence is recorded");
    expect(accepted).toContain("end your turn without a question");
    expect(accepted).toContain("Do not ask the learner to repeat settled points");
    h.drain();
    expect(h.state.nodeId).toBe("why-exographics");
    expect(h.assess(replay.checkpoints.validCompletion, "tutor").outcome).toBe("allow_semantic_completion_evidence");
    h.drain();
    expect(h.state).toMatchObject({ nodeId: "techno-literate-culture", phase: "rendering" });
  });

  it("keeps recorded Engram uncertainty held while avoiding a second location question", () => {
    const h = harness("engram");
    h.assess(replay.checkpoints.engramInitial, "child");
    expect(h.assess(replay.checkpoints.engramInitial, "tutor").status).toBe("abstained");
    h.drain();
    expect(h.state.nodeId).toBe("engram");
    expect(meetsAuthoredCompletionPolicy(h.state, h.definition)).toBe(false);
    const recovery = answerRecoveryInstruction(h.definition, h.state);
    expect(recovery).toContain("Unrecorded evidence may reflect uncertainty, not an omitted answer");
    expect(recovery).toContain("Do not ask for a fact already supplied, including a location");
    expect(recovery).toContain("completion is not authorized");
    expect(lesson.nodes.engram.tutorBrief).toContain("Do not ask where it exists again");
    expect(lesson.nodes.engram.concepts?.[0].description).toContain(
      "An idea stored in the mind is a natural paraphrase",
    );
  });

  it("accepts a sufficient Engram explanation without a repeated location answer when observations meet existing thresholds", () => {
    const h = harness("engram");
    // Controlled accepted scores test the acceptance path, not a prediction of
    // how the live provider will rescore the recorded explanation.
    const accepted = structuredClone(replay.checkpoints.engramInitial);
    accepted.outputs.concepts["concept_engram-biological"] = {
      choice: "demonstrated_independent",
      confidence: 0.97,
      probabilities: { not_yet: 0, partial: 0.03, demonstrated_independent: 0.97, demonstrated_prompted: 0 },
    };
    h.assess(accepted, "child");
    expect(meetsAuthoredCompletionPolicy(h.state, h.definition)).toBe(true);
    expect(answerRecoveryInstruction(h.definition, h.state)).toContain("end your turn without a question");
    h.assess(accepted, "tutor");
    h.drain();
    expect(h.state).toMatchObject({ nodeId: "exogram", phase: "rendering" });
  });

  it("preserves a genuinely incomplete discovery hold without rechecking accepted targets", () => {
    const h = harness("why-exographics");
    const incomplete = structuredClone(replay.checkpoints.acceptedDiscovery);
    incomplete.outputs.concepts["concept_discovery"] = {
      choice: "partial",
      confidence: 0.99,
      probabilities: { not_yet: 0, partial: 0.99, demonstrated_independent: 0.01, demonstrated_prompted: 0 },
    };
    h.assess(incomplete, "child");
    h.assess(incomplete, "tutor");
    h.drain();
    expect(h.state).toMatchObject({ nodeId: "why-exographics", phase: "active", transitionReady: false });
    expect(h.state.conceptEvidence["why-exographics:discovery"]?.status).toBe("partial");
    expect(meetsAuthoredCompletionPolicy(h.state, h.definition)).toBe(false);
    const recovery = answerRecoveryInstruction(h.definition, h.state);
    expect(recovery).toContain("Private focus: discovery:");
    expect(recovery).toContain("Other outstanding targets: none");
    expect(recovery).toContain("Preserve accepted explanations");
    expect(recovery).not.toContain("the required concept evidence is recorded");
  });

  it("reserves overall completion for application authorization while permitting acknowledgment of a sufficient answer", () => {
    const instructions = createLiveSessionConfig(lesson).instructions;
    expect(instructions).toContain(
      "Only an Application assessment saying the required concept evidence is recorded authorizes scene-completion language",
    );
    expect(instructions).toContain("briefly acknowledge it and pause without a question");
    expect(instructions).toContain("Never append a quick follow-up to completion");
  });
});
