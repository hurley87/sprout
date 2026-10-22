import { expect, it } from "vitest";
import { MAE386_LESSON as lesson, MAE386_QUESTION_GROUPS as groups } from "../lib/lesson-runtime/mae386-lesson";
import { classificationSource, runtimeSource, reduceLessonRuntime } from "../lib/lesson-runtime/lesson-runtime-reducer";
import { freezeQuestionOutcomes, questionRecap, OUTCOME_LABELS } from "../lib/lesson-runtime/mae386/question-outcomes";
import { createReducerHarness } from "./helpers/runtime-harness";
import type { ProposedConceptObservation } from "../lib/lesson-runtime/conversation-state-classifier";
import { projectRewrite, rewriteWords, type RewriteProposal } from "../lib/lesson-runtime/mae386/rewrite-proposal";

type Harness = ReturnType<typeof createReducerHarness>;
function setup(nodeId = "q1") {
  return createReducerHarness("outcomes", { lesson: { ...lesson, initialNodeId: nodeId }, quietDrainMs: 100 });
}
function turn(h: Harness, text: string) {
  h.send({ type: "child.turn.started", source: runtimeSource(h.state) });
  h.send({
    type: "transcript.updated",
    source: runtimeSource(h.state),
    speaker: "child",
    revision: h.state.transcriptRevision + 1,
    learnerTurnText: text,
    transcriptSnapshot: `Child: ${text}`,
  });
  h.send({ type: "child.turn.ended", source: runtimeSource(h.state) });
  return classificationSource(h.state)!;
}
function observe(
  h: Harness,
  labels: readonly ProposedConceptObservation["observation"][],
  outcome: "correct" | "incorrect" | "unclear" = "correct",
  text = "An original learner explanation with relevant reasoning.",
) {
  const source = turn(h, text);
  const proposal = {
    nodeId: h.state.nodeId,
    transcriptRevision: h.state.transcriptRevision,
    childActivity: "unknown",
    answerOutcome: outcome,
    supportState: "none",
    tutorState: "asking",
    conceptObservations: lesson.nodes[h.state.nodeId].concepts?.map((c, i) => ({
      criterionId: c.id,
      observation: labels[i] ?? "not_yet",
      childMessageIndex: 0,
    })),
  };
  h.send({ type: "proposal.received", source, proposal, transcriptSnapshot: `Child: ${text}` });
  return { source, proposal };
}
function stop(h: Harness) {
  h.send({ type: "stop", runtimeId: h.state.runtimeId });
  return h.state.questionOutcomes!;
}
function component(h: Harness, id = h.state.nodeId) {
  return stop(h)
    .questions.flatMap(q => q.components)
    .find(c => c.nodeId === id)!;
}
function skip(h: Harness, scope: "subpart" | "question" = "subpart") {
  h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
  h.send({ type: "scene.skipped", source: runtimeSource(h.state), scope }, 100);
}
function confirm(h: Harness) {
  return h.send({ type: "render.confirmed", runtimeId: h.state.runtimeId, identity: h.state.pendingRender!.identity });
}

