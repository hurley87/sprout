import { expect, it } from "vitest";
import captured from "./fixtures/mae386-evidence-2026-10-22.json";
import replay from "../docs/evidence/mae386-evidence-replay-2026-10-22.json";
import { MAE386_LESSON as lesson } from "../lib/lesson-runtime/mae386-lesson";
import { transcriptMessages } from "../lib/lesson-runtime/tutor-observation";
import { rewriteWords, type RewriteTranscript } from "../lib/lesson-runtime/mae386/rewrite-proposal";
import { runtimeSource, classificationSource } from "../lib/lesson-runtime/lesson-runtime-reducer";
import { createReducerHarness } from "./helpers/runtime-harness";
import {
  mapConversationObservation,
  type ConversationStateOutputs,
} from "../lib/lesson-runtime/conversation-observer-contract";

function setup(nodeId: string, text?: string, authenticated = true) {
  const visit = captured.visits.find(v => v.nodeId === nodeId)!;
  const transcript = text ?? visit.transcript;
  const h = createReducerHarness("historical-evidence", {
    lesson: { ...lesson, initialNodeId: nodeId },
    quietDrainMs: 100,
  });
  const lines: string[] = [];
  const turns: RewriteTranscript["turns"][number][] = [];
  const messages = transcriptMessages(transcript)!;
  for (const [messageIndex, message] of messages.entries()) {
    if (message.speaker === "Child") h.send({ type: "child.turn.started", source: runtimeSource(h.state) });
    else {
      h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
      h.send({ type: "output.activity", source: runtimeSource(h.state), state: "active" });
    }
    lines.push(`${message.speaker}: ${message.text}`);
    if (message.speaker === "Child" && authenticated)
      turns.push({ messageIndex, start: 0, end: message.text.length, childTurnId: h.state.childTurnId });
    const snapshot = lines.join("\n");
    const attribution = { text: snapshot, turns: [...turns] };
    h.send({
      type: "transcript.updated",
      source: runtimeSource(h.state),
      speaker: message.speaker === "Child" ? "child" : "tutor",
      revision: h.state.transcriptRevision + 1,
      transcriptSnapshot: snapshot,
      ...(message.speaker === "Child" ? { learnerTurnText: message.text } : {}),
      ...(lesson.nodes[nodeId].currentRewrite
        ? { rewriteTranscript: attribution }
        : { learnerTranscript: attribution }),
    });
    if (message.speaker === "Child") h.send({ type: "child.turn.ended", source: runtimeSource(h.state) });
  }
  // Actual failure: noise/energy is confirmed as a new turn, without words.
  h.send({ type: "child.turn.started", source: runtimeSource(h.state) });
  h.send({ type: "child.turn.ended", source: runtimeSource(h.state) });
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
  h.send({
    type: "conversation.recheck.requested",
    source: { ...runtimeSource(h.state), nodeId, transcriptRevision: h.state.transcriptRevision },
    transcriptSnapshot: transcript,
  });
  expect(h.state.hasChildTranscript).toBe(false);
  expect(h.state.interruptedExchange?.ready).toBe(true);
  return { h, visit, transcript: lines.join("\n") };
}
function proposalFor(nodeId: string, revision: number, text: string) {
  const messages = transcriptMessages(text)!;
  const start = messages.findIndex(m => m.speaker === "Child");
  const end = messages.findLastIndex(m => m.speaker === "Child");
  return {
    nodeId,
    transcriptRevision: revision,
    childActivity: "unknown" as const,
    answerOutcome: "correct" as const,
    supportState: "none" as const,
    tutorState: "acknowledging" as const,
    conceptObservations: lesson.nodes[nodeId].concepts!.map(c => ({
      criterionId: c.id,
      observation: "demonstrated_independent" as const,
      childMessageIndex: start,
      ...(end > start ? { childMessageEndIndex: end } : {}),
    })),
  };
}
function freeze(h: ReturnType<typeof createReducerHarness>) {
  h.send({ type: "stop", runtimeId: h.state.runtimeId });
  return h.state.questionOutcomes!;
}

