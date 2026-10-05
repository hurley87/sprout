import { expect, it, vi } from "vitest";
import {
  assertCompletedLesson,
  assertSettledCorrection,
  assertWrongWindow,
  assertWrongDecision,
  classifierEvidence,
  detail,
  transitions,
  type Change,
  type Report,
} from "./browser/live/evidence";
import {
  CLASSIFIER_VERSION,
  CONVERSATION_CLASSIFICATION_THRESHOLDS,
  mapConversationObservation,
  type ConversationStateOutputs,
} from "../lib/lesson-runtime/conversation-observer-contract";
import {
  createLessonRuntime,
  classificationSource,
  reduceLessonRuntime,
  runtimeSource,
  type LessonRuntimeEvent,
} from "../lib/lesson-runtime/lesson-runtime-reducer";
import { COUNTING_NODE_IDS } from "../lib/lesson-runtime/counting-lesson";
import type { LessonDiagnostic } from "../lib/lesson-runtime/lesson-runtime";
import { LIVE_CORRECT_ANSWERS } from "./browser/live/answers";
import manifest from "./fixtures/speech/manifest.json";
import {
  assertFreshRecovery,
  assertHoldWindow,
  assertStoppedWindow,
  assertUnresolvedSpeech,
} from "./browser/live/support-evidence";
import { UNRESOLVED } from "./browser/live/behaviors";

it("live baseline answers match each scene, including butterflies on the final node", () => {
  expect(
    Object.fromEntries(
      Object.entries(LIVE_CORRECT_ANSWERS).map(([node, fixture]) => [node, manifest.fixtures[fixture].text]),
    ),
  ).toEqual({
    "count-1-duck": "I see one duck.",
    "count-2-ducks": "I see two ducks.",
    "count-3-butterflies": "I see three butterflies.",
  });
  expect(manifest.fixtures["answer-three-ducks"].text).toBe("I see three ducks.");
  expect(manifest.fixtures["answer-three-ducks"].sha256).not.toBe(manifest.fixtures["answer-three"].sha256);
});

/** Offline report builder uses actual reducer gates and canonical mapping; never used by live tests. */
function completedReport(correction = false, discardedNoise = false): Report {
  let state = createLessonRuntime("offline-runtime");
  let clock = 0;
  const events: LessonDiagnostic[] = [];
  const log = (
    type: string,
    value: unknown,
    source = { ...runtimeSource(state), nodeId: state.nodeId, transcriptRevision: state.transcriptRevision },
  ) => {
    const event: LessonDiagnostic = {
      type,
      timestamp: "offline",
      atMs: ++clock,
      ...source,
      transcriptSpeaker: state.transcriptSource,
      detail: value,
      ...(type.startsWith("classifier.") ? { classifierVersion: CLASSIFIER_VERSION } : {}),
    };
    events.push(event);
    return event;
  };
  const apply = (event: LessonRuntimeEvent) => {
    const before = state;
    const source = { ...runtimeSource(before), nodeId: before.nodeId, transcriptRevision: before.transcriptRevision };
    const result = reduceLessonRuntime(before, event);
    state = result.state;
    if (event.type !== "clock.tick") log(`runtime.event.${event.type}`, { event, accepted: before !== state }, source);
    if (before !== state) log("runtime.changed", { trigger: event.type, before, after: state });
    for (const effect of result.effects) log(effect.type, effect);
  };
  log("render.confirmed", {
    identity: { token: "initial", nodeId: state.nodeId, sceneId: "hello-duck" },
    initial: true,
  });
  for (const [index, node] of COUNTING_NODE_IDS.entries()) {
    log("gpt_live.steering_append", {
      renderToken: index === 0 ? "initial" : JSON.stringify([state.runtimeId, state.visitId]),
    });
    apply({ type: "child.turn.started", source: runtimeSource(state), atMs: ++clock });
    log("microphone.speech_started", null);
    apply({
      type: "transcript.updated",
      source: runtimeSource(state),
      revision: state.transcriptRevision + 1,
      speaker: "child",
      atMs: ++clock,
    });
    log("microphone.speech_stopped", { quietMs: 500 });
    apply({ type: "child.turn.ended", source: runtimeSource(state), atMs: ++clock });
    log("output.activity", { state: "active" });
    apply({ type: "output.activity", source: runtimeSource(state), state: "active", atMs: ++clock });
    if (discardedNoise && index === 2) {
      log("transcript.snapshot", { transcript: "Child: Three." });
      log("microphone.activity_started", null);
      apply({ type: "child.candidate.started", source: runtimeSource(state), atMs: ++clock });
      log("microphone.activity_discarded", null);
      apply({ type: "child.candidate.discarded", source: runtimeSource(state), atMs: ++clock });
    }
    apply({
      type: "transcript.updated",
      source: runtimeSource(state),
      revision: state.transcriptRevision + 1,
      speaker: "tutor",
      atMs: ++clock,
    });
    log("output.activity", { state: "quiet" });
    apply({ type: "output.activity", source: runtimeSource(state), state: "quiet", atMs: ++clock });
    const source = classificationSource(state)!;
    const child = correction && index === 1 ? "Three. Uh, I mean two." : ["One.", "Two.", "Three."][index];
    log("classifier.started", { transcript: `Child: ${child}\nTutor: confirmation in arbitrary words` }, source);
    const outputs: ConversationStateOutputs = {
      objectiveState: {
        choice: "completed",
        confidence: 1,
        probabilities: { completed: 1, incorrect: 0, unclear_or_incomplete: 0, unresolved_help: 0, no_attempt: 0 },
      },
      tutorState: {
        choice: "confirmed_completion",
        confidence: 1,
        probabilities: { confirmed_completion: 1, clarifying: 0, helping: 0, asking: 0, other: 0 },
      },
    };
    const decision = mapConversationObservation(
      { nodeId: node, transcriptRevision: source.transcriptRevision, transcript: `Child: ${child}\nTutor: Yes.` },
      outputs,
    );
    log(
      "classifier.mapping",
      {
        classifierVersion: CLASSIFIER_VERSION,
        decision: decision.status,
        outcome: decision.outcome,
        outputs,
        labelCompletionEligible: true,
        thresholds: CONVERSATION_CLASSIFICATION_THRESHOLDS,
        nodeId: node,
        transcriptRevision: source.transcriptRevision,
        elapsedMs: 1,
      },
      source,
    );
    log("classifier.result", { proposal: decision.proposal, elapsedMs: 1 }, source);
    apply({ type: "proposal.received", source, proposal: decision.proposal, atMs: ++clock });
    clock += 300;
    apply({ type: "clock.tick", source: runtimeSource(state), atMs: ++clock });
    const identity = state.pendingRender!.identity;
    log("render.confirmed", { identity });
    apply({ type: "render.confirmed", runtimeId: state.runtimeId, identity, atMs: ++clock });
  }
  log("lesson.ended", { reason: "lesson_completed", runtime: state });
  return {
    product: "sprout",
    classifierVersion: CLASSIFIER_VERSION,
    version: 1,
    runtimeId: state.runtimeId,
    clock: "browser.performance.now-relative-to-attempt",
    timing: {} as Report["timing"],
    runtime: state,
    status: "ended",
    error: null,
    transcript: "",
    events,
  };
}

