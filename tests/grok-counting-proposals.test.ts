import { expect, it } from "vitest";
import { CountingProposals, OUTCOME_TOOL } from "../lib/experiments/grok-counting/proposals";

function fixture(text = "One duck.", tutor = "How many ducks do you see?", nodeId = "count-1-duck") {
  const adapter = new CountingProposals();
  adapter.state = { ...adapter.state, nodeId };
  adapter.transcript({ id: "a0", speaker: "Tutor", text: tutor, final: true });
  const context = adapter.issueContext()!;
  const token = JSON.parse(context).context_token;
  adapter.acknowledgeContext();
  adapter.speechStarted("u1");
  adapter.speechStopped("u1");
  adapter.transcript({ id: "u1", speaker: "Learner", text, final: true });
  adapter.responseCreated("r1");
  const args = { context_token: token, answer_outcome: "correct", support_state: "none", supporting_text: text };
  const call = (changes = {}, envelope = {}) => {
    adapter.call({
      call_id: "c1",
      name: OUTCOME_TOOL.name,
      response_id: "r1",
      arguments: JSON.stringify({ ...args, ...changes }),
      ...envelope,
    });
    return adapter.drainResults().at(-1);
  };
  return { adapter, call, args };
}
it.each(["One duck.", "one", "1", "I see one duck.", "There is one duck!"])(
  "accepts a grounded settled answer: %s",
  text => {
    const { adapter, call } = fixture(text);
    expect(call()?.status).toBe("accepted");
    adapter.responseDone("r1", "completed");
    expect(adapter.state).toMatchObject({
      answerAccepted: true,
      acknowledgmentObserved: false,
      nodeId: "count-1-duck",
      visitId: 1,
      transitionReady: false,
      conceptEvidence: {},
    });
  },
);
it.each([
  "Yes.",
  "Okay",
  "One?",
  "One or two",
  "One duck, help please",
  "Stop",
  "Move on",
  "One duck, next please",
  "One dog",
  "",
  "I think one",
  "Two ducks",
])("does not let a schema-valid correct judgment establish success: %s", text => {
  const { adapter, call } = fixture(text);
  expect(call()?.status).toBe("rejected");
  expect(adapter.state.answerAccepted).toBe(false);
});
it("rejects repetition of an answer supplied by the tutor", () => {
  const { adapter, call } = fixture("One duck.", "Say one duck.");
  expect(call()?.reason).toBe("unsupported settled answer");
  expect(adapter.state.answerAccepted).toBe(false);
});
it.each([
  ["Two ducks.", "incorrect", "none"],
  ["I like ducks", "none", "none"],
  ["One or two?", "unclear", "none"],
  ["I need help", "none", "needs_help"],
  ["I don't know", "unclear", "needs_help"],
])("maps %s without awarding success", (text, answer_outcome, support_state) => {
  const { adapter, call } = fixture(text);
  expect(call({ answer_outcome, support_state })?.status).toBe("accepted");
  expect(adapter.state).toMatchObject({ answerAccepted: false, acknowledgmentObserved: false });
});
it.each([
  { supporting_text: "one" },
  { supporting_text: "Yes, one duck." },
  { nodeId: "count-2-ducks" },
  { answer_outcome: "mastered" },
  { support_state: "resolved" },
  { support_state: "needs_help" },
  { context_token: "invented" },
])("rejects mismatched evidence, extra fields and unsupported judgments: %j", changes => {
  const { call, adapter } = fixture();
  expect(call(changes)?.status).toBe("rejected");
  expect(adapter.state.answerAccepted).toBe(false);
});
it.each(["{", "null", "[]", "{}", "1", '"text"', " ".repeat(4097)])(
  "rejects malformed argument payloads",
  argumentsValue => {
    const { call } = fixture();
    expect(call({}, { arguments: argumentsValue })?.reason).toBe("malformed arguments");
  },
);
it("consumes invalid and valid call IDs once, including unknown tools", () => {
  const { call, adapter } = fixture();
  expect(call({}, { name: "advance_scene" })?.reason).toBe("unknown tool");
  expect(call()).toBeUndefined();
  expect(adapter.state.answerAccepted).toBe(false);
  expect(call({}, { call_id: "c2" })?.status).toBe("rejected");
  expect(call({}, { call_id: "c2" })).toBeUndefined();
  expect(call({}, { call_id: "c3" })?.status).toBe("rejected");
});
it.each(["runtimeId", "visitId", "childTurnId", "nodeId"] as const)("rejects stale application identity %s", key => {
  const { adapter, call } = fixture();
  adapter.state = {
    ...adapter.state,
    [key]: typeof adapter.state[key] === "number" ? Number(adapter.state[key]) + 1 : "other",
  };
  expect(call()?.status).toBe("rejected");
});
it("invalidates corrected transcripts without relabeling an old token", () => {
  const { adapter, call } = fixture();
  call();
  adapter.transcript({ id: "u1", speaker: "Learner", text: "Two ducks.", final: true });
  adapter.responseDone("r1", "completed");
  expect(adapter.state.answerAccepted).toBe(false);
  expect(adapter.learnerAnswerAccepted).toBe(false);
  expect(call({}, { call_id: "c2" })?.status).toBe("rejected");
});
it("issues context before a turn, and never retrofits context during an active response", () => {
  const a = new CountingProposals();
  expect(a.issueContext()).toBeDefined();
  a.acknowledgeContext();
  a.speechStarted("u");
  a.responseCreated("r");
  a.transcript({ id: "u", speaker: "Learner", text: "one", final: true });
  expect(a.issueContext()).toBeUndefined();
  a.speechStopped("u");
  expect(a.issueContext()).toBeUndefined();
});
it("rejects old learner items and repeated speech starts across turns", () => {
  const { adapter, call } = fixture();
  adapter.speechStarted("u2");
  adapter.speechStarted("u1");
  adapter.speechStopped("u2");
  adapter.transcript({ id: "u1", speaker: "Learner", text: "One duck.", final: true });
  adapter.responseCreated("r2");
  expect(adapter.issueContext()).toBeUndefined();
  expect(call()?.status).toBe("rejected");
});
it.each([undefined, "old"])("rejects unbound response identity %s", response_id => {
  expect(fixture().call({}, { response_id })?.status).toBe("rejected");
});
it("rejects out-of-order calls after response completion or cancellation", () => {
  for (const status of ["completed", "cancelled", "failed"]) {
    const { adapter, call } = fixture();
    adapter.responseDone("r1", status);
    expect(call()?.status).toBe("rejected");
    expect(adapter.takeContinuation()).toBeUndefined();
  }
});
it("ignores late callbacks after stop and rejects tokens from a prior connection", () => {
  const old = fixture();
  old.adapter.stop();
  expect(old.call()).toBeUndefined();
  old.adapter.speechStarted("late");
  old.adapter.responseCreated("late");
  expect(old.adapter.state.phase).toBe("stopped");
  const fresh = fixture();
  expect(fresh.call({ context_token: old.args.context_token })?.status).toBe("rejected");
});
it("continues a tool-only response exactly once after completed, never on cancellation or spoken feedback", () => {
  const { adapter, call } = fixture();
  call();
  expect(adapter.takeContinuation()).toBeUndefined();
  adapter.responseDone("r1", "completed");
  expect(adapter.takeContinuation()).toBe("accepted");
  expect(adapter.takeContinuation()).toBeUndefined();
  for (const fault of ["spoken", "cancelled", "new turn"]) {
    const f = fixture();
    f.call();
    if (fault === "spoken") f.adapter.spoken("r1");
    if (fault === "new turn") f.adapter.speechStarted("u2");
    f.adapter.responseDone("r1", fault === "cancelled" ? "cancelled" : "completed");
    expect(f.adapter.takeContinuation()).toBeUndefined();
  }
});
it("bounds calls per connection and cannot award an answer without a call", () => {
  const { adapter, call } = fixture();
  expect(adapter.state.answerAccepted).toBe(false);
  for (let i = 0; i < 256; i++) call({}, { call_id: `bad-${i}`, name: "other" });
  expect(call()).toBeUndefined();
  expect(adapter.lastResult).toContain("limit reached");
  expect(adapter.state.answerAccepted).toBe(false);
});

