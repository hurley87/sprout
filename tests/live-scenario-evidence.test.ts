import { expect, it } from "vitest";
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
function completedReport(correction = false): Report {
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