it("freezes all eight groups with never reached components, including optional Q15 dimensions", () => {
  const h = setup();
  const snapshot = stop(h);
  expect(snapshot.questions.map(q => q.questionId)).toEqual(groups.map(g => g.questionId));
  expect(snapshot.questions).toHaveLength(8);
  expect(snapshot.questions.every(q => q.outcome === "unattempted")).toBe(true);
  expect(snapshot.questions[0].components[0].reached).toBe(true);
  expect(
    snapshot.questions
      .slice(1)
      .flatMap(q => q.components)
      .every(c => !c.reached),
  ).toBe(true);
  expect(snapshot.questions.at(-1)!.components[0].optionalDimensions).toMatchObject([
    { id: "evidence-and-limits", assessed: false },
  ]);
});
it.each(groups.filter(g => g.questionId !== "q10").flatMap(g => g.nodeIds))(
  "projects independent and assisted criteria for %s",
  nodeId => {
    for (const label of ["demonstrated_independent", "demonstrated_prompted"] as const) {
      const h = setup(nodeId);
      observe(
        h,
        lesson.nodes[nodeId].concepts!.map(() => label),
      );
      const c = component(h);
      expect(c.outcome).toBe(label === "demonstrated_independent" ? "independent" : "assisted");
      expect(c.criteria.every(c => c.evidence?.source?.runtimeId === "outcomes")).toBe(true);
      expect(c.attempts[0].text).toContain("learner explanation");
    }
  },
);
it.each([
  [["demonstrated_independent", "demonstrated_prompted"], "correct", "assisted"],
  [["partial"], "unclear", "partial"],
  [["partial_uncertain"], "unclear", "unresolved"],
  [["demonstrated_unattributed", "demonstrated_unattributed"], "correct", "unresolved"],
  [["not_yet"], "incorrect", "incorrect"],
  [["partial"], "incorrect", "incorrect"],
  [["not_yet"], "unclear", "unresolved"],
] as const)("retains criterion/attempt detail for %j and %s", (labels, outcome, expected) => {
  const h = setup();
  observe(h, labels, outcome);
  expect(component(h).outcome).toBe(expected);
});
it.each(["Next.", "Next question.", "Skip this question.", "Stop.", "I don't know."])(
  "never accepts control/non-answer text as an attempt or criterion: %s",
  text => {
    const h = setup();
    observe(h, ["demonstrated_independent", "demonstrated_independent"], "incorrect", text);
    const c = component(h);
    expect(c.outcome).toBe("unattempted");
    expect(c.attempts).toEqual([]);
    expect(c.criteria.every(c => !c.evidence?.source)).toBe(true);
  },
);
it("does not accept source text as an answer", () => {
  const h = setup("q5-a");
  observe(
    h,
    ["demonstrated_independent", "demonstrated_independent"],
    "incorrect",
    String(lesson.nodes["q5-a"].presentation.sourceText),
  );
  expect(component(h).outcome).toBe("unattempted");
});
it.each(["pending", "unavailable"] as const)(
  "represents %s live classification without inferring an incorrect answer",
  status => {
    const h = setup();
    const source = turn(h, "An answer whose assessment has not arrived.");
    h.send({ type: "question.observation", source, status });
    const c = component(h);
    expect(c.outcome).toBe("unresolved");
    expect(c.attempts).toEqual([]);
    expect(c.assessment).toBe(status === "pending" ? "unresolved" : "unavailable");
  },
);
it.each(["Next.", "Next question."])(
  "distinguishes authored departures for %s without attempting control speech",
  text => {
    const h = setup("q10-1");
    const source = turn(h, text);
    h.send({ type: "conversation.advance.requested", source, transcriptSnapshot: `Child: ${text}` });
    h.send({ type: "output.activity", source: runtimeSource(h.state), state: "quiet" });
    h.send({ type: "clock.tick", source: runtimeSource(h.state) }, 100);
    confirm(h);
    const components = stop(h).questions.find(q => q.questionId === "q10")!.components;
    expect(components[0]).toMatchObject({ reached: true, outcome: "unattempted", attempts: [] });
    expect(components[1]).toMatchObject(
      text === "Next."
        ? { reached: true, skipped: false, outcome: "unattempted" }
        : { reached: false, skipped: true, outcome: "skipped" },
    );
    expect(components[2]).toMatchObject({ reached: false, outcome: text === "Next." ? "unattempted" : "skipped" });
  },
);
it.each(["q10-1", "q5-a", "q15"])(
  "Stop cancels unconfirmed %s departure without fabricating visited/skipped nodes",
  node => {
    const h = setup(node);
    skip(h, "question");
    expect(h.state.pendingRender).not.toBeNull();
    const identity = h.state.pendingRender!.identity;
    const snapshot = stop(h);
    expect(h.state.navigationHistory).toEqual([]);
    expect(
      snapshot.questions
        .flatMap(q => q.components)
        .filter(c => c.reached)
        .map(c => c.nodeId),
    ).toEqual([node]);
    expect(snapshot.questions.flatMap(q => q.components).some(c => c.skipped)).toBe(false);
    expect(h.send({ type: "render.confirmed", runtimeId: h.state.runtimeId, identity }).effects).toEqual([]);
    expect(h.state.questionOutcomes).toBe(snapshot);
  },
);
it("Q5 mixed parts retain independent, helped and incorrect component detail", () => {
  const h = setup("q5-a");
  observe(
    h,
    lesson.nodes["q5-a"].concepts!.map(() => "demonstrated_independent"),
  );
  skip(h);
  confirm(h);
  observe(
    h,
    lesson.nodes["q5-c"].concepts!.map(() => "demonstrated_prompted"),
  );
  skip(h);
  confirm(h);
  observe(h, [], "incorrect");
  const q5 = stop(h).questions.find(q => q.questionId === "q5")!;
  expect(q5.outcome).toBe("partial");
  expect(q5.components.map(c => c.outcome)).toEqual(["independent", "assisted", "incorrect"]);
  expect(q5.components[0].skipped).toBe(true); // departure never erases accepted work
});
it("freezes only at exact recap entry, commits final departure once, and shares immutable spoken/visual authority", () => {
  const h = setup();
  for (let index = 0; index < 8; index++) {
    skip(h, "question");
    expect(h.state.questionOutcomes).toBeUndefined();
    const identity = h.state.pendingRender!.identity;
    h.send({ type: "render.confirmed", runtimeId: h.state.runtimeId, identity: { ...identity, token: "wrong" } });
    expect(h.state.questionOutcomes).toBeUndefined();
    confirm(h);
    h.send({ type: "render.confirmed", runtimeId: h.state.runtimeId, identity });
  }
  const snapshot = h.state.questionOutcomes!;
  expect(h.state.nodeId).toBe("recap");
  expect(h.state.navigationHistory).toHaveLength(8);
  const recap = questionRecap(snapshot);
  expect(recap.questions).toBe(snapshot.questions);
  snapshot.questions.forEach(q =>
    expect(recap.spoken).toContain(`${q.questionId.toUpperCase()}: ${OUTCOME_LABELS[q.outcome]}.`),
  );
  expect(recap.questions.every(q => q.outcome === "skipped")).toBe(true);
  expect(Object.isFrozen(snapshot.questions[3].components[0].criteria)).toBe(true);
  expect(() => (snapshot.questions as unknown[]).push({})).toThrow();
  h.send({ type: "stop", runtimeId: h.state.runtimeId });
  expect(h.state.questionOutcomes).toBe(snapshot);
  expect(questionRecap(snapshot, true).label).toBe("Session ended early");
});
it.each(["settled", "unavailable"] as const)(
  "final transition drains an exact pending observation until %s, then freezes its accepted evidence",
  status => {
    const h = setup("q15");
    const { source, proposal } = observe(h, [], "unclear");
    h.send({ type: "question.observation", source, status: "pending" });
    skip(h);
    expect(h.state.phase).toBe("active");
    expect(h.state.questionOutcomes).toBeUndefined();
    h.send({ type: "question.observation", source, status });
    expect(h.state.phase).toBe("rendering");
    confirm(h);
    expect(h.state.questionOutcomes!.questions.at(-1)!.outcome).toBe("unresolved");
    const frozen = h.state.questionOutcomes;
    h.send({
      type: "proposal.received",
      source,
      proposal: { ...proposal, answerOutcome: "correct" },
      transcriptSnapshot: "Child: Late response",
    });
    expect(h.state.questionOutcomes).toBe(frozen);
  },
);