it.each(replay.reports)(
  "recorded actual Jev replay at $nodeId yields the correct frozen component after a textless turn",
  report => {
    const { h, transcript } = setup(report.nodeId);
    const result = mapConversationObservation(
      { lesson, nodeId: report.nodeId, transcriptRevision: h.state.transcriptRevision, transcript },
      report.outputs as unknown as ConversationStateOutputs,
    );
    h.send({
      type: "proposal.received",
      source: classificationSource(h.state)!,
      transcriptSnapshot: transcript,
      proposal: result.proposal!,
    });
    const snapshot = freeze(h);
    const component = snapshot.questions.flatMap(q => q.components).find(c => c.nodeId === report.nodeId)!;
    expect(component.outcome).toBe("independent");
    if (report.nodeId.startsWith("q10")) {
      expect(component.rewrite?.words.every(word => word.childTurnId !== null)).toBe(true);
      expect(Object.values(component.rewrite!.selection.criteria)).toEqual([
        "demonstrated",
        "demonstrated",
        "demonstrated",
      ]);
    } else expect(component.criteria.every(c => c.evidence?.source?.childTurnId === null)).toBe(true);
  },
);

it("a historical tutor-solution echo cannot become independent conceptual evidence", () => {
  const { h, transcript } = setup(
    "q1",
    "Tutor: Exographics makes ideas visible and extends memory.\nChild: Exographics makes ideas visible and extends memory.\nTutor: Thanks.",
  );
  h.send({
    type: "proposal.received",
    source: classificationSource(h.state)!,
    transcriptSnapshot: transcript,
    proposal: proposalFor("q1", h.state.transcriptRevision, transcript),
  });
  expect(Object.values(h.state.conceptEvidence).every(record => record.understanding !== "independent")).toBe(true);
});

it("authenticated navigation words alone cannot become historical concept evidence", () => {
  const { h, transcript } = setup("q1", "Child: Next question.\nTutor: Sure.");
  h.send({
    type: "proposal.received",
    source: classificationSource(h.state)!,
    transcriptSnapshot: transcript,
    proposal: proposalFor("q1", h.state.transcriptRevision, transcript),
  });
  expect(h.state.conceptEvidence).toEqual({});
});

it("historical Q10 withdrawal stays unresolved instead of resurrecting an earlier correct proposal", () => {
  const { h, transcript } = setup(
    "q10-2",
    "Child: They collaborated on the project.\nTutor: Okay.\nChild: I withdraw that.\nTutor: We can leave it there.",
  );
  const words = rewriteWords(transcript).filter(word => word.messageIndex === 2);
  h.send({
    type: "proposal.received",
    source: classificationSource(h.state)!,
    transcriptSnapshot: transcript,
    proposal: {
      ...proposalFor("q10-2", h.state.transcriptRevision, transcript),
      conceptObservations: [],
      currentRewrite: {
        state: "withdrawn",
        start: words[0].id,
        end: words.at(-1)!.id,
        assistance: "independent",
        criteria: { meaning: "demonstrated", concise: "demonstrated", grammatical: "demonstrated" },
      },
    },
  });
  expect(h.state.rewriteProposals?.["q10-2"].current).toMatchObject({
    selection: { state: "withdrawn" },
    outcome: "unresolved",
  });
  expect(freeze(h).questions.find(q => q.questionId === "q10")!.components[1].outcome).toBe("unresolved");
});

it("captured Q6 recheck retains its confidently assessed System 2 description without crediting the textless turn", () => {
  const { h, visit, transcript } = setup("q6");
  const result = mapConversationObservation(
    { lesson, nodeId: "q6", transcriptRevision: h.state.transcriptRevision, transcript },
    visit.recordedOutputs as unknown as ConversationStateOutputs,
  );
  h.send({
    type: "proposal.received",
    source: classificationSource(h.state)!,
    transcriptSnapshot: transcript,
    proposal: result.proposal!,
  });
  expect(h.state.conceptEvidence["q6:system2-description"]).toMatchObject({
    status: "demonstrated",
    understanding: "independent",
    source: { childTurnId: null, childMessageIndex: 1, childMessageEndIndex: 3 },
  });
  expect(h.state.conceptEvidence["q6:system2-example"]).toBeUndefined(); // Historical semantic score stays uncertain.
  expect(h.state.questionAttempts?.q6 ?? []).toEqual([]);
  expect(freeze(h).questions.find(q => q.questionId === "q6")?.outcome).toBe("partial");
});