it("does not deliver a validated answer from a subsequently cancelled response", () => {
  const { adapter, call } = fixture();
  expect(call()?.status).toBe("accepted");
  expect(adapter.state.answerAccepted).toBe(false);
  adapter.responseDone("r1", "cancelled");
  expect(adapter.state.answerAccepted).toBe(false);
});

it.each(["before", "after"])(
  "preserves a reducer-validated learner observation through tutor speech %s response completion",
  timing => {
    const { adapter, call } = fixture();
    call();
    if (timing === "after") adapter.responseDone("r1", "completed");
    adapter.transcript({ id: "a1", speaker: "Tutor", text: "Yes, one duck.", final: true });
    if (timing === "before") adapter.responseDone("r1", "completed");
    expect(adapter.learnerAnswerAccepted).toBe(true);
    expect(adapter.state).toMatchObject({
      answerAccepted: false,
      acknowledgmentObserved: false,
      transitionReady: false,
    });
    adapter.responseCreated("continuation");
    adapter.transcript({ id: "a2", speaker: "Tutor", text: "Great work!", final: false });
    adapter.transcript({ id: "a2", speaker: "Tutor", text: "Great work!", final: true });
    expect(adapter.learnerAnswerAccepted).toBe(true);
    adapter.speechStarted("u2");
    expect(adapter.learnerAnswerAccepted).toBe(false);
  },
);
it.each(["runtimeId", "nodeId", "visitId", "childTurnId"] as const)(
  "invalidates diagnostic observation when %s changes",
  key => {
    const { adapter, call } = fixture();
    call();
    adapter.responseDone("r1", "completed");
    adapter.state = {
      ...adapter.state,
      [key]: typeof adapter.state[key] === "number" ? Number(adapter.state[key]) + 1 : "other",
    };
    expect(adapter.learnerAnswerAccepted).toBe(false);
  },
);
function early() {
  const adapter = new CountingProposals();
  const token = JSON.parse(adapter.issueContext()!).context_token;
  adapter.acknowledgeContext();
  adapter.speechStarted("u");
  adapter.speechStopped("u");
  adapter.responseCreated("r");
  const event = {
    name: OUTCOME_TOOL.name,
    call_id: "c",
    response_id: "r",
    arguments: JSON.stringify({
      context_token: token,
      answer_outcome: "correct",
      support_state: "none",
      supporting_text: "One duck.",
    }),
  };
  return { adapter, event };
}
it.each(["before done", "after done"])("grounds an early call against delayed final transcription %s", timing => {
  const { adapter, event } = early();
  adapter.call(event);
  expect(adapter.hasPending).toBe(true);
  expect(adapter.drainResults()).toEqual([]);
  if (timing === "after done") adapter.responseDone("r", "completed");
  expect(adapter.takeContinuation()).toBeUndefined();
  adapter.transcript({ id: "u", speaker: "Learner", text: "one", final: false });
  adapter.transcript({ id: "u", speaker: "Learner", text: "One duck.", final: true });
  expect(adapter.drainResults()[0].status).toBe("accepted");
  if (timing === "before done") adapter.responseDone("r", "completed");
  expect(adapter.learnerAnswerAccepted).toBe(true);
  expect(adapter.takeContinuation()).toBe("accepted");
});
it("rejects absent final transcription at the bounded deadline and cannot later accept the same call", () => {
  const { adapter, event } = early();
  adapter.call(event);
  adapter.responseDone("r", "completed");
  adapter.expirePending();
  expect(adapter.drainResults()[0].status).toBe("rejected");
  expect(adapter.takeContinuation()).toBe("recovery");
  adapter.transcript({ id: "u", speaker: "Learner", text: "One duck.", final: true });
  adapter.call(event);
  expect(adapter.learnerAnswerAccepted).toBe(false);
});
it("rejects fabricated early evidence against the eventual transcript", () => {
  const { adapter, event } = early();
  adapter.call(event);
  adapter.transcript({ id: "u", speaker: "Learner", text: "Two ducks.", final: true });
  expect(adapter.drainResults()[0].reason).toBe("unmatched learner evidence");
});
it("requires the ahead-of-turn configuration acknowledgment and never rebinds a late acknowledgment", () => {
  const a = new CountingProposals();
  const token = JSON.parse(a.issueContext()!).context_token;
  a.speechStarted("u");
  a.acknowledgeContext();
  a.speechStopped("u");
  a.responseCreated("r");
  a.transcript({ id: "u", speaker: "Learner", text: "One duck.", final: true });
  a.call({
    call_id: "c",
    name: OUTCOME_TOOL.name,
    response_id: "r",
    arguments: JSON.stringify({
      context_token: token,
      supporting_text: "One duck.",
      answer_outcome: "correct",
      support_state: "none",
    }),
  });
  expect(a.drainResults()[0].status).toBe("rejected");
});
it("recovers a rejected tool-only response once and does not loop if recovery calls tools again", () => {
  const { adapter, call } = fixture();
  call({}, { name: "wrong" });
  adapter.responseDone("r1", "completed");
  expect(adapter.takeContinuation()).toBe("recovery");
  expect(adapter.takeContinuation()).toBeUndefined();
  adapter.responseCreated("recovery");
  call({}, { call_id: "c2", response_id: "recovery" });
  adapter.responseDone("recovery", "completed");
  expect(adapter.takeContinuation()).toBeUndefined();
  expect(adapter.learnerAnswerAccepted).toBe(false);
});
it("never recovers an already spoken rejection, interrupted response or a no-call response", () => {
  for (const fault of ["spoken", "interrupted", "missing call"]) {
    const { adapter, call } = fixture();
    if (fault !== "missing call") call({}, { name: "wrong" });
    if (fault === "spoken") adapter.spoken("r1");
    if (fault === "interrupted") adapter.speechStarted("u2");
    adapter.responseDone("r1", "completed");
    expect(adapter.takeContinuation()).toBeUndefined();
  }
});
it("revokes a retained observation on a later final learner correction and cannot restore it from tutor text", () => {
  const { adapter, call } = fixture();
  call();
  adapter.responseDone("r1", "completed");
  expect(adapter.learnerAnswerAccepted).toBe(true);
  adapter.transcript({ id: "u1", speaker: "Learner", text: "Two ducks.", final: true });
  adapter.transcript({ id: "a2", speaker: "Tutor", text: "Try again", final: true });
  expect(adapter.learnerAnswerAccepted).toBe(false);
  expect(adapter.state.answerAccepted).toBe(false);
});
it("cannot stamp a response created before learner speech with the new turn identity", () => {
  const adapter = new CountingProposals();
  const token = JSON.parse(adapter.issueContext()!).context_token;
  adapter.acknowledgeContext();
  adapter.responseCreated("old");
  adapter.speechStarted("u");
  adapter.speechStopped("u");
  adapter.transcript({ id: "u", speaker: "Learner", text: "One duck.", final: true });
  adapter.call({
    call_id: "c",
    name: OUTCOME_TOOL.name,
    response_id: "old",
    arguments: JSON.stringify({
      context_token: token,
      supporting_text: "One duck.",
      answer_outcome: "correct",
      support_state: "none",
    }),
  });
  expect(adapter.drainResults()[0].status).toBe("rejected");
  expect(adapter.learnerAnswerAccepted).toBe(false);
});
it("orders delayed learner text at its speech boundary rather than treating subsequent tutor words as an earlier answer cue", () => {
  const { adapter, event } = early();
  adapter.call(event);
  adapter.spoken("r");
  adapter.transcript({ id: "a", speaker: "Tutor", text: "Yes, one duck.", final: true });
  adapter.responseDone("r", "completed");
  adapter.transcript({ id: "u", speaker: "Learner", text: "One duck.", final: true });
  expect(adapter.drainResults()[0].status).toBe("accepted");
  expect(adapter.learnerAnswerAccepted).toBe(true);
  expect(adapter.state.acknowledgmentObserved).toBe(false);
  expect(adapter.takeContinuation()).toBeUndefined();
});
it("does not bind a response created before VAD stop to the eventual finalized turn", () => {
  const adapter = new CountingProposals();
  const token = JSON.parse(adapter.issueContext()!).context_token;
  adapter.acknowledgeContext();
  adapter.speechStarted("u");
  adapter.responseCreated("too-early");
  adapter.speechStopped("u");
  adapter.transcript({ id: "u", speaker: "Learner", text: "One duck.", final: true });
  adapter.call({
    call_id: "c",
    name: OUTCOME_TOOL.name,
    response_id: "too-early",
    arguments: JSON.stringify({
      context_token: token,
      supporting_text: "One duck.",
      answer_outcome: "correct",
      support_state: "none",
    }),
  });
  expect(adapter.drainResults()[0].status).toBe("rejected");
  expect(adapter.learnerAnswerAccepted).toBe(false);
});

