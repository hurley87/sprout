import { describe, expect, it } from "vitest";
import { CATCHING_UNICORNS_LESSON as lesson } from "../lib/lesson-runtime/catching-unicorns-lesson";
import {
  conversationStateQuestions,
  mapConversationObservation,
  type ConversationStateOutputs,
} from "../lib/lesson-runtime/conversation-observer-contract";
import type { ProposedConceptObservation } from "../lib/lesson-runtime/conversation-state-classifier";
import {
  classificationSource,
  createLessonRuntime,
  reduceLessonRuntime,
  runtimeSource,
  type LessonRuntimeEvent,
} from "../lib/lesson-runtime/lesson-runtime-reducer";
import { transcriptMessages } from "../lib/lesson-runtime/tutor-observation";
import replay from "./fixtures/catching-unicorns-concept-evidence-oct16.json";

function harness(nodeId: string) {
  const definition = { ...lesson, initialNodeId: nodeId };
  let state = createLessonRuntime("oct16-replay", { lesson: definition });
  const send = (event: Record<string, unknown>) => {
    const result = reduceLessonRuntime(state, { ...event, atMs: state.nowMs + 1 } as LessonRuntimeEvent, definition);
    state = result.state;
    return result;
  };
  return {
    get evidence() { return state.conceptEvidence; },
    observe(transcript: string, observations: readonly ProposedConceptObservation[]) {
      send({ type: "child.turn.started", source: runtimeSource(state) });
      send({ type: "transcript.updated", source: runtimeSource(state), revision: state.transcriptRevision + 1, speaker: "child" });
      send({ type: "child.turn.ended", source: runtimeSource(state) });
      const source = classificationSource(state)!;
      return send({ type: "proposal.received", source, transcriptSnapshot: transcript, proposal: {
        nodeId, transcriptRevision: source.transcriptRevision, childActivity: "unknown", answerOutcome: "unclear",
        supportState: "none", tutorState: "unknown", conceptObservations: observations,
      } });
    },
  };
}

function decision(checkpoint: { nodeId: string; transcriptRevision: number; transcript: string }, outputs: unknown) {
  return mapConversationObservation({ ...checkpoint, lesson }, outputs as ConversationStateOutputs);
}

function replayNode(nodeId: string, field: "outputs" | "replayOutputs") {
  const h = harness(nodeId);
  for (const checkpoint of replay.checkpoints.filter(c => c.nodeId === nodeId)) {
    h.observe(checkpoint.transcript, decision(checkpoint, checkpoint[field]).proposal?.conceptObservations ?? []);
  }
  return h.evidence;
}

