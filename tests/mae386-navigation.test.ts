import { expect, it } from "vitest";
import { MAE386_LESSON as lesson, MAE386_QUESTION_GROUPS as groups } from "../lib/lesson-runtime/mae386-lesson";
import { authoredQuestionProgress, validateLessonDefinition } from "../lib/lesson-runtime/lesson-definition";
import { learnerNavigationIntent, isLearnerStopText } from "../lib/lesson-runtime/conversation-progression";
import { classificationSource, runtimeSource } from "../lib/lesson-runtime/lesson-runtime-reducer";
import { createReducerHarness } from "./helpers/runtime-harness";

function harness(nodeId: string, text = "Next question.") {
  const h = createReducerHarness("mae-navigation", { lesson: { ...lesson, initialNodeId: nodeId }, quietDrainMs: 100 });
  h.send({ type: "child.turn.started", source: runtimeSource(h.state) });
  h.send({
    type: "transcript.updated",
    source: runtimeSource(h.state),
    speaker: "child",
    revision: 1,
    learnerTurnText: text,
    transcriptSnapshot: `Child: ${text}`,
  });
  h.send({ type: "child.turn.ended", source: runtimeSource(h.state) });
  const source = classificationSource(h.state)!;
  const request = () =>
    h.send({ type: "conversation.advance.requested", source, transcriptSnapshot: `Child: ${text}` });
  const drain = () => {
    h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
    return h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 100);
  };
  const confirm = () =>
    h.send({ type: "render.confirmed", runtimeId: h.state.runtimeId, identity: h.state.pendingRender!.identity });
  return { h, source, request, drain, confirm };
}