it.each([
  "Hello, friend! I see a duck on the screen. How many ducks do you see?",
  "There is a duck on the screen. How many ducks are there?",
  "Point to the duck. What do you get?",
  "Take one moment to look at the duck, then count it.",
  "Point to one duck at a time. How many ducks?",
  "Only look at the duck and count it.",
  "There is one butterfly. How many ducks do you see?",
])("allows ordinary current-scene object/method language: %s", tutor => {
  expect(fixture("One duck.", tutor).call()?.status).toBe("accepted");
});
it.each([
  "There is one duck.",
  "There is one duck swimming on the screen.",
  "Say one duck.",
  "Repeat 1 duck.",
  "The total is one.",
  "I see one duck on the screen.",
  "There is only a duck here.",
  "I see a single duck.",
  "One duck.",
  "One!",
  "Is there one duck?",
  "Maybe one duck?",
  "Could it be one?",
  "Do you see just one duck?",
])("abstains on explicit or ambiguous tutor-supplied current answers: %s", tutor => {
  expect(fixture("One duck.", tutor).call()?.status).toBe("rejected");
});
it.each([
  ["count-2-ducks", "Two ducks.", "Point to a duck. Count one duck at a time.", "accepted"],
  ["count-2-ducks", "Two ducks.", "There are two ducks.", "rejected"],
  ["count-3-butterflies", "Three butterflies.", "Look at a butterfly, then count the group.", "accepted"],
  ["count-3-butterflies", "Three butterflies.", "Maybe three butterflies?", "rejected"],
  ["count-3-butterflies", "Three butterflies.", "There are two ducks.", "accepted"],
])("scopes answer cues to authored node %s", (node, text, tutor, status) => {
  expect(fixture(text, tutor, node).call()?.status).toBe(status);
});
it.each([
  [undefined, "call.response_id.missing"],
  ["wrong", "call.response_id.mismatch"],
])("distinguishes call response identity failure %s", (response_id, code) => {
  const f = fixture();
  f.call({}, { response_id });
  expect(f.adapter.correlationDiagnostics.at(-1)?.code).toBe(code);
});
it("distinguishes a changed final transcript from a provider token mismatch", () => {
  const f = fixture();
  expect(f.call()?.status).toBe("accepted");
  f.adapter.transcript({ id: "u1", speaker: "Learner", text: "One dog.", final: true });
  f.call({}, { call_id: "after-correction" });
  expect(f.adapter.correlationDiagnostics.at(-1)?.code).toBe("transcript.final.corrected");
  const other = fixture();
  other.call({ context_token: "not-issued" });
  expect(other.adapter.correlationDiagnostics.at(-1)?.code).toBe("call.token.mismatch");
});
it("identifies response creation before VAD stop without rebinding the response later", () => {
  const a = new CountingProposals();
  const token = JSON.parse(a.issueContext()!).context_token;
  a.acknowledgeContext();
  a.speechStarted("u");
  a.responseCreated("r");
  a.speechStopped("u");
  a.transcript({ id: "u", speaker: "Learner", text: "One duck.", final: true });
  a.call({
    call_id: "c",
    name: OUTCOME_TOOL.name,
    response_id: "r",
    arguments: JSON.stringify({
      context_token: token,
      supporting_text: "One duck.",
      answer_outcome: "correct",
      support_state: "none",
    }),
  });
  expect(a.correlationDiagnostics.at(-1)?.code).toBe("response.before_turn_end");
  expect(a.drainResults()[0].status).toBe("rejected");
});
it("identifies an unacknowledged reservation and wrong learner-turn identity", () => {
  const a = new CountingProposals();
  a.issueContext();
  a.speechStarted("u");
  expect(a.correlationDiagnostics.at(-1)?.code).toBe("turn.configuration.unacknowledged");
  const f = fixture();
  f.adapter.state = { ...f.adapter.state, childTurnId: 99 };
  f.call();
  expect(f.adapter.correlationDiagnostics.at(-1)?.code).toBe("turn.identity.mismatch");
});
it("keeps diagnostic data bounded and excludes all provider IDs, tokens and transcript content", () => {
  const f = fixture("One duck.", "How many ducks?");
  f.call({ context_token: "secret-token-personal-info" }, { response_id: "private-id" });
  for (let i = 0; i < 100; i++) f.call({}, { call_id: `private-${i}`, response_id: "private-id" });
  const trace = f.adapter.correlationDiagnostics;
  expect(trace).toHaveLength(64);
  expect(JSON.stringify(trace)).not.toMatch(/One duck|How many|private|secret-token|context_token|supporting_text/);
  expect(trace.at(-1)?.sequence).toBeGreaterThan(100);
  expect(Object.keys(trace[0]).sort()).toEqual(["code", "revision", "sequence", "stage", "turn", "visit"]);
  trace[0].code = "context.issued";
  expect(f.adapter.correlationDiagnostics[0].code).not.toBe("context.issued");
});