it("accepts complete reducer-generated lessons and classifier results from a separate observer clone", () => {
  const report = completedReport();
  assertCompletedLesson(report);
  const result = report.events.find(event => event.type === "classifier.result")!;
  expect(classifierEvidence(report.events, structuredClone(result)).diagnostic.outcome).toBe(
    "allow_semantic_completion_evidence",
  );
  assertCompletedLesson(completedReport(true), true);
});

it.each([
  "stale revision",
  "stale turn",
  "stale runtime",
  "cancelled",
  "missing mapping",
  "wrong classifier",
  "missing onset",
  "no acknowledgment",
  "no drain",
  "duplicate success",
  "render token",
  "steering before render",
  "missing completion",
  "premature end",
])("rejects corrupt production evidence: %s", fault => {
  const report = completedReport();
  const result = report.events.find(event => event.type === "classifier.result")!;
  const request = report.events.find(event => event.type === "classifier.started")!;
  const advance = transitions(report.events)[0];
  const change = detail<Change>(advance);
  switch (fault) {
    case "stale revision":
      result.transcriptRevision--;
      break;
    case "stale turn":
      result.childTurnId = 0;
      break;
    case "stale runtime":
      result.runtimeId = "old-runtime";
      break;
    case "cancelled":
      report.events.splice(report.events.indexOf(result), 0, { ...request, type: "classifier.cancelled" });
      break;
    case "missing mapping":
      report.events = report.events.filter(event => event.type !== "classifier.mapping");
      break;
    case "wrong classifier":
      delete result.classifierVersion;
      break;
    case "missing onset":
      report.events = report.events.filter(event => event.type !== "output.activity");
      break;
    case "no acknowledgment":
      change.before = { ...change.before, acknowledgmentObserved: false };
      break;
    case "no drain":
      change.before = { ...change.before, quietSinceMs: change.after.nowMs };
      break;
    case "duplicate success":
      report.events.push(advance);
      break;
    case "render token":
      detail<{ identity: { token: string } }>(
        report.events.find(event => event.type === "render.confirmed" && event.visitId === 2)!,
      ).identity.token = "wrong";
      break;
    case "steering before render": {
      const steering = report.events.find(event => event.type === "gpt_live.steering_append" && event.visitId === 2)!;
      report.events.splice(report.events.indexOf(steering), 1);
      report.events.splice(report.events.indexOf(advance), 0, steering);
      break;
    }
    case "missing completion":
      report.events = report.events.filter(event => event.type !== "lesson.completed");
      break;
    case "premature end":
      detail<{ reason: string }>(report.events.at(-1)!).reason = "parent_stop";
      break;
  }
  expect(() => assertCompletedLesson(report)).toThrow();
});

it("accepts child answer fragments separated by tutor backchannels", () => {
  const report = completedReport();
  const request = report.events.find(event => event.type === "classifier.started" && event.nodeId === "count-2-ducks")!;
  detail<{ transcript: string }>(request).transcript =
    "Tutor: How many?\nChild: I see two\nTutor: Yes,\nChild: ducks\nTutor: there are two ducks.";
  assertCompletedLesson(report);
});

it("cannot borrow the answer from tutor speech or an older child turn", () => {
  const report = completedReport();
  const request = report.events.find(event => event.type === "classifier.started" && event.nodeId === "count-2-ducks")!;
  detail<{ transcript: string }>(request).transcript = "Child: ducks\nTutor: Two ducks.";
  expect(() => assertCompletedLesson(report)).toThrow(/authored child answer absent/);
  const previous = {
    ...request,
    type: "transcript.snapshot",
    childTurnId: request.childTurnId! - 1,
    detail: { transcript: "Child: Two.\nTutor: Say that again." },
  };
  report.events.splice(report.events.indexOf(request), 0, previous);
  detail<{ transcript: string }>(request).transcript =
    "Child: Two.\nTutor: Say that again.\nChild: ducks\nTutor: Two ducks.";
  expect(() => assertCompletedLesson(report)).toThrow(/authored child answer absent/);
});

