import { afterEach, expect, it, vi } from "vitest";
import { CountingProposals, OUTCOME_TOOL } from "../lib/experiments/grok-counting/proposals";
import { ACK_DEADLINE_MS, type AckInput, type AckDecision } from "../lib/experiments/grok-counting/acknowledgment";
import { feedbackProblem } from "../lib/experiments/grok-counting/feedback";
import { CATCHING_UNICORNS_LESSON } from "../lib/lesson-runtime/catching-unicorns-lesson";
import { COUNTING_LESSON } from "../lib/lesson-runtime/counting-lesson";
import {
  createLessonRuntime,
  reduceLessonRuntime,
  classificationSource,
  type LessonRuntimeEvent,
} from "../lib/lesson-runtime/lesson-runtime-reducer";
afterEach(() => vi.useRealTimers());
function fixture(
  mode: "grok-only" | "grok-jev" = "grok-jev",
  nodeId = "count-1-duck",
  learner = "One",
  outcome = "correct",
  support = "none",
) {
  vi.useFakeTimers();
  const requests: {
    input: AckInput;
    signal: AbortSignal;
    resolve: (result: AckDecision) => void;
    reject: () => void;
  }[] = [];
  const classify = vi.fn(
    (input: AckInput, signal: AbortSignal) =>
      new Promise<AckDecision>((resolve, reject) =>
        requests.push({ input, signal, resolve, reject: () => reject(new Error("provider unavailable")) }),
      ),
  );
  const a = new CountingProposals(crypto.randomUUID(), mode, classify);
  a.state = { ...a.state, nodeId };
  const token = JSON.parse(a.issueContext()!).context_token;
  a.acknowledgeContext();
  a.speechStarted("u");
  a.speechStopped("u");
  a.transcript({ id: "u", speaker: "Learner", text: learner, final: true });
  a.responseCreated("r");
  a.call({
    call_id: "c",
    response_id: "r",
    name: OUTCOME_TOOL.name,
    arguments: JSON.stringify({
      context_token: token,
      answer_outcome: outcome,
      support_state: support,
      supporting_text: learner,
    }),
  });
  const tutor = (text = "One duck. You got it!", id = "t") => {
    a.spoken("r");
    a.transcript({ id, speaker: "Tutor", text, final: true }, "r");
    a.tick();
  };
  const audio = (id = "t") => a.output(true, id);
  const drain = (id = "t") => {
    a.output(false);
    a.playbackDrained(a.playbackIdentity(id));
    a.tick();
  };
  const quiet = () => {
    vi.advanceTimersByTime(260);
    a.tick();
  };
  const result = async (reason: "confirmed" | "low-confidence" = "confirmed", index = 0) => {
    requests[index].resolve({
      requestId: requests[index].input.requestId,
      outcome: reason === "confirmed" ? "acknowledging" : "abstain",
      reason,
      modelValidated: true,
    });
    await vi.advanceTimersByTimeAsync(0);
  };
  return { a, tutor, audio, drain, quiet, result, requests, classify };
}
it.each(["grok-only", "grok-jev"] as const)(
  "latest scene 1 advances from learner One and natural feedback in %s",
  mode => {
    const f = fixture(mode);
    f.tutor();
    f.audio();
    f.a.responseDone("r", "completed");
    f.a.tick();
    f.quiet();
    expect(f.a.state.phase).toBe("active");
    f.drain();
    f.quiet();
    expect(f.a.state.phase).toBe("rendering");
    expect(f.a.state.acknowledgmentObserved).toBe(false);
    const render = f.a.state.pendingRender!.identity;
    expect(f.a.confirmRender({ ...render, token: "wrong" })).toBe(false);
    expect(f.a.confirmRender(render)).toBe(true);
    expect(f.a.state.nodeId).toBe("count-2-ducks");
    expect(f.a.confirmRender(render)).toBe(false);
  },
);
it.each(["confirmed", "low-confidence", "timeout", "provider-error"] as const)(
  "latest scene 2 advances after Two ducks regardless of Jev %s",
  async outcome => {
    const f = fixture("grok-jev", "count-2-ducks", "Two");
    f.tutor("Two ducks.");
    f.audio();
    f.a.responseDone("r", "completed");
    const before = f.a.state;
    if (outcome === "timeout") await vi.advanceTimersByTimeAsync(ACK_DEADLINE_MS);
    else if (outcome === "provider-error") {
      f.requests[0].reject();
      await vi.advanceTimersByTimeAsync(0);
    } else await f.result(outcome);
    expect(f.a.state).toBe(before); // Diagnostic completion cannot dispatch even a clock tick.
    expect(f.a.recoveryReason).toBeUndefined();
    f.drain();
    f.quiet();
    expect(f.a.state.pendingRender?.identity.nodeId).toBe("count-3-butterflies");
    expect(f.a.decisionTimeline.some(e => e.type === "recovery.requested")).toBe(false);
  },
);
it("does not await Jev, and late results after transition cannot mutate state", async () => {
  const f = fixture();
  f.tutor();
  f.audio();
  f.a.responseDone("r", "completed");
  f.drain();
  f.quiet();
  expect(f.requests[0].signal.aborted).toBe(true);
  f.a.confirmRender(f.a.state.pendingRender!.identity);
  const state = f.a.state;
  await f.result();
  expect(f.a.state).toBe(state);
  expect(f.a.decisionTimeline.some(e => e.type === "classification.stale")).toBe(true);
});
it.each(["Great job!", "Two ducks.", "That's right, two ducks! Great counting!"])(
  "permits non-contradictory delivered feedback without acknowledgment semantics: %s",
  text => {
    const f = fixture("grok-only", "count-2-ducks", "Two");
    f.tutor(text);
    f.audio();
    f.a.responseDone("r", "completed");
    f.drain();
    f.quiet();
    expect(f.a.state.pendingRender?.identity.nodeId).toBe("count-3-butterflies");
  },
);
it.each(["No, that's wrong.", "Actually, there are three ducks.", "Yes, three ducks.", "Two butterflies."])(
  "withholds contradictory feedback and bounds recovery: %s",
  text => {
    const f = fixture("grok-only", "count-2-ducks", "Two");
    f.tutor(text);
    f.audio();
    f.a.responseDone("r", "completed");
    f.drain();
    f.quiet();
    expect(f.a.state.phase).toBe("active");
    expect(f.a.learnerAnswerAccepted).toBe(true);
    expect(f.a.recoveryReason).toBe("contradictory-feedback");
    expect(f.a.takeRecovery()).toBe("contradictory-feedback");
    expect(f.a.takeRecovery()).toBeUndefined();
    f.a.responseCreated("retry");
    f.a.spoken("retry");
    f.a.transcript({ id: "retry-t", speaker: "Tutor", text, final: true }, "retry");
    f.a.output(true, "retry-t");
    f.a.responseDone("retry", "completed");
    f.a.output(false);
    f.a.playbackDrained(f.a.playbackIdentity("retry-t"));
    f.a.tick();
    expect(f.a.takeRecovery()).toBeUndefined();
    expect(f.a.recoveryExhausted).toBe(true);
  },
);
it.each(["tool-only", "no audio", "never drained", "cleared audio"])("withholds progression for %s", kind => {
  const f = fixture();
  if (kind !== "tool-only") f.tutor();
  if (kind === "never drained" || kind === "cleared audio") f.audio();
  f.a.responseDone("r", "completed");
  if (kind === "cleared audio") f.a.output(false);
  f.a.tick();
  f.quiet();
  expect(f.a.state.phase).toBe("active");
  expect(f.a.state.feedbackDelivered).toBeNull();
  if (kind === "tool-only") expect(f.a.takeContinuation()).toBe("accepted");
  if (kind === "no audio") expect(f.a.recoveryReason).toBe("missing-feedback-audio");
});
it.each(["correction", "interrupt", "cancel", "supersede", "rejected report"])(
  "invalidates progression on %s",
  action => {
    const f = fixture();
    f.tutor();
    f.audio();
    if (action === "correction") f.a.transcript({ id: "u", speaker: "Learner", text: "Two", final: true });
    if (action === "interrupt") f.a.speechStarted("new");
    if (action === "cancel") f.a.responseDone("r", "cancelled");
    if (action === "supersede") f.a.responseCreated("new-r");
    if (action === "rejected report") f.a.call({ call_id: "bad", response_id: "r", name: "unknown", arguments: "{}" });
    f.a.responseDone("r", "completed");
    f.drain();
    f.quiet();
    expect(f.a.state.phase).toBe("active");
    expect(f.a.learnerAnswerAccepted).toBe(false);
    expect(f.a.state.answerAccepted).toBe(false);
  },
);
it("requires a fresh natural drain after resumed audio", () => {
  const f = fixture();
  f.tutor();
  f.audio();
  f.a.responseDone("r", "completed");
  f.drain();
  expect(f.a.state.feedbackDelivered).toBeTruthy();
  f.audio();
  f.a.output(false);
  f.quiet();
  expect(f.a.state.phase).toBe("active");
  f.drain();
  f.quiet();
  expect(f.a.state.phase).toBe("rendering");
});
it("revised contradictory tutor final invalidates the previous completion before quiet ends", () => {
  const f = fixture();
  f.tutor();
  f.audio();
  f.a.responseDone("r", "completed");
  f.drain();
  f.tutor("No, that's wrong.");
  f.quiet();
  expect(f.a.state.phase).toBe("active");
  expect(f.a.state.feedbackDelivered).toBeNull();
});
it.each([
  ["Two ducks.", "incorrect", "none"],
  ["I don't know.", "none", "needs_help"],
])("does not advance a non-success learner outcome %s despite praise", (learner, outcome, support) => {
  const f = fixture("grok-jev", "count-1-duck", learner, outcome, support);
  f.tutor("One duck. You got it!");
  f.audio();
  f.a.responseDone("r", "completed");
  f.drain();
  f.quiet();
  expect(f.a.state.phase).toBe("active");
  expect(f.a.learnerAnswerAccepted).toBe(false);
  expect(f.classify).not.toHaveBeenCalled();
});
it("stale tutor and audio after a scene change cannot create new completion", () => {
  const f = fixture();
  f.tutor();
  f.audio();
  const old = f.a.playbackIdentity("t");
  f.a.responseDone("r", "completed");
  f.drain();
  f.quiet();
  f.a.confirmRender(f.a.state.pendingRender!.identity);
  const state = f.a.state;
  f.a.transcript({ id: "old", speaker: "Tutor", text: "Yes, two ducks.", final: true }, "r");
  f.a.playbackDrained(old);
  expect(f.a.state).toBe(state);
  expect(f.a.state.feedbackDelivered).toBeNull();
});
it("the default counting reducer still requires semantic acknowledgment and ignores feedback events", () => {
  const f = fixture("grok-only");
  f.tutor();
  f.audio();
  f.a.output(false);
  const { feedbackPolicy: optInPolicy, feedbackDelivered: optInDelivery, ...state } = f.a.state;
  expect(optInPolicy).toBe("validated-answer");
  expect(optInDelivery).toBeNull();
  expect(state.answerAccepted).toBe(true);
  expect(state.tutorOutputObserved).toBe(true);
  const result = reduceLessonRuntime(
    state,
    {
      type: "tutor.feedback.completed",
      atMs: state.nowMs + 1,
      source: classificationSource(state)!,
      learnerRevision: state.acceptedAnswerRevision!,
      response: 1,
      item: 1,
    },
    COUNTING_LESSON,
  );
  expect(result.state).toBe(state);
  expect(result.state.feedbackPolicy).toBeUndefined();
  expect(result.state.acknowledgmentObserved).toBe(false);
});
it.each(["scope", "transcript", "learner", "response", "item"])("reducer rejects mismatched feedback %s", mismatch => {
  const f = fixture("grok-only");
  f.tutor();
  f.audio();
  f.a.output(false);
  const state = f.a.state;
  const source = classificationSource(state)!;
  const event: LessonRuntimeEvent = {
    type: "tutor.feedback.completed",
    atMs: state.nowMs + 1,
    source: {
      ...source,
      ...(mismatch === "scope" ? { nodeId: "count-2-ducks" } : {}),
      ...(mismatch === "transcript" ? { transcriptRevision: source.transcriptRevision + 1 } : {}),
    },
    learnerRevision: state.acceptedAnswerRevision! + (mismatch === "learner" ? 1 : 0),
    response: mismatch === "response" ? 0 : 1,
    item: mismatch === "item" ? 0 : 1,
  };
  expect(reduceLessonRuntime(state, event, COUNTING_LESSON).state).toBe(state);
});

it.each(["", "[silence]", "..."])("treats absent finalized feedback as missing: %s", text =>
  expect(feedbackProblem(text, { quantity: 2, object: "duck" })).toBe("missing-feedback"),
);

it("cannot opt Catching Unicorns into counting feedback progression", () => {
  expect(() =>
    createLessonRuntime("other", {
      lesson: CATCHING_UNICORNS_LESSON,
      feedbackPolicy: "validated-answer",
    }),
  ).toThrow();
});