it("does not invalidate the turn for repeated identical final transcripts", () => {
  const f = fixture();
  f.adapter.transcript({ id: "u1", speaker: "Learner", text: "One duck.", final: true });
  f.adapter.transcript({ id: "u1", speaker: "Learner", text: "One duck.", final: true });
  expect(f.call()?.status).toBe("accepted");
  expect(f.adapter.correlationDiagnostics.some(d => d.code === "transcript.final.corrected")).toBe(false);
});
it("reports missing IDs and absent/completed response scope without inferring IDs from the active connection", () => {
  const f = fixture();
  f.call({}, { call_id: undefined });
  expect(f.adapter.correlationDiagnostics.at(-1)?.code).toBe("call.id.missing");
  f.adapter.responseCreated();
  expect(f.adapter.correlationDiagnostics.at(-1)?.code).toBe("response.id.missing");
  f.adapter.responseDone("r1", "completed");
  f.call({}, { call_id: "late" });
  expect(f.adapter.correlationDiagnostics.at(-1)?.code).toBe("call.after_response_done");
  f.adapter.speechStarted("u2");
  f.call({}, { call_id: "old" });
  expect(f.adapter.correlationDiagnostics.at(-1)?.code).toBe("call.response.missing");
});
it("reuses an unused pending/acknowledged reservation across response boundaries but consumes it on speech", () => {
  const a = new CountingProposals();
  const first = a.issueContext()!;
  expect(a.hasReservedContext).toBe(true);
  expect(a.issueContext()).toBeUndefined();
  a.acknowledgeContext();
  a.responseCreated("opening");
  a.responseDone("opening", "completed");
  expect(a.issueContext()).toBeUndefined();
  expect(a.hasReservedContext).toBe(true);
  a.speechStarted("u");
  a.speechStopped("u");
  expect(a.hasReservedContext).toBe(false);
  a.transcript({ id: "u", speaker: "Learner", text: "Two ducks.", final: true });
  a.responseCreated("turn");
  a.responseDone("turn", "completed");
  const next = a.issueContext();
  expect(next).toBeDefined();
  expect(next).not.toBe(first);
  expect(a.issueContext()).toBeUndefined();
});

