import { afterEach, expect, it, vi } from "vitest";
import candidate from "../docs/issue-57-support-candidate-v2-results.json";
import review from "../docs/issue-57-clarification-review-set.json";
import {
  CONVERSATION_QUESTIONS,
  classifyConversationStateWithDiagnostics,
} from "../lib/experiments/issue-57/legacy/jev-conversation-state-classifier";
import { mapConversationClassification } from "../lib/experiments/issue-57/legacy/classification-decision";
import { SUPPORT_CLARIFICATION_INSTRUCTION } from "../lib/lesson-runtime/support-clarification";
import { SPROUT_LIVE_CONFIG } from "./helpers/counting-live-context";
import {
  classificationSource,
  createLessonRuntime,
  reduceLessonRuntime,
  runtimeSource,
  type LessonRuntimeEvent,
} from "./helpers/counting-runtime";
import { isCountingNodeId } from "../lib/lesson-runtime/counting-lesson";
import { conversationProviderBody } from "./fixtures/conversation-classification";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it.each([...review.recorded, ...review.synthetic])(
  "serializes reviewed $id literally (mock provider, no calibration)",
  async entry => {
    vi.stubEnv("TYPESAFE_API_KEY", "synthetic-test-key");
    const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
      Response.json(conversationProviderBody()),
    );
    vi.stubGlobal("fetch", fetch);
    if (!isCountingNodeId(entry.input.nodeId)) throw new Error("Invalid reviewed node");
    await classifyConversationStateWithDiagnostics(
      { ...entry.input, nodeId: entry.input.nodeId },
      new AbortController().signal,
    );
    const wire = JSON.parse(fetch.mock.calls[0][1]!.body as string);
    expect(wire.state).toEqual(entry.expectedState);
    expect(wire.questions).toEqual(CONVERSATION_QUESTIONS);
  },
);
it("scopes no-success/no-total to the question, permits evidence-based reaffirmation and guards unsafe replies", () => {
  expect(SUPPORT_CLARIFICATION_INSTRUCTION).toContain("In that clarification question only");
  expect(SUPPORT_CLARIFICATION_INSTRUCTION).toContain(
    "do not supply or repeat a count, total, answer, counting method, or hint, or imply success",
  );
  expect(SUPPORT_CLARIFICATION_INSTRUCTION).toContain(
    "if their response establishes a settled correct current-scene answer",
  );
  expect(SUPPORT_CLARIFICATION_INSTRUCTION).toContain(
    "reaffirms their previous correct answer without renewed help or uncertainty",
  );
  for (const instruction of [SPROUT_LIVE_CONFIG.instructions, SUPPORT_CLARIFICATION_INSTRUCTION]) {
    expect(instruction).toMatch(/generic finished\/yes reply alone is insufficient/i);
    expect(instruction).toMatch(/renewed help, unresolved alternatives, or unfinished\/uncertain replies/i);
  }
  expect(SUPPORT_CLARIFICATION_INSTRUCTION).toContain("grants no completion authority");
  expect(SUPPORT_CLARIFICATION_INSTRUCTION).not.toContain("duck");
  expect(new TextEncoder().encode(SUPPORT_CLARIFICATION_INSTRUCTION).length).toBeLessThanOrEqual(1400);
});
it("replays recorded gates and requires fresh acknowledgment, drain and matching render after reaffirmation", () => {
  let state = createLessonRuntime("recovery", { quietDrainMs: 250 });
  const send = (event: LessonRuntimeEvent) => {
    const r = reduceLessonRuntime(state, event);
    state = r.state;
    return r.effects;
  };
  const child = (revision: number) => {
    send({ type: "child.turn.started", source: runtimeSource(state), atMs: state.nowMs + 1 });
    send({
      type: "transcript.updated",
      source: runtimeSource(state),
      speaker: "child",
      revision,
      atMs: state.nowMs + 1,
    });
    send({ type: "child.turn.ended", source: runtimeSource(state), atMs: state.nowMs + 1 });
  };
  const tutor = (revision: number) =>
    send({
      type: "transcript.updated",
      source: runtimeSource(state),
      speaker: "tutor",
      revision,
      atMs: state.nowMs + 1,
    });
  const observe = (entry: (typeof review.recorded)[number]) => {
    if (!isCountingNodeId(entry.input.nodeId)) throw new Error("Invalid reviewed node");
    const decision = mapConversationClassification(
      { ...entry.input, nodeId: entry.input.nodeId },
      entry.observedMapping.probabilities,
    );
    expect(decision.status).toBe(entry.observedMapping.decision);
    if (decision.status === "abstained")
      expect(decision.reason).toBe("reason" in entry.observedMapping ? entry.observedMapping.reason : undefined);
    else
      send({
        type: "proposal.received",
        source: classificationSource(state)!,
        proposal: decision.proposal,
        atMs: state.nowMs + 1,
      });
  };
  const output = (activity: "active" | "quiet") =>
    send({ type: "output.activity", source: runtimeSource(state), state: activity, atMs: state.nowMs + 1 });
  const tick = (ms: number) => send({ type: "clock.tick", source: runtimeSource(state), atMs: state.nowMs + ms });
  child(36);
  tutor(37);
  observe(review.recorded[0]);
  output("active");
  output("quiet");
  tick(250);
  tutor(47);
  observe(review.recorded[1]);
  const stale = classificationSource(state)!;
  child(51);
  observe(review.recorded[2]);
  expect(state).toMatchObject({ answerAccepted: true, acknowledgmentObserved: false, phase: "active" });
  for (const revision of [52, 53, 54, 55]) {
    tutor(revision);
    expect(state).toMatchObject({ answerAccepted: false, acknowledgmentObserved: false });
  }
  observe(review.recorded[3]);
  output("active");
  output("quiet");
  expect(tick(250)).toEqual([]);
  expect(state.pendingRender).toBeNull();
  const success = {
    nodeId: state.nodeId,
    transcriptRevision: state.transcriptRevision,
    childActivity: "unknown",
    answerOutcome: "correct",
    supportState: "none",
    tutorState: "acknowledging",
  } as const;
  expect(
    send({
      type: "proposal.received",
      source: stale,
      proposal: { ...success, transcriptRevision: stale.transcriptRevision },
      atMs: state.nowMs + 1,
    }),
  ).toEqual([]);
  expect(state.answerAccepted).toBe(false);
  // Counterfactual explicit confirmation: supplied observation, not a model interpretation.
  output("active");
  tutor(56);
  send({
    type: "proposal.received",
    source: classificationSource(state)!,
    proposal: { ...success, transcriptRevision: 56 },
    atMs: state.nowMs + 1,
  });
  expect(state.phase).toBe("active");
  output("quiet");
  expect(tick(249)).toEqual([]);
  expect(tick(1)).toMatchObject([{ type: "render.requested", identity: { nodeId: "count-2-ducks" } }]);
  const identity = state.pendingRender!.identity;
  expect(
    send({
      type: "render.confirmed",
      runtimeId: state.runtimeId,
      identity: { ...identity, token: "stale" },
      atMs: state.nowMs + 1,
    }),
  ).toEqual([]);
  expect(send({ type: "render.confirmed", runtimeId: state.runtimeId, identity, atMs: state.nowMs + 1 })).toMatchObject(
    [{ type: "steering.ready", context: { nodeId: "count-2-ducks" } }],
  );
});
it("delivers equivalent settlement forms without treating tutor offers or fillers as unresolved help", () => {
  const support = CONVERSATION_QUESTIONS.needsHelp;
  expect(support.instructions).toContain(
    "Settlement can be expressed by a corrected total, a completed count, or explicitly finishing and reaffirming a previous correct total",
  );
  expect(support.instructions).toContain("none requires a special phrase");
  expect(support.instructions).toContain(
    "Fillers such as uh do not by themselves make an otherwise settled answer unfinished",
  );
  expect(support.instructions).toContain(
    "A tutor offering help or asking whether the child is finished is not a child help request",
  );
  expect(support.criteria.false).toContain(
    "a later settled successful child answer with no continuing difficulty or renewed request",
  );
  expect(support.criteria.true).toContain(
    "A renewed help request remains current even after an earlier correct answer",
  );
  expect(support.criteria.true).toContain(
    "continued uncertainty, unresolved alternatives, or an explicit need for help",
  );
  expect(support.criteria.false).toContain("not independent mastery");
});
it.each(candidate.results)("preserves real candidate mapping for $id offline (no new semantic evaluation)", entry => {
  if (!isCountingNodeId(entry.input.nodeId)) throw new Error("Invalid reviewed node");
  const decision = mapConversationClassification(
    { ...entry.input, nodeId: entry.input.nodeId },
    entry.diagnostic.probabilities,
  );
  expect(decision.status).toBe(entry.diagnostic.decision);
  if (decision.status === "accepted") expect(decision.proposal).toEqual(entry.proposal);
  else expect(decision.reason).toBe("reason" in entry.diagnostic ? entry.diagnostic.reason : undefined);
});
it.each(["latest-finished-uh-one", "help-then-settled", "renewed-help"])(
  "requires current tutor authority and drained audio for real %s observation",
  id => {
    const entry = candidate.results.find(result => result.id === id)!;
    expect(entry.proposal).not.toBeNull();
    let state = createLessonRuntime("candidate-recovery", { quietDrainMs: 250 });
    const send = (event: LessonRuntimeEvent) => {
      const result = reduceLessonRuntime(state, event);
      state = result.state;
      return result.effects;
    };
    send({ type: "child.turn.started", source: runtimeSource(state), atMs: 1 });
    send({ type: "transcript.updated", source: runtimeSource(state), speaker: "child", revision: 1, atMs: 2 });
    send({ type: "child.turn.ended", source: runtimeSource(state), atMs: 3 });
    // Even the real success-shaped scores cannot make an old tutor acknowledgment fresh on a child source.
    send({
      type: "proposal.received",
      source: classificationSource(state)!,
      proposal: { ...entry.proposal, transcriptRevision: 1 },
      atMs: 4,
    });
    expect(state.acknowledgmentObserved).toBe(false);
    send({ type: "output.activity", source: runtimeSource(state), state: "active", atMs: 5 });
    send({ type: "transcript.updated", source: runtimeSource(state), speaker: "tutor", revision: 2, atMs: 6 });
    send({
      type: "proposal.received",
      source: classificationSource(state)!,
      proposal: { ...entry.proposal, transcriptRevision: 2 },
      atMs: 7,
    });
    expect(state.phase).toBe("active");
    send({ type: "output.activity", source: runtimeSource(state), state: "quiet", atMs: 8 });
    expect(send({ type: "clock.tick", source: runtimeSource(state), atMs: 257 })).toEqual([]);
    const effects = send({ type: "clock.tick", source: runtimeSource(state), atMs: 258 });
    if (id === "renewed-help") {
      expect(effects).toEqual([]);
      expect(state).toMatchObject({
        answerAccepted: false,
        acknowledgmentObserved: false,
        pendingRender: null,
        phase: "active",
      });
    } else {
      expect(effects).toMatchObject([{ type: "render.requested", identity: { nodeId: "count-2-ducks" } }]);
      expect(
        send({
          type: "render.confirmed",
          runtimeId: state.runtimeId,
          identity: state.pendingRender!.identity,
          atMs: 259,
        }),
      ).toMatchObject([{ type: "steering.ready", context: { nodeId: "count-2-ducks" } }]);
    }
  },
);