it("self-correction forbids success authority on a partial wrong prefix, even if later evidence completes", () => {
  const report = completedReport(true);
  const request = report.events.find(event => event.type === "classifier.started" && event.nodeId === "count-2-ducks")!;
  detail<{ transcript: string }>(request).transcript = "Child: Three.\nTutor: Two ducks.";
  expect(() => assertSettledCorrection(report.events)).toThrow(/settled self-correction/);
});

it("wrong-answer evidence accepts canonical uncertainty but rejects provider errors and missing scores", () => {
  const report = completedReport();
  const request = report.events.find(event => event.type === "classifier.started" && event.nodeId === "count-2-ducks")!;
  const result = report.events.find(event => event.type === "classifier.result" && event.nodeId === "count-2-ducks")!;
  const mapping = report.events.find(event => event.type === "classifier.mapping" && event.nodeId === "count-2-ducks")!;
  detail<{ transcript: string }>(request).transcript =
    "Child: I see three ducks\nTutor: Let's check. Point to each duck.";
  result.type = "classifier.held";
  detail<{ proposal: unknown }>(result).proposal = null;
  const outputs: ConversationStateOutputs = {
    objectiveState: {
      choice: "incorrect",
      confidence: 1,
      probabilities: { completed: 0, incorrect: 1, unclear_or_incomplete: 0, unresolved_help: 0, no_attempt: 0 },
    },
    tutorState: {
      choice: "helping",
      confidence: 1,
      probabilities: { confirmed_completion: 0, clarifying: 0, helping: 1, asking: 0, other: 0 },
    },
  };
  const diagnostic = detail<Record<string, unknown>>(mapping);
  Object.assign(diagnostic, { decision: "accepted", outcome: "hold_scene", labelCompletionEligible: false, outputs });
  assertWrongDecision(report.events, result);
  result.type = "classifier.abstained";
  outputs.objectiveState = {
    choice: "unresolved_help",
    confidence: 0.69,
    probabilities: { completed: 0, incorrect: 0.14, unclear_or_incomplete: 0.11, unresolved_help: 0.75, no_attempt: 0 },
  };
  Object.assign(diagnostic, { decision: "abstained", outcome: "unresolved", reason: "objectiveState_no_winner" });
  assertWrongDecision(report.events, result);
  diagnostic.reason = "provider_unreachable";
  expect(() => assertWrongDecision(report.events, result)).toThrow(/provider failure/);
  diagnostic.reason = "objectiveState_no_winner";
  diagnostic.outputs = null;
  expect(() => assertWrongDecision(report.events, result)).toThrow(/lacks valid classifier scores/);
  result.type = "classifier.result";
  expect(() => assertWrongDecision(report.events, result)).toThrow(/success authority/);
});

it("wrong-answer hold checks the complete bounded journal including transient advances and success authority", () => {
  assertWrongWindow([], 2, 0, 3000);
  expect(() => assertWrongWindow([], 2, 0, 2999)).toThrow(/shorter/);
  const report = completedReport();
  const advance = transitions(report.events)[1];
  expect(() => assertWrongWindow([advance], 2, 0, 3000)).toThrow(/advanced/);
  const result = report.events.find(event => event.type === "classifier.result" && event.visitId === 2)!;
  expect(() => assertWrongWindow([result], 2, 0, 3000)).toThrow(/success authority/);
  expect(() => assertWrongWindow([{ ...result, type: "lesson.ended" }], 2, 0, 3000)).toThrow(/ended/);
});

it("next child action requires steering acknowledgment, visit boundary, stable transcript and sustained PCM quiet", async () => {
  const { settledPrompt, settledTutorResponse } = await import("./browser/live/signals");
  const report = completedReport();
  const event = report.events[0];
  const runtime = { ...createLessonRuntime(report.runtimeId), outputActivity: "quiet" as const };
  const events: LessonDiagnostic[] = [
    { ...event, type: "gpt_live.steering_append", atMs: 10, detail: { eventId: "steer-1" } },
    {
      ...event,
      type: "gpt_live.context_appended",
      atMs: 20,
      detail: { name: "session.instructions.appended", clientEventId: "steer-1" },
    },
    { ...event, type: "transcript.visit_boundary", atMs: 21, detail: {} },
    {
      ...event,
      type: "transcript.snapshot",
      atMs: 30,
      transcriptSpeaker: "tutor",
      detail: { transcript: "Tutor: arbitrary prompt" },
    },
    { ...event, type: "output.activity", atMs: 35, detail: { state: "active" } },
    { ...event, type: "output.activity", atMs: 50, detail: { state: "quiet" } },
  ];
  const value = {
    nowMs: 1000,
    cursor: { runtimeId: report.runtimeId, offset: events.length },
    events,
    snapshot: {
      status: "live",
      runtime,
      awaitingSteering: false,
      display: { token: "initial", nodeId: "count-1-duck", sceneId: "hello-duck" },
      transcript: "Tutor: arbitrary prompt",
      error: null,
      diagnostics: [],
    },
  } as import("../lib/lesson-runtime/lesson-runtime").LessonObservation;
  const ready = (v = value) => settledPrompt(v, "count-1-duck", 1, report.runtimeId);
  expect(ready()).toBe(true);
  for (const type of [
    "gpt_live.context_appended",
    "transcript.visit_boundary",
    "transcript.snapshot",
    "output.activity",
  ])
    expect(ready({ ...value, events: events.filter(event => event.type !== type) })).toBe(false);
  expect(ready({ ...value, nowMs: 100 })).toBe(false);
  expect(ready({ ...value, cursor: { ...value.cursor, runtimeId: "restarted" } })).toBe(false);
  expect(ready({ ...value, snapshot: { ...value.snapshot, awaitingSteering: true } })).toBe(false);
  expect(ready({ ...value, snapshot: { ...value.snapshot, runtime: { ...runtime, childSpeaking: true } } })).toBe(
    false,
  );
  expect(
    ready({
      ...value,
      events: events.map(event =>
        event.type === "gpt_live.context_appended"
          ? { ...event, detail: { name: "session.instructions.appended", clientEventId: "old-steering" } }
          : event,
      ),
    }),
  ).toBe(false);
  expect(settledTutorResponse(value, events.length)).toBe(false); // prior prompt cannot release a post-wrong answer action
  expect(
    ready({
      ...value,
      events: [...events, { ...event, type: "output.activity", atMs: 999, detail: { state: "active" } }],
    }),
  ).toBe(false);
});