it("Q1 complete accepted paraphrase survives a textless-turn recheck and appears in the frozen recap", () => {
  const { h, transcript } = setup("q1");
  h.send({
    type: "proposal.received",
    source: classificationSource(h.state)!,
    transcriptSnapshot: transcript,
    proposal: proposalFor("q1", h.state.transcriptRevision, transcript),
  });
  expect(Object.values(h.state.conceptEvidence)).toHaveLength(2);
  const snapshot = freeze(h);
  expect(snapshot.questions[0].outcome).toBe("independent");
  expect(snapshot.questions[0].components[0].criteria.every(c => c.evidence?.source?.childTurnId === null)).toBe(true);
  const frozen = JSON.stringify(snapshot);
  h.send({
    type: "proposal.received",
    source: { ...runtimeSource(h.state), nodeId: "q1", transcriptRevision: h.state.transcriptRevision },
    transcriptSnapshot: transcript,
    proposal: proposalFor("q1", h.state.transcriptRevision, transcript),
  });
  expect(JSON.stringify(h.state.questionOutcomes)).toBe(frozen);
});

it.each([false, true])("unbound/altered historical conceptual words do not gain credit (altered=%s)", altered => {
  const { h, transcript } = setup("q1", undefined, altered);
  const supplied = altered ? transcript.replace("externally", "secretly") : transcript;
  h.send({
    type: "proposal.received",
    source: classificationSource(h.state)!,
    transcriptSnapshot: supplied,
    proposal: proposalFor("q1", h.state.transcriptRevision, supplied),
  });
  expect(h.state.conceptEvidence).toEqual({});
});

it("a historical Q10 final rewrite retains its authenticated learner words after textless activity", () => {
  const { h, transcript } = setup("q10-2");
  const words = rewriteWords(transcript).filter(w => w.messageIndex === 3);
  const proposal = {
    ...proposalFor("q10-2", h.state.transcriptRevision, transcript),
    conceptObservations: [],
    currentRewrite: {
      state: "complete" as const,
      start: words[0].id,
      end: words.at(-1)!.id,
      assistance: "independent" as const,
      criteria: {
        meaning: "demonstrated" as const,
        concise: "demonstrated" as const,
        grammatical: "demonstrated" as const,
      },
    },
  };
  h.send({
    type: "proposal.received",
    source: classificationSource(h.state)!,
    transcriptSnapshot: transcript,
    proposal,
  });
  const rewrite = h.state.rewriteProposals?.["q10-2"].current;
  expect(rewrite).toMatchObject({ text: "They collaborated on the project", outcome: "independent" });
  expect(rewrite!.words.every(w => w.childTurnId !== null && w.childTurnId < h.state.childTurnId)).toBe(true);
  const component = freeze(h).questions.find(q => q.questionId === "q10")!.components[1];
  expect(component.outcome).toBe("independent");
});

it("Q10 rechecks without word provenance cannot invent a learner proposal", () => {
  const { h, transcript } = setup("q10-2", undefined, false);
  const words = rewriteWords(transcript).filter(w => w.messageIndex === 3);
  h.send({
    type: "proposal.received",
    source: classificationSource(h.state)!,
    transcriptSnapshot: transcript,
    proposal: {
      ...proposalFor("q10-2", h.state.transcriptRevision, transcript),
      conceptObservations: [],
      currentRewrite: {
        state: "complete",
        start: words[0].id,
        end: words.at(-1)!.id,
        assistance: "independent",
        criteria: { meaning: "demonstrated", concise: "demonstrated", grammatical: "demonstrated" },
      },
    },
  });
  expect(h.state.rewriteProposals?.["q10-2"].current).toBeNull();
});