function settlingTurn() {
  const adapter = new CountingProposals();
  adapter.transcript({ id: "prompt", speaker: "Tutor", text: "How many ducks do you see?", final: true });
  const token = JSON.parse(adapter.issueContext()!).context_token;
  adapter.acknowledgeContext();
  adapter.speechStarted("settling-item");
  const transcript = (text: string, id = "settling-item") =>
    adapter.transcript({ id, speaker: "Learner", text, final: true });
  const event = (changes = {}, envelope = {}) => ({
    call_id: "settling-call",
    response_id: "settling-response",
    name: OUTCOME_TOOL.name,
    arguments: JSON.stringify({
      context_token: token,
      answer_outcome: "correct",
      support_state: "none",
      supporting_text: "I see one duck.",
      ...changes,
    }),
    ...envelope,
  });
  return { adapter, transcript, event };
}

it.each(["before VAD stop", "after VAD stop", "after response creation"])(
  "replaces unvalidated same-item completed evidence %s without rotating the token",
  boundary => {
    const { adapter, transcript, event } = settlingTurn();
    transcript("I see");
    if (boundary === "before VAD stop") transcript("I see one duck.");
    adapter.speechStopped("settling-item");
    if (boundary === "after VAD stop") transcript("I see one duck.");
    adapter.responseCreated("settling-response");
    if (boundary === "after response creation") transcript("I see one duck.");
    const revision = adapter.state.transcriptRevision;
    const diagnostics = adapter.correlationDiagnostics;
    transcript("I see one duck.");
    transcript("I see one duck.");
    adapter.speechStopped("settling-item"); // Duplicate boundary is also idempotent.
    expect(adapter.state.transcriptRevision).toBe(revision);
    expect(adapter.correlationDiagnostics).toEqual(diagnostics);
    adapter.call(event());
    expect(adapter.drainResults()[0].status).toBe("accepted");
    adapter.responseDone("settling-response", "completed");
    expect(adapter.learnerAnswerAccepted).toBe(true);
    expect(adapter.state.acknowledgmentObserved).toBe(false);
    expect(adapter.state.conceptEvidence).toEqual({});
    expect(adapter.issueContext()).toBeUndefined();
    const trace = JSON.stringify(adapter.correlationDiagnostics);
    expect(trace).toContain(
      boundary === "before VAD stop" ? "transcript.provisional.replaced" : "transcript.settled.replaced",
    );
    expect(trace).not.toMatch(/I see|settling-item|settling-response|context_token|supporting_text/);
  },
);