/** These fabricated journals exercise assertions only; live scenarios never import this builder. */
function supportReport(text = "Please help me count the ducks.") {
  const report = completedReport();
  const request = report.events.find(e => e.type === "classifier.started" && e.visitId === 2)!;
  const result = report.events.find(e => e.type === "classifier.result" && e.visitId === 2)!;
  const mapping = report.events.find(e => e.type === "classifier.mapping" && e.visitId === 2)!;
  report.runtime = detail<Change>(transitions(report.events)[1]).before;
  report.status = "live";
  report.events = report.events.slice(0, report.events.indexOf(result) + 1);
  result.type = "classifier.held";
  detail<{ proposal: unknown }>(result).proposal = null;
  detail<{ transcript: string }>(request).transcript = `Child: ${text}\nTutor: Point to each duck.`;
  const outputs = detail<{ outputs: ConversationStateOutputs }>(mapping).outputs;
  outputs.objectiveState = {
    choice: "unresolved_help",
    confidence: 1,
    probabilities: { completed: 0, incorrect: 0, unclear_or_incomplete: 0, unresolved_help: 1, no_attempt: 0 },
  };
  outputs.tutorState = {
    choice: "helping",
    confidence: 1,
    probabilities: { confirmed_completion: 0, clarifying: 0, helping: 1, asking: 0, other: 0 },
  };
  Object.assign(detail<Record<string, unknown>>(mapping), {
    decision: "accepted",
    outcome: "hold_scene",
    labelCompletionEligible: false,
  });
  report.events.splice(report.events.indexOf(request), 0, {
    ...request,
    type: "transcript.snapshot",
    transcriptSpeaker: "tutor",
    detail: { transcript: detail<{ transcript: string }>(request).transcript },
  });
  const offset = report.events.findIndex(e => e.type === "gpt_live.steering_append" && e.visitId === 2) + 1;
  const from = {
    after: { runtimeId: report.runtimeId, offset },
    scope: { runtimeId: report.runtimeId, visitId: 2, nodeId: "count-2-ducks", childTurnId: 0, transcriptRevision: 0 },
  };
  return { report, result, request, mapping, from };
}

it.each(Object.entries(UNRESOLVED))(
  "%s fixture is unresolved speech with heard current-turn evidence",
  (mode, fixture) => {
    const text = manifest.fixtures[fixture.fixture].text;
    const { report, result, from } = supportReport(text);
    assertUnresolvedSpeech(report.events, result, from, fixture.heard, mode === "help");
    assertHoldWindow(report, from, 0, 3000);
    expect(() =>
      assertUnresolvedSpeech(
        report.events,
        result,
        { ...from, scope: { ...from.scope, childTurnId: result.childTurnId } },
        fixture.heard,
      ),
    ).toThrow(/earlier child turn/);
    expect(() => assertUnresolvedSpeech(report.events, result, from, /absent words/)).toThrow(/intended utterance/);
  },
);

it.each([
  "scores",
  "provider failure",
  "mapping",
  "identity",
  "scaffold state",
  "tutor transcript",
  "tutor audio",
  "tutor supplied",
  "older answer",
  "missing VAD",
  "unfinished turn",
  "earlier tutor audio",
])("rejects invalid support evidence: %s", fault => {
  const { report, result, request, mapping, from } = supportReport();
  const diagnostic = detail<Record<string, unknown>>(mapping);
  if (fault === "scores") diagnostic.outputs = null;
  if (fault === "provider failure") {
    result.type = "classifier.abstained";
    Object.assign(diagnostic, { decision: "abstained", outcome: "unresolved", reason: "provider_unreachable" });
  }
  if (fault === "mapping") report.events = report.events.filter(e => e !== mapping);
  if (fault === "identity") result.transcriptRevision++;
  if (fault === "scaffold state")
    detail<{ outputs: ConversationStateOutputs }>(mapping).outputs.tutorState.choice = "asking";
  if (fault === "tutor transcript") report.events = report.events.filter(e => e.type !== "transcript.snapshot");
  if (fault === "tutor audio") report.events = report.events.filter(e => e.type !== "output.activity");
  if (fault === "tutor supplied")
    detail<{ transcript: string }>(request).transcript = "Child: Um.\nTutor: Please help me count the ducks.";
  if (fault === "older answer")
    report.events.splice(report.events.indexOf(request), 0, {
      ...request,
      type: "transcript.snapshot",
      childTurnId: 0,
      detail: { transcript: "Child: Please help me count the ducks." },
    });
  if (fault === "missing VAD") report.events = report.events.filter(e => e.type !== "microphone.speech_stopped");
  if (fault === "unfinished turn")
    report.events = report.events.filter(e => e.type !== "runtime.event.child.turn.ended");
  if (fault === "earlier tutor audio")
    for (const event of report.events.filter(e => e.type === "output.activity" && e.visitId === 2)) event.atMs = 0;
  expect(() => assertUnresolvedSpeech(report.events, result, from, UNRESOLVED.help.heard, true)).toThrow();
});