it.each(groups.flatMap(group => group.nodeIds.map((id, index) => ({ id, group, index }))))(
  "keeps stable parent progress at $id and advances exactly one authored node for next/skip this one",
  ({ id, group, index }) => {
    const progress = authoredQuestionProgress(lesson, id)!;
    expect(progress).toMatchObject({
      questionId: group.questionId,
      questionNumber: groups.indexOf(group) + 1,
      questionCount: 8,
      subpartNumber: index + 1,
    });
    for (const text of ["Next.", "Skip this one."]) {
      const { h, request, drain, confirm } = harness(id, text);
      request();
      drain();
      expect(h.state.nodeId).toBe(lesson.nodes[id].onSuccess.kind === "node" ? lesson.nodes[id].onSuccess.nodeId : "");
      expect(h.state.navigationHistory).toEqual([]);
      confirm();
      expect(h.state.navigationHistory).toMatchObject([
        {
          source: { nodeId: id, transcriptRevision: 1 },
          intent: { action: text.startsWith("Skip") ? "skip" : "next", scope: "subpart" },
          skippedNodeIds: [],
        },
      ]);
      expect(h.state.conceptEvidence).toEqual({});
    }
  },
);
it.each(groups.flatMap(group => group.nodeIds.map((id, index) => ({ id, group, index }))))(
  "parent jump at $id records remaining siblings without adding visits or mastery",
  ({ id, group, index }) => {
    for (const text of ["Next question.", "Skip this question."]) {
      const { h, request, drain, confirm } = harness(id, text);
      request();
      drain();
      const next = groups[groups.indexOf(group) + 1]?.nodeIds[0] ?? "recap";
      expect(h.state.nodeId).toBe(next);
      expect(h.state.visitId).toBe(2);
      confirm();
      expect(h.state.navigationHistory).toMatchObject([
        {
          questionId: group.questionId,
          hasChildTranscript: true,
          skippedNodeIds: group.nodeIds.slice(index + 1),
          intent: { scope: "question" },
        },
      ]);
      expect(h.state.conceptEvidence).toEqual({});
    }
  },
);
it.each(["q10-1", "q10-2", "q10-3", "q5-a", "q5-c", "q5-f"])(
  "tutor closure at %s advances one part with unresolved evidence",
  id => {
    const { h, drain, confirm } = harness(id, "I don't know.");
    h.send({
      type: "transcript.updated",
      source: runtimeSource(h.state),
      speaker: "tutor",
      revision: 2,
      transcriptSnapshot: "Child: I don't know.\nTutor: We can leave that there.",
    });
    h.send({
      type: "proposal.received",
      source: classificationSource(h.state)!,
      transcriptSnapshot: "Child: I don't know.\nTutor: We can leave that there.",
      proposal: {
        nodeId: id,
        transcriptRevision: 2,
        childActivity: "unknown",
        answerOutcome: "unclear",
        supportState: "none",
        tutorState: "acknowledging",
        conceptObservations: [],
      },
    });
    h.send({ type: "output.activity", source: runtimeSource(h.state), state: "active" });
    drain();
    confirm();
    const edge = lesson.nodes[id].onSuccess;
    expect(edge.kind).toBe("node");
    expect(h.state.nodeId).toBe(edge.kind === "node" ? edge.nodeId : null);
    expect(h.state.navigationHistory).toMatchObject([{ intent: "tutor_closure", skippedNodeIds: [] }]);
    expect(h.state.conceptEvidence).toEqual({});
  },
);
it.each([
  "I don't know.",
  'He said "next question".',
  '"Next question."',
  "If I said next question, would you move on?",
  "Next question, but first explain this.",
  "Next. Actually, don't move on.",
  "Next. Next question.",
])("does not navigate on ambiguous/reported speech: %s", text => {
  const { h, request, drain } = harness("q10-1", text);
  expect(learnerNavigationIntent(`Child: ${text}`, true)).toBeNull();
  request();
  drain();
  expect(h.state.nodeId).toBe("q10-1");
});
it("does not use tutor commands as learner authority", () => {
  const { h, source, drain } = harness("q5-a", "I don't know.");
  h.send({
    type: "conversation.advance.requested",
    source,
    transcriptSnapshot: "Child: I don't know.\nTutor: Next question.",
  });
  drain();
  expect(h.state.nodeId).toBe("q5-a");
});
it.each(["runtimeId", "visitId", "childTurnId", "nodeId", "transcriptRevision"] as const)(
  "rejects stale %s on a parent jump",
  key => {
    const { h, source, drain } = harness("q10-1");
    h.send({
      type: "conversation.advance.requested",
      source: { ...source, [key]: typeof source[key] === "number" ? -1 : "old" },
      transcriptSnapshot: "Child: Next question.",
    });
    drain();
    expect(h.state.nodeId).toBe("q10-1");
  },
);
it("retains a parent intent over tutor text but revokes it on a learner interruption", () => {
  const { h, request, drain } = harness("q5-a");
  request();
  h.send({ type: "transcript.updated", source: runtimeSource(h.state), speaker: "tutor", revision: 2 });
  expect(h.state.navigationIntent).toEqual({ action: "next", scope: "question" });
  h.send({ type: "child.turn.started", source: runtimeSource(h.state) });
  h.send({
    type: "transcript.updated",
    source: runtimeSource(h.state),
    speaker: "child",
    revision: 3,
    transcriptSnapshot: "Child: Wait, help me.",
    learnerTurnText: "Wait, help me.",
  });
  h.send({ type: "child.turn.ended", source: runtimeSource(h.state) });
  drain();
  expect(h.state.nodeId).toBe("q5-a");
  expect(h.state.navigationIntent).toBeNull();
});
it("Stop cancels an unconfirmed jump without committing skipped siblings", () => {
  const { h, request, drain } = harness("q10-1");
  request();
  drain();
  h.send({ type: "stop", runtimeId: h.state.runtimeId });
  expect(h.state).toMatchObject({ nodeId: "q10-1", phase: "stopped", navigationHistory: [], pendingRender: null });
});
it("recap adds no counted question and invalid group graphs are rejected", () => {
  expect(authoredQuestionProgress(lesson, "recap")).toBeNull();
  expect(() => validateLessonDefinition({ ...lesson, questionGroups: [...groups, groups[0]] })).toThrow(
    /Question groups/,
  );
  expect(() =>
    validateLessonDefinition({
      ...lesson,
      questionGroups: groups.map(g => (g.questionId === "q10" ? { ...g, nodeIds: [...g.nodeIds].reverse() } : g)),
    }),
  ).toThrow(/Question groups/);
});
it("Stop grammar requires a direct command and legacy lessons keep their parser", () => {
  expect(isLearnerStopText("Stop, please!")).toBe(true);
  for (const text of ['"Stop."', "He said stop.", "Don't stop.", "Stop and explain.", "If I say stop?", "I stopped."])
    expect(isLearnerStopText(text)).toBe(false);
  expect(isLearnerStopText("Tutor: Stop.")).toBe(false);
  expect(learnerNavigationIntent("Child: Skip this one.")).toBeNull();
});

