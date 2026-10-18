import { expect, it } from "vitest";
import { CountingProposals, OUTCOME_TOOL } from "../lib/experiments/grok-counting/proposals";

function fixture(text = "One duck.", tutor = "How many ducks do you see?") {
  const adapter = new CountingProposals();
  adapter.transcript({ id: "a0", speaker: "Tutor", text: tutor, final: true });
  adapter.speechStarted("u1");
  adapter.speechStopped("u1");
  adapter.transcript({ id: "u1", speaker: "Learner", text, final: true });
  adapter.responseCreated("r1");
  const context = adapter.issueContext()!;
  const token = context ? JSON.parse(context.match(/(\{.*\})/)![1]).context_token : "no-issued-context";
  const args = { context_token: token, answer_outcome: "correct", support_state: "none", supporting_text: text };
  const call = (changes = {}, envelope = {}) =>
    adapter.call({
      call_id: "c1",
      name: OUTCOME_TOOL.name,
      response_id: "r1",
      arguments: JSON.stringify({ ...args, ...changes }),
      ...envelope,
    });
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
  expect(call({}, { call_id: "c2" })?.status).toBe("accepted");
  expect(call({}, { call_id: "c2" })).toBeUndefined();
  expect(call({}, { call_id: "c3" })?.status).toBe("rejected");
});
it.each(["runtimeId", "visitId", "childTurnId", "nodeId", "transcriptRevision"] as const)(
  "rejects stale application identity %s",
  key => {
    const { adapter, call } = fixture();
    adapter.state = {
      ...adapter.state,
      [key]: typeof adapter.state[key] === "number" ? Number(adapter.state[key]) + 1 : "other",
    };
    expect(call()?.reason).toBe("stale context");
  },
);
it("rejects an old revision after a correction, then accepts a newly issued context", () => {
  const { adapter, call } = fixture("Two ducks.");
  adapter.transcript({ id: "u1", speaker: "Learner", text: "One duck.", final: true });
  expect(call()?.reason).toBe("stale context");
  adapter.responseCreated("r2");
  const context = adapter.issueContext()!;
  const token = JSON.parse(context.match(/(\{.*\})/)![1]).context_token;
  expect(
    call({ context_token: token, supporting_text: "One duck." }, { call_id: "c2", response_id: "r2" })?.status,
  ).toBe("accepted");
  adapter.responseDone("r2", "completed");
  expect(adapter.state.answerAccepted).toBe(true);
  adapter.transcript({ id: "u1", speaker: "Learner", text: "One or two?", final: true });
  expect(adapter.state.answerAccepted).toBe(false);
});
it("does not issue context for interim text or while the learner is speaking", () => {
  const a = new CountingProposals();
  a.speechStarted("u");
  a.responseCreated("r");
  a.transcript({ id: "u", speaker: "Learner", text: "one", final: false });
  expect(a.issueContext()).toBeUndefined();
  a.transcript({ id: "u", speaker: "Learner", text: "one", final: true });
  expect(a.issueContext()).toBeUndefined();
  a.speechStopped("u");
  expect(a.issueContext()).toBeDefined();
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
    expect(adapter.takeContinuation()).toBe(false);
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
it("continues a tool-only response exactly once after completed, never on rejection, cancellation or spoken feedback", () => {
  const { adapter, call } = fixture();
  call();
  expect(adapter.takeContinuation()).toBe(false);
  adapter.responseDone("r1", "completed");
  expect(adapter.takeContinuation()).toBe(true);
  expect(adapter.takeContinuation()).toBe(false);
  for (const fault of ["spoken", "cancelled", "rejected", "new turn", "revision"]) {
    const f = fixture();
    f.call();
    if (fault === "spoken") f.adapter.spoken("r1");
    if (fault === "rejected") f.call({}, { call_id: "c2", name: "other" });
    if (fault === "new turn") f.adapter.speechStarted("u2");
    if (fault === "revision") f.adapter.transcript({ id: "a1", speaker: "Tutor", text: "Great", final: true });
    f.adapter.responseDone("r1", fault === "cancelled" ? "cancelled" : "completed");
    expect(f.adapter.takeContinuation()).toBe(false);
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