it("accepts semantic score abstention and rejects a provider error elsewhere in the hold journal", () => {
  const { report, result, mapping, from } = supportReport();
  result.type = "classifier.abstained";
  Object.assign(detail<Record<string, unknown>>(mapping), {
    decision: "abstained",
    outcome: "unresolved",
    reason: "tutorState_competing_options",
  });
  assertUnresolvedSpeech(report.events, result, from, UNRESOLVED.help.heard, true);
  assertHoldWindow(report, from, 0, 3000);
  report.events.push({ ...result, type: "classifier.error" });
  expect(() => assertHoldWindow(report, from, 0, 3000)).toThrow(/provider failure/);
});

it("silence holds without invented classifier evidence, but transient authority, end, or short windows fail", () => {
  const { report, from } = supportReport();
  report.events = report.events.slice(0, from.after.offset);
  assertHoldWindow(report, from, 0, 5000);
  expect(() => assertHoldWindow(report, from, 0, 2999)).toThrow(/shorter/);
  const complete = completedReport();
  report.events.push(transitions(complete.events)[1]);
  expect(() => assertHoldWindow(report, from, 0, 5000)).toThrow(/advanced/);
  report.events.pop();
  report.events.push(complete.events.find(e => e.type === "classifier.result" && e.visitId === 2)!);
  expect(() => assertHoldWindow(report, from, 0, 5000)).toThrow(/success authority/);
  report.events.pop();
  report.events.push({ ...complete.events.at(-1)!, atMs: 2000 });
  expect(() => assertHoldWindow(report, from, 0, 5000)).toThrow(/ended/);
});

it("recovery requires a fresh learner total, rejecting prior authority and tutor totals", () => {
  const report = completedReport();
  const { from } = supportReport();
  assertFreshRecovery(report, from);
  expect(() =>
    assertFreshRecovery(report, {
      ...from,
      scope: {
        ...from.scope,
        childTurnId: report.events.find(e => e.type === "classifier.result" && e.visitId === 2)!.childTurnId,
      },
    }),
  ).toThrow(/pre-answer authority/);
  const request = report.events.find(e => e.type === "classifier.started" && e.visitId === 2)!;
  detail<{ transcript: string }>(request).transcript = "Child: Okay\nTutor: Two ducks.";
  expect(() => assertFreshRecovery(report, from)).toThrow(/learner recovery total missing/);
});

it.each(["valid", "short", "spoken stop", "render", "authority", "steering", "transient visit"])(
  "parent stop window: %s",
  fault => {
    const { report, from } = supportReport();
    report.events = report.events.slice(0, from.after.offset);
    const base = report.events.at(-1)!;
    report.status = "ended";
    report.runtime = { ...report.runtime!, phase: "stopped" };
    report.events.push({
      ...base,
      type: "lesson.ended",
      atMs: 100,
      detail: { reason: fault === "spoken stop" ? "session_closed" : "parent_stop" },
    });
    if (fault === "render") report.events.push({ ...base, type: "render.requested", atMs: 200 });
    if (fault === "authority") report.events.push({ ...base, type: "classifier.result", atMs: 200 });
    if (fault === "steering") report.events.push({ ...base, type: "gpt_live.steering_append", atMs: 200 });
    if (fault === "transient visit")
      report.events.push({ ...base, type: "runtime.changed", atMs: 200, detail: { after: { visitId: 3 } } });
    const check = () => assertStoppedWindow(report, from, 0, fault === "short" ? 2999 : 3000);
    if (fault === "valid") check();
    else expect(check).toThrow();
  },
);

it.each(["incorrect", "unclear_or_incomplete", "unresolved_help", "no_attempt"] as const)(
  "hold accepts safe objective %s without mandating one label",
  choice => {
    const { report, result, mapping, from } = supportReport();
    const objective = detail<{ outputs: ConversationStateOutputs }>(mapping).outputs.objectiveState;
    objective.choice = choice;
    for (const key of Object.keys(objective.probabilities) as (keyof typeof objective.probabilities)[])
      objective.probabilities[key] = key === choice ? 1 : 0;
    assertUnresolvedSpeech(report.events, result, from, UNRESOLVED.help.heard);
  },
);

it("hold rejects orphan render activity and missing normalized diagnostics across the whole window", () => {
  const { report, result, from } = supportReport();
  report.events.push({ ...result, type: "render.requested" });
  expect(() => assertHoldWindow(report, from, 0, 3000)).toThrow(/render or steering/);
  report.events.pop();
  report.events.push({ ...result, type: "classifier.mapping_unavailable" });
  expect(() => assertHoldWindow(report, from, 0, 3000)).toThrow(/missing diagnostics/);
});