describe("October 16 recorded evidence regression", () => {
  it("recognizes external-memory paraphrases without changing the old score gate", () => {
    const checkpoint = replay.checkpoints[0];
    expect(decision(checkpoint, checkpoint.outputs).proposal?.conceptObservations).toEqual([]);
    expect(replayNode("exogram", "outputs")["exogram:exogram-non-biological"]).toBeUndefined();
    expect(replayNode("exogram", "replayOutputs")["exogram:exogram-non-biological"]).toMatchObject({
      status: "demonstrated", understanding: "independent", source: { childMessageIndex: 1,
        childTranscript: "It's information that can be stored external to the brain" },
    });
  });

  it("accepts durability, sharing and revisability from the same actual learner utterance", () => {
    const before = replayNode("compare", "outputs");
    expect(before["compare:exogram-shareability"]).toBeUndefined();
    const after = replayNode("compare", "replayOutputs");
    for (const id of ["exogram-durability", "exogram-shareability", "exogram-revisability"]) {
      expect(after[`compare:${id}`]).toMatchObject({ status: "demonstrated", understanding: id === "exogram-durability" ? null : "independent",
        source: { childMessageIndex: 1, childTranscript: expect.stringContaining("easier to share and revise") },
        promptingHistory: [{ source: expect.any(Object), prompted: id === "exogram-durability" ? null : false }],
      });
    }
    expect(new Set(Object.values(after).filter(r => r.status === "demonstrated").map(r => r.source?.childTranscript)).size).toBe(1);
  });

  it("separates exographics criteria and retains the right learner fragments through tutor interjections", () => {
    const after = replayNode("exographics", "replayOutputs");
    expect(after["exographics:visual-symbols"]?.status).not.toBe("demonstrated");
    for (const [id, index] of [["beyond-prose", 1], ["cultural-agreement", 5], ["abstract-concepts", 7]] as const) {
      expect(after[`exographics:${id}`]).toMatchObject({ status: "demonstrated", understanding: "independent",
        source: { childMessageIndex: index },
      });
      const reference = after[`exographics:${id}`].source!;
      const finalTranscript = replay.checkpoints.at(-1)!.transcript;
      expect(reference.childTranscript).toBe(transcriptMessages(finalTranscript)![index].text.trim());
      expect(after[`exographics:${id}`].promptingHistory).toHaveLength(1);
    }
    const early = replay.checkpoints.find(c => c.transcriptRevision === 102)!;
    const h = harness("exographics");
    h.observe(early.transcript, decision(early, early.replayOutputs).proposal!.conceptObservations!);
    expect(h.evidence["exographics:beyond-prose"].status).toBe("demonstrated");
    expect(h.evidence["exographics:cultural-agreement"]?.status).not.toBe("demonstrated");
    expect(h.evidence["exographics:abstract-concepts"]?.status).not.toBe("demonstrated");
  });

  it.each(replay.controls.filter(c => c.name !== "prompted-application"))("withholds mastery for $name", c => {
    const h = harness(c.nodeId);
    h.observe(c.transcript, decision(c, c.outputs).proposal?.conceptObservations ?? []);
    expect(Object.values(h.evidence).some(record => record.status === "demonstrated")).toBe(false);
  });

  it("keeps an original application after answer-giving prompted", () => {
    const c = replay.controls.find(c => c.name === "prompted-application")!;
    const h = harness(c.nodeId);
    h.observe(c.transcript, decision(c, c.outputs).proposal!.conceptObservations!);
    expect(h.evidence["exogram:exogram-non-biological"]).toMatchObject({
      status: "demonstrated", understanding: "prompted", source: { childMessageIndex: 1 },
      promptingHistory: [{ source: expect.any(Object), prompted: true }],
    });
  });

  it.each(["partial", "partial_uncertain", "not_yet", "demonstrated_unattributed", "demonstrated_prompted"] as const)(
    "does not let a later %s attempt overwrite demonstrated evidence or borrow its attribution", observation => {
      const c = replay.checkpoints[0];
      const h = harness(c.nodeId);
      h.observe(c.transcript, decision(c, c.replayOutputs).proposal!.conceptObservations!);
      const original = h.evidence["exogram:exogram-non-biological"];
      h.observe(c.transcript + "\nTutor: Can you say more?\nChild: Some sort of record, maybe.", [
        { criterionId: "exogram-non-biological", observation, childMessageIndex: 3 },
      ]);
      const accepted = h.evidence["exogram:exogram-non-biological"];
      expect(accepted).toMatchObject({ status: "demonstrated", understanding: "independent", source: original.source });
      expect(accepted.promptingHistory[0]).toEqual(original.promptingHistory[0]);
    },
  );

  it.each(["demonstrated_independent", "demonstrated_prompted", "demonstrated_unattributed"] as const)(
    "rejects a copied definition even if the provider proposes %s", observation => {
      const h = harness("exogram");
      h.observe("Tutor: Information stored outside the brain.\nChild: Information stored outside the brain.", [
        { criterionId: "exogram-non-biological", observation, childMessageIndex: 1 },
      ]);
      expect(h.evidence["exogram:exogram-non-biological"]).toMatchObject({ status: "partial", understanding: null });
    },
  );

  it("keeps independent criterion assessment and source tie-breaking in the request context", () => {
    const c = replay.checkpoints[1];
    const questions = conversationStateQuestions(lesson, c.nodeId, c.transcript);
    expect(questions["concept_exogram-shareability"].instructions).toContain("one learner utterance may fully support several criteria");
    expect(questions["concept_exogram-shareability"].instructions).not.toContain("final position at snapshot end");
    expect(questions["source_exogram-shareability"].instructions).toContain("earliest learner utterance");
    expect(questions["concept_exogram-shareability"].instructions).toContain("easier to share is sufficient");
  });
});