it("settles a complete pre-stop transcript on matching VAD stop without a timer or a repeated final", () => {
  const { adapter, transcript, event } = settlingTurn();
  transcript("I see one duck.");
  expect(adapter.learnerAnswerAccepted).toBe(false);
  adapter.speechStopped("wrong-item");
  expect(adapter.state.childSpeaking).toBe(true);
  adapter.speechStopped("settling-item");
  adapter.responseCreated("settling-response");
  adapter.call(event());
  expect(adapter.drainResults()[0].status).toBe("accepted");
});

it("never lets provisional text retrofit a response created before VAD stop", () => {
  const { adapter, transcript, event } = settlingTurn();
  transcript("I see one duck.");
  adapter.responseCreated("settling-response");
  adapter.speechStopped("settling-item");
  transcript("I see one duck.");
  adapter.call(event());
  expect(adapter.drainResults()[0].status).toBe("rejected");
  expect(adapter.correlationDiagnostics.at(-1)?.code).toBe("response.before_turn_end");
});

it.each(["before response done", "after response done", "during continuation"])(
  "revokes validated evidence on a changed final %s, including correct-to-correct text changes",
  boundary => {
    const { adapter, transcript, event } = settlingTurn();
    transcript("I see");
    adapter.speechStopped("settling-item");
    transcript("I see one duck.");
    adapter.responseCreated("settling-response");
    adapter.call(event());
    expect(adapter.drainResults()[0].status).toBe("accepted");
    if (boundary !== "before response done") adapter.responseDone("settling-response", "completed");
    if (boundary === "during continuation") {
      expect(adapter.takeContinuation()).toBe("accepted");
      adapter.responseCreated("continuation");
    }
    transcript("One duck."); // Same meaning still cannot relabel accepted evidence.
    expect(adapter.correlationDiagnostics.at(-1)?.code).toBe("transcript.final.corrected");
    adapter.responseDone(boundary === "during continuation" ? "continuation" : "settling-response", "completed");
    expect(adapter.learnerAnswerAccepted).toBe(false);
    expect(adapter.state.answerAccepted).toBe(false);
    expect(adapter.state.acknowledgmentObserved).toBe(false);
    transcript("I see one duck."); // Returning to old words cannot resurrect the token.
    adapter.call(event({}, { call_id: "second-call" }));
    expect(adapter.drainResults()[0].status).toBe("rejected");
    expect(adapter.learnerAnswerAccepted).toBe(false);
  },
);