/** Fabricated successful noise journal for regression assertions, never imported by live cases. */
function butterflyCompletion() {
  const report = completedReport();
  const request = report.events.find(e => e.type === "classifier.started" && e.nodeId === "count-3-butterflies")!;
  detail<{ transcript: string }>(request).transcript = "Child: Uh, I think, uh, three.\nTutor: Yes, three butterflies.";
  const prior = report.events.slice(0, report.events.indexOf(request));
  const state = detail<Change>(prior.findLast(e => e.type === "runtime.changed")!).after;
  const child = {
    ...request,
    type: "transcript.snapshot",
    atMs: request.atMs - 0.3,
    transcriptSpeaker: "child" as const,
    detail: { transcript: "Child: Uh, I think, uh, three." },
  };
  const tutor = { ...request, type: "transcript.snapshot", atMs: request.atMs - 0.2, detail: request.detail };
  report.events.splice(report.events.indexOf(request), 0, child, tutor);
  const cursor = { runtimeId: report.runtimeId, offset: report.events.indexOf(request) + 1 };
  const offset = report.events.findIndex(e => e.type === "gpt_live.steering_append" && e.visitId === 3) + 1;
  const landed: import("./helpers/injection-window").WindowEvidence = {
    request: {
      from: {
        after: { runtimeId: report.runtimeId, offset },
        scope: { runtimeId: report.runtimeId, visitId: 3, nodeId: "count-3-butterflies", childTurnId: 0 },
      },
      timing: "classifier-in-flight",
      audio: { noise: { seed: 30, durationMs: 40, amplitude: 0.2 } },
    },
    atMs: request.atMs + 0.01,
    afterStartMs: request.atMs + 0.02,
    cursor,
    state,
    afterState: structuredClone(state),
    trigger: request,
    child,
    tutor,
    output: prior.findLast(e => e.type === "output.activity")!,
    playback: { id: 1, startedAt: 900000, durationSeconds: 0.04 },
  };
  report.events.splice(
    cursor.offset,
    0,
    { ...request, type: "microphone.activity_started", atMs: request.atMs + 0.1, detail: null },
    { ...request, type: "microphone.activity_discarded", atMs: request.atMs + 0.2, detail: null },
  );
  return { report, landed, request };
}

it("butterfly outcome summary only reports safe recovery after full completion validation", async () => {
  const { butterflySummary, assertButterflySafety } = await import("./browser/live/butterfly-evidence");
  const { report, landed } = butterflyCompletion();
  assertButterflySafety(report, landed, false);
  const summary = butterflySummary(report, landed, 9000, false);
  expect(summary.outcome).toBe("safely-progressed");
  expect(summary.recoveryVerified).toBe(true);
  expect(summary.classifier?.find(e => e.type === "classifier.mapping")?.detail).toMatchObject({
    outputs: { objectiveState: { choice: "completed" }, tutorState: { choice: "confirmed_completion" } },
    outcome: "allow_semantic_completion_evidence",
    elapsedMs: 1,
  });
});
it.each(["cancelled authority", "stale revision", "duplicate completion", "render ordering", "genuine interruption"])(
  "butterfly summary cannot call %s safe recovery",
  async fault => {
    const { butterflySummary } = await import("./browser/live/butterfly-evidence");
    const { report, landed, request } = butterflyCompletion();
    if (fault === "cancelled authority")
      report.events.splice(landed.cursor.offset + 2, 0, {
        ...request,
        type: "classifier.cancelled",
        detail: { reason: "child_turn_started" },
      });
    if (fault === "stale revision")
      report.events.find(e => e.type === "classifier.result" && e.visitId === 3)!.transcriptRevision++;
    if (fault === "duplicate completion") report.events.push(transitions(report.events).at(-1)!);
    if (fault === "render ordering")
      report.events = report.events.filter(e => !(e.type === "render.confirmed" && e.visitId === 4));
    const summary = butterflySummary(report, landed, 9000, fault === "genuine interruption");
    expect(summary.outcome).toBe("unsafe-or-incomplete");
    expect(summary.recoveryVerified).toBe(false);
  },
);

it("discarded noise uses preserved confirmed-answer speech only with new current classifier authority and exact reducer lineage", () => {
  const report = completedReport(false, true);
  expect(() => assertCompletedLesson(report)).toThrow(/authored child answer absent/);
  const onset = report.events.find(e => e.type === "microphone.activity_started")!;
  assertCompletedLesson(report, false, { visitId: 3, answerTurnId: onset.childTurnId!, afterMs: onset.atMs });
});
it.each([
  "confirmed speech",
  "fresh child transcript",
  "restored authority",
  "preservation",
  "wrong turn",
  "cancelled revalidation",
])("discarded noise lineage rejects %s", fault => {
  const report = completedReport(false, true);
  const onset = report.events.find(e => e.type === "microphone.activity_started")!;
  const started = report.events.find(
    e => e.type === "runtime.changed" && detail<Change>(e).trigger === "child.candidate.started",
  )!;
  const discarded = report.events.find(
    e => e.type === "runtime.changed" && detail<Change>(e).trigger === "child.candidate.discarded",
  )!;
  const request = report.events.find(e => e.type === "classifier.started" && e.visitId === 3)!;
  if (fault === "confirmed speech")
    report.events.splice(report.events.indexOf(discarded), 0, {
      ...discarded,
      type: "runtime.event.child.turn.confirmed",
    });
  if (fault === "fresh child transcript")
    report.events.splice(report.events.indexOf(discarded), 0, {
      ...discarded,
      type: "transcript.snapshot",
      transcriptSpeaker: "child",
      detail: { transcript: "Child: Uh." },
    });
  if (fault === "restored authority")
    detail<Change>(discarded).after = { ...detail<Change>(discarded).after, answerAccepted: true };
  if (fault === "preservation")
    detail<Change>(started).after = {
      ...detail<Change>(started).after,
      childCandidate: { hasChildTranscript: false, tutorOutputObserved: true },
    };
  if (fault === "wrong turn") request.childTurnId = request.childTurnId! + 1;
  if (fault === "cancelled revalidation")
    report.events.splice(report.events.indexOf(request) + 1, 0, {
      ...request,
      type: "classifier.cancelled",
      detail: { reason: "child_turn_started" },
    });
  expect(() =>
    assertCompletedLesson(report, false, { visitId: 3, answerTurnId: onset.childTurnId!, afterMs: onset.atMs }),
  ).toThrow();
});