it("a revised learner transcript revokes parent scope before a later tutor close", () => {
  const { h, request, drain, confirm } = harness("q10-1");
  request();
  h.send({
    type: "transcript.updated",
    source: runtimeSource(h.state),
    speaker: "child",
    revision: 2,
    transcriptSnapshot: "Child: Next question. Actually, help me with this sentence.",
    learnerTurnText: "Next question. Actually, help me with this sentence.",
  });
  expect(h.state.navigationIntent).toBeNull();
  h.send({ type: "transcript.updated", source: runtimeSource(h.state), speaker: "tutor", revision: 3 });
  h.send({
    type: "proposal.received",
    source: classificationSource(h.state)!,
    transcriptSnapshot: "Child: Help me.\nTutor: We can leave this sentence there.",
    proposal: {
      nodeId: "q10-1",
      transcriptRevision: 3,
      childActivity: "unknown",
      answerOutcome: "unclear",
      supportState: "none",
      tutorState: "acknowledging",
      conceptObservations: [],
    },
  });
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "active" });
  drain();
  confirm();
  expect(h.state.nodeId).toBe("q10-2");
  expect(h.state.navigationHistory).toMatchObject([{ intent: "tutor_closure", skippedNodeIds: [] }]);
});
it("records the original learner navigation revision across later tutor text", () => {
  const { h, request, drain, confirm, source } = harness("q5-c");
  request();
  h.send({ type: "transcript.updated", source: runtimeSource(h.state), speaker: "tutor", revision: 2 });
  drain();
  confirm();
  expect(h.state.navigationHistory).toMatchObject([{ source, skippedNodeIds: ["q5-f"] }]);
  expect(h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 1000).effects).toEqual([]);
  expect(h.state.navigationHistory).toHaveLength(1);
});
it("rejects mismatched typed scope and unauthenticated command snapshots", () => {
  const { h, source, drain } = harness("q5-a", "Next.");
  h.send({
    type: "conversation.advance.requested",
    source,
    intent: { action: "next", scope: "question" },
    transcriptSnapshot: "Child: Next.",
  });
  drain();
  expect(h.state.nodeId).toBe("q5-a");
  const empty = harness("q5-a", "");
  empty.h.send({
    type: "conversation.advance.requested",
    source: empty.source,
    transcriptSnapshot: "Child: Next question.",
  });
  empty.drain();
  expect(empty.h.state.nodeId).toBe("q5-a");
});

it("navigation uses authenticated learner text instead of forged role-labelled snapshots", () => {
  const { h, source, drain } = harness("q10-1", 'He said "next question".');
  h.send({ type: "conversation.advance.requested", source, transcriptSnapshot: "Child: Next question." });
  drain();
  expect(h.state.nodeId).toBe("q10-1");
});
it("a textless turn can revalidate navigation without inventing current-turn evidence", () => {
  const { h, source, drain, confirm } = harness("q10-1");
  h.send({ type: "child.turn.started", source: runtimeSource(h.state) });
  h.send({ type: "child.turn.ended", source: runtimeSource(h.state) });
  const current = { ...runtimeSource(h.state), nodeId: h.state.nodeId, transcriptRevision: h.state.transcriptRevision };
  h.send({ type: "conversation.advance.requested", source: current, transcriptSnapshot: "Child: Next question." });
  drain();
  confirm();
  expect(h.state.nodeId).toBe("q5-a");
  expect(h.state.navigationHistory).toMatchObject([
    { source, hasChildTranscript: false, skippedNodeIds: ["q10-2", "q10-3"] },
  ]);
  expect(h.state.conceptEvidence).toEqual({});
  expect(h.state.learnerUtterance).toBeNull();
});