it.each([{ supporting_text: "I see" }, { context_token: "stale-token" }])(
  "still rejects mismatched evidence/token after provisional replacement: %j",
  changes => {
    const { adapter, transcript, event } = settlingTurn();
    transcript("I see");
    adapter.speechStopped("settling-item");
    transcript("I see one duck.");
    adapter.responseCreated("settling-response");
    adapter.call(event(changes));
    expect(adapter.drainResults()[0].status).toBe("rejected");
    adapter.responseDone("settling-response", "completed");
    expect(adapter.learnerAnswerAccepted).toBe(false);
  },
);

it("uses the latest wrong correction rather than an earlier correct provisional answer", () => {
  const { adapter, transcript, event } = settlingTurn();
  transcript("I see one duck.");
  adapter.speechStopped("settling-item");
  transcript("Two ducks.");
  adapter.responseCreated("settling-response");
  adapter.call(event({ supporting_text: "Two ducks." }));
  expect(adapter.drainResults()[0].reason).toBe("unsupported settled answer");
  expect(adapter.learnerAnswerAccepted).toBe(false);
});

it.each(["new item", "wrong response", "cancelled", "partial total"])(
  "cannot reuse provisional evidence across %s",
  fault => {
    const { adapter, transcript, event } = settlingTurn();
    transcript("I see");
    adapter.speechStopped("settling-item");
    if (fault !== "partial total") transcript("I see one duck.");
    if (fault === "new item") {
      adapter.speechStarted("new-item");
      adapter.speechStopped("new-item");
      transcript("I see one duck.", "new-item");
      transcript("Two ducks."); // Old item's callback cannot overwrite the new item.
    }
    adapter.responseCreated("settling-response");
    if (fault === "cancelled") adapter.responseDone("settling-response", "cancelled");
    adapter.call(event({}, fault === "wrong response" ? { response_id: "other-response" } : {}));
    expect(adapter.drainResults()[0].status).toBe("rejected");
    expect(adapter.learnerAnswerAccepted).toBe(false);
  },
);

it("keeps the observed wrong-object ASR result rejected after settling the original turn", () => {
  const { adapter, transcript, event } = settlingTurn();
  transcript("I see");
  adapter.speechStopped("settling-item");
  transcript("I see one dog.");
  adapter.responseCreated("settling-response");
  adapter.call(event({ answer_outcome: "incorrect", supporting_text: "I see one dog." }));
  expect(adapter.drainResults()[0].reason).toBe("unsupported incorrect answer");
  expect(adapter.correlationDiagnostics.at(-1)?.code).toBe("response.bound");
  expect(adapter.learnerAnswerAccepted).toBe(false);
});