it("a current canonical hold awaiting tutor confirmation is explicit held, never recovery; an older hold cannot describe a newer revision", async () => {
  const { butterflySummary } = await import("./browser/live/butterfly-evidence");
  const { report, landed } = butterflyCompletion();
  const result = report.events.find(e => e.type === "classifier.result" && e.visitId === 3)!;
  const mapping = report.events.find(e => e.type === "classifier.mapping" && e.visitId === 3)!;
  result.type = "classifier.held";
  detail<{ proposal: unknown }>(result).proposal = null;
  const diagnostic = detail<Record<string, unknown>>(mapping);
  const outputs = detail<{ outputs: ConversationStateOutputs }>(mapping).outputs;
  outputs.tutorState = {
    choice: "asking",
    confidence: 1,
    probabilities: { asking: 1, confirmed_completion: 0, clarifying: 0, helping: 0, other: 0 },
  };
  Object.assign(diagnostic, { labelCompletionEligible: false, outcome: "hold_scene" });
  report.events = report.events.slice(0, report.events.indexOf(result) + 1);
  report.runtime = structuredClone(landed.state);
  report.status = "live";
  let summary = butterflySummary(report, landed, 9000, false);
  expect(summary.safetyFailure).toBeNull();
  expect(summary.outcome).toBe("explicit-held");
  expect(summary.recoveryVerified).toBe(false);
  const newer = { ...report.runtime, transcriptRevision: report.runtime.transcriptRevision + 1 };
  report.events.push({
    ...result,
    type: "runtime.changed",
    detail: { trigger: "transcript.updated", before: report.runtime, after: newer },
  });
  report.runtime = newer;
  summary = butterflySummary(report, landed, 9000, false);
  expect(summary.safetyFailure).toBeNull();
  expect(summary.outcome).toBe("bounded-starvation-or-pending");
  expect(summary.recoveryVerified).toBe(false);
});