function rewriteAttempt(
  nodeId: string,
  outcome: "independent" | "assisted" | "incorrect" | "partial" | "unresolved",
  state: RewriteProposal["state"] = "complete",
) {
  const text = "He was late because he overslept.";
  const transcript = `Child: ${text}`;
  const words = rewriteWords(transcript);
  return projectRewrite(
    {
      state,
      start: words[0].id,
      end: words.at(-1)!.id,
      assistance: outcome === "assisted" ? "assisted" : "independent",
      criteria: {
        meaning:
          outcome === "incorrect"
            ? "incorrect"
            : outcome === "partial"
              ? "partial"
              : outcome === "unresolved"
                ? "unresolved"
                : "demonstrated",
        concise: "demonstrated",
        grammatical: "demonstrated",
      },
    },
    { runtimeId: "outcomes", nodeId, visitId: 1, childTurnId: 1, transcriptRevision: 1 },
    transcript,
    { text: transcript, turns: [{ messageIndex: 0, start: 0, end: text.length, childTurnId: 1 }] },
  );
}
it.each(["incorrect", "unresolved"] as const)(
  "Q10 current %s cannot recover prior correct history or mastery",
  outcome => {
    const h = setup("q10-1");
    const prior = rewriteAttempt("q10-1", "independent");
    const current = rewriteAttempt("q10-1", outcome, outcome === "unresolved" ? "withdrawn" : "complete");
    const state = {
      ...h.state,
      rewriteProposals: { "q10-1": { current, history: [prior, current], revision: 2 } },
      conceptEvidence: Object.fromEntries(
        lesson.nodes["q10-1"].concepts!.map(c => [
          `q10-1:${c.id}`,
          {
            criterionId: c.id,
            status: "demonstrated" as const,
            understanding: "independent" as const,
            source: null,
            promptingHistory: [],
          },
        ]),
      ),
    };
    const frozen = reduceLessonRuntime(
      state,
      { type: "stop", runtimeId: state.runtimeId, atMs: state.nowMs + 1 },
      lesson,
    ).state.questionOutcomes!;
    expect(frozen.questions.find(q => q.questionId === "q10")!.components[0].outcome).toBe(outcome);
  },
);
it("Q10 aggregates three distinct current proposals and preserves assistance detail", () => {
  const h = setup("q10-3");
  const rewriteProposals = Object.fromEntries(
    ["independent", "assisted", "partial"].map((outcome, index) => {
      const nodeId = `q10-${index + 1}`;
      const current = rewriteAttempt(nodeId, outcome as "independent" | "assisted" | "partial");
      return [nodeId, { current, history: [current], revision: 1 }];
    }),
  );
  const frozen = freezeQuestionOutcomes(lesson, { ...h.state, rewriteProposals });
  const question = frozen.questions.find(q => q.questionId === "q10")!;
  expect(question.outcome).toBe("partial");
  expect(question.components.map(c => c.outcome)).toEqual(["independent", "assisted", "partial"]);
  expect(Object.isFrozen(rewriteProposals["q10-1"].current)).toBe(false);
});

it("Q10 component criteria never expose historical concept mastery as the current edit", () => {
  const h = setup("q10-1");
  const current = rewriteAttempt("q10-1", "incorrect");
  const snapshot = freezeQuestionOutcomes(lesson, {
    ...h.state,
    rewriteProposals: { "q10-1": { current, history: [rewriteAttempt("q10-1", "independent"), current], revision: 2 } },
  });
  const c = snapshot.questions.find(q => q.questionId === "q10")!.components[0];
  expect(c.criteria.every(criterion => criterion.evidence === null)).toBe(true);
  expect(c.criteria.find(criterion => criterion.id === "meaning")?.rewriteResult).toBe("incorrect");
  expect(c.criteria.every(criterion => criterion.authored?.basis && criterion.authored.sources.length)).toBe(true);
});