function prerequisiteAbstention() {
  const report = completedReport();
  const request = report.events.find(e => e.type === "classifier.started" && e.visitId === 2)!;
  const result = report.events.find(e => e.type === "classifier.result" && e.visitId === 2)!;
  const mapping = report.events.find(e => e.type === "classifier.mapping" && e.visitId === 2)!;
  const state = structuredClone(
    detail<Change>(report.events.slice(0, report.events.indexOf(request)).findLast(e => e.type === "runtime.changed")!)
      .after,
  );
  const tutor = {
    ...request,
    type: "transcript.snapshot",
    atMs: request.atMs - 0.1,
    detail: { transcript: "Child: I see two\nTutor: That's\nChild: ducks\nTutor: right, there are two ducks." },
  };
  report.events.splice(report.events.indexOf(request), 0, tutor);
  detail<{ transcript: string }>(request).transcript = detail<{ transcript: string }>(tutor).transcript;
  result.type = "classifier.abstained";
  detail<{ proposal: unknown }>(result).proposal = null;
  Object.assign(detail<Record<string, unknown>>(mapping), {
    decision: "abstained",
    outcome: "unresolved",
    reason: "objectiveState_no_winner",
  });
  const objective = detail<{ outputs: ConversationStateOutputs }>(mapping).outputs.objectiveState;
  Object.assign(objective, {
    confidence: 0.84,
    probabilities: { completed: 0.87, incorrect: 0, unclear_or_incomplete: 0.11, unresolved_help: 0.02, no_attempt: 0 },
  });
  report.events = report.events.slice(0, report.events.indexOf(result) + 1);
  const from = {
    after: {
      runtimeId: report.runtimeId,
      offset: report.events.findIndex(e => e.type === "gpt_live.steering_append" && e.visitId === 2) + 1,
    },
    scope: { runtimeId: report.runtimeId, visitId: 2, nodeId: "count-2-ducks" as const, childTurnId: 1 },
  };
  const value: import("../lib/lesson-runtime/lesson-runtime").LessonObservation = {
    nowMs: 5000,
    cursor: { runtimeId: report.runtimeId, offset: report.events.length },
    events: report.events,
    snapshot: {
      status: "live",
      runtime: state,
      transcript: detail<{ transcript: string }>(request).transcript,
      diagnostics: [],
      error: null,
      awaitingSteering: false,
      display: { token: "offline", nodeId: "count-2-ducks", sceneId: "duck-friends" },
    },
  };
  return { value, from, request, result, mapping };
}
it("butterfly setup records semantic completion-score abstention as a clarification opportunity, never an advance", async () => {
  const { prerequisiteDecision } = await import("./browser/live/setup");
  const f = prerequisiteAbstention();
  const decision = prerequisiteDecision(f.value, f.from, "count-3-butterflies");
  expect(decision?.kind).toBe("clarify");
  expect(f.value.snapshot.runtime?.answerAccepted).toBe(false);
  expect(f.value.events.some(e => e.type === "render.confirmed" && e.nodeId === "count-3-butterflies")).toBe(false);
});
it.each([
  "provider failure",
  "stale identity",
  "cancelled request",
  "wrong heard total",
  "no tutor confirmation",
  "ongoing speech",
])("butterfly setup cannot clarify after %s", async fault => {
  const { prerequisiteDecision } = await import("./browser/live/setup");
  const f = prerequisiteAbstention();
  if (fault === "provider failure") detail<Record<string, unknown>>(f.mapping).reason = "provider_unreachable";
  if (fault === "stale identity") f.result.transcriptRevision++;
  if (fault === "cancelled request")
    f.value.events = [
      ...f.value.events.slice(0, f.value.events.indexOf(f.result)),
      { ...f.request, type: "classifier.cancelled" },
      f.result,
    ];
  if (fault === "wrong heard total")
    detail<{ transcript: string }>(f.request).transcript = "Child: Three.\nTutor: Two ducks.";
  if (fault === "no tutor confirmation") {
    const diagnostic = detail<Record<string, unknown>>(f.mapping);
    const outputs = diagnostic.outputs as ConversationStateOutputs;
    outputs.tutorState = {
      choice: "asking",
      confidence: 1,
      probabilities: { asking: 1, confirmed_completion: 0, clarifying: 0, helping: 0, other: 0 },
    };
    diagnostic.labelCompletionEligible = false;
  }
  if (fault === "stale identity") {
    expect(prerequisiteDecision(f.value, f.from, "count-3-butterflies")).toBeNull();
  } else if (fault === "ongoing speech") {
    f.value.snapshot.runtime = { ...f.value.snapshot.runtime!, childSpeaking: true };
    expect(prerequisiteDecision(f.value, f.from, "count-3-butterflies")).toBeNull();
  } else expect(() => prerequisiteDecision(f.value, f.from, "count-3-butterflies")).toThrow();
});
it.each(["rendered", "abstained again"])("setup sends at most one fresh clarification then %s", async mode => {
  const { completeButterflyPrerequisite } = await import("./browser/live/setup");
  const f = prerequisiteAbstention();
  let value = f.value;
  const secondFrom = {
    after: value.cursor,
    scope: { ...f.from.scope, childTurnId: value.snapshot.runtime!.childTurnId },
  };
  const child = {
    checkpoint: vi.fn().mockResolvedValueOnce(f.from).mockResolvedValueOnce(secondFrom),
    sayFixture: vi.fn(async (fixture: import("./helpers/synthetic-microphone").SpeechFixture) => {
      expect(fixture).toBe("answer-two");
      if (child.sayFixture.mock.calls.length === 2) {
        const state = { ...value.snapshot.runtime!, childTurnId: 3, transcriptRevision: 31 };
        const base = { ...f.result, childTurnId: 3, transcriptRevision: 31, atMs: 6000 };
        const additions =
          mode === "rendered"
            ? [{ ...base, type: "render.confirmed", nodeId: "count-3-butterflies" as const, visitId: 3 }]
            : [
                {
                  ...base,
                  type: "runtime.changed",
                  detail: { trigger: "transcript.updated", before: value.snapshot.runtime, after: state },
                },
                {
                  ...base,
                  type: "transcript.snapshot",
                  transcriptSpeaker: "tutor" as const,
                  detail: { transcript: `${f.value.snapshot.transcript}\nChild: Two.\nTutor: Two ducks.` },
                },
                {
                  ...base,
                  type: "classifier.started",
                  detail: { transcript: `${f.value.snapshot.transcript}\nChild: Two.\nTutor: Two ducks.` },
                },
                {
                  ...base,
                  type: "classifier.mapping",
                  detail: { ...detail<Record<string, unknown>>(f.mapping), transcriptRevision: 31 },
                },
                { ...base, type: "output.activity", atMs: 6100, detail: { state: "active" } },
                { ...base, type: "output.activity", atMs: 6200, detail: { state: "quiet" } },
                { ...base, type: "classifier.abstained", atMs: 6300 },
              ];
        const events = [...value.events, ...additions];
        value = {
          ...value,
          nowMs: 8000,
          events,
          cursor: { ...value.cursor, offset: events.length },
          snapshot: { ...value.snapshot, runtime: state },
        };
      }
      return "ended";
    }),
    assert: vi.fn(async (_name: string, body: () => Promise<void>) => body()),
  };
  const observer = { read: vi.fn(async () => value) };
  const run = completeButterflyPrerequisite(
    child as unknown as import("./helpers/child-scenario").ChildScenario,
    observer as unknown as import("./helpers/lesson-observer").LessonObserver,
    "count-2-ducks",
    () => 100,
  );
  if (mode === "rendered") expect(await run).toEqual(secondFrom);
  else await expect(run).rejects.toThrow(/still abstained after one learner clarification/);
  expect(child.sayFixture).toHaveBeenCalledTimes(2);
  expect(child.sayFixture.mock.calls.every(call => call[0] === "answer-two")).toBe(true);
  expect(child.checkpoint).toHaveBeenCalledTimes(2);
});
