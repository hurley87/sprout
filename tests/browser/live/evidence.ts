import assert from "node:assert/strict";
import type { LessonDiagnostic, LessonRuntime } from "../../../lib/lesson-runtime/lesson-runtime";
import { COUNTING_NODE_IDS, COUNTING_LESSON_GRAPH } from "../../../lib/lesson-runtime/counting-lesson";
import { CLASSIFIER_VERSION } from "../../../lib/lesson-runtime/conversation-observer-contract";
import { parseLiveClassificationDiagnostic } from "../../../lib/lesson-runtime/live-classification-diagnostic";
import {
  reduceLessonRuntime,
  runtimeSource,
  type LessonRuntimeEvent,
  type LessonRuntimeState,
} from "../../../lib/lesson-runtime/lesson-runtime-reducer";
import { matchesLessonEvent } from "../../helpers/lesson-observer";
import { scopeFromEvent } from "../../helpers/child-scenario";

export type Report = ReturnType<LessonRuntime["report"]>;
export type Change = { trigger: LessonRuntimeEvent["type"]; before: LessonRuntimeState; after: LessonRuntimeState };
export const detail = <T>(event: LessonDiagnostic) => event.detail as T;
export const transitions = (events: readonly LessonDiagnostic[]) =>
  events.filter(
    event =>
      event.type === "runtime.changed" &&
      detail<Change>(event).before.phase === "active" &&
      detail<Change>(event).after.phase === "rendering",
  );
const same = (a: LessonDiagnostic, b: LessonDiagnostic) => matchesLessonEvent(a, scopeFromEvent(b));

export function classifierEvidence(events: readonly LessonDiagnostic[], result: LessonDiagnostic) {
  const index = events.findIndex(
    event => event.type === result.type && event.atMs === result.atMs && same(event, result),
  );
  assert(index >= 0, "result absent from production journal");
  const prior = events.slice(0, index);
  const request = prior.findLast(event => event.type === "classifier.started" && same(event, result));
  assert(request, "exact classifier request identity missing");
  const current = prior.findLast(event => event.type === "runtime.changed");
  assert(current, "runtime state missing at result boundary");
  const state = detail<Change>(current).after;
  assert(
    matchesLessonEvent(result, {
      ...runtimeSource(state),
      nodeId: state.nodeId,
      transcriptRevision: state.transcriptRevision,
    }),
    "classifier result is stale relative to runtime",
  );
  assert.equal(result.classifierVersion, CLASSIFIER_VERSION);
  assert.equal(request.classifierVersion, CLASSIFIER_VERSION);
  assert(
    !prior
      .slice(prior.indexOf(request) + 1)
      .some(event => event.type === "classifier.cancelled" && same(event, result)),
    "cancelled request supplied authority",
  );
  const mapping = prior.findLast(event => event.type === "classifier.mapping" && same(event, result));
  assert(mapping, "normalized classifier mapping missing");
  const diagnostic = parseLiveClassificationDiagnostic(mapping.detail);
  assert(diagnostic, "invalid canonical mapping");
  assert.equal(diagnostic.nodeId, result.nodeId);
  assert.equal(diagnostic.transcriptRevision, result.transcriptRevision);
  assert(Number.isFinite(detail<{ elapsedMs: number }>(result).elapsedMs));
  return { request, diagnostic };
}

const childText = (transcript: string) =>
  transcript
    .split("\n")
    .filter(line => line.startsWith("Child:"))
    .map(line => line.slice("Child:".length).trim())
    .join("\n");

/** Visit transcripts retain older turns. Remove their child prefix, then keep all
 * current-turn fragments even when tutor backchannels separate them. */
export function currentChildText(events: readonly LessonDiagnostic[], request: LessonDiagnostic) {
  const child = childText(detail<{ transcript: string }>(request).transcript);
  const older = events
    .slice(0, events.indexOf(request))
    .findLast(
      event =>
        event.type === "transcript.snapshot" &&
        event.runtimeId === request.runtimeId &&
        event.visitId === request.visitId &&
        event.nodeId === request.nodeId &&
        event.childTurnId! < request.childTurnId!,
    );
  const prefix = older ? childText(detail<{ transcript: string }>(older).transcript) : "";
  assert(child.startsWith(prefix), "older child transcript prefix differs from request");
  return child.slice(prefix.length).trim();
}

/** Production verdict is the semantic oracle. Text checks only establish what speech was actually heard. */
export function assertSettledCorrection(events: readonly LessonDiagnostic[]) {
  const results = events.filter(event => event.type === "classifier.result" && event.nodeId === "count-2-ducks");
  assert(results.length > 0, "no correction authority observed");
  for (const result of results) {
    const { request } = classifierEvidence(events, result);
    const child = currentChildText(events, request).replaceAll("\n", " ");
    assert(
      /\b(?:three|3)\b.*\bi mean\b.*\b(?:two|2)\b/i.test(child),
      "correct authority preceded the settled self-correction transcript",
    );
  }
}

export function assertWrongWindow(
  events: readonly LessonDiagnostic[],
  visitId: number,
  fromMs: number,
  untilMs: number,
  minimumMs = 3000,
) {
  assert(untilMs - fromMs >= minimumMs, "wrong-answer observation window shorter than 3 seconds");
  const window = events.filter(event => event.atMs >= fromMs && event.atMs <= untilMs);
  assert.equal(
    transitions(window).filter(event => detail<Change>(event).before.visitId === visitId).length,
    0,
    "wrong answer advanced scene",
  );
  assert(
    !window.some(event => event.visitId === visitId && event.type === "classifier.result"),
    "wrong answer received success authority",
  );
  assert(!window.some(event => event.type === "lesson.ended"), "lesson ended during wrong-answer hold");
}

export function assertWrongDecision(events: readonly LessonDiagnostic[], event: LessonDiagnostic) {
  return assertHoldDecision(events, event, /\b(?:three|3)\b/i);
}

export function assertHoldDecision(events: readonly LessonDiagnostic[], event: LessonDiagnostic, heard: RegExp) {
  assert(
    ["classifier.held", "classifier.abstained"].includes(event.type),
    "unresolved response received success authority",
  );
  assert.equal(detail<{ proposal: unknown }>(event).proposal, null);
  const { request, diagnostic } = classifierEvidence(events, event);
  assert(
    heard.test(currentChildText(events, request).replaceAll("\n", " ")),
    "intended utterance absent from current child turn",
  );
  assert(diagnostic.outputs, "hold decision lacks valid classifier scores");
  assert.equal(diagnostic.labelCompletionEligible, false);
  assert.notEqual(diagnostic.outputs.objectiveState.choice, "completed");
  if (event.type === "classifier.held") {
    assert.equal(diagnostic.decision, "accepted");
    assert.equal(diagnostic.outcome, "hold_scene");
  } else {
    assert.equal(diagnostic.decision, "abstained");
    assert.equal(diagnostic.outcome, "unresolved");
    assert(
      [
        "objectiveState_no_winner",
        "tutorState_no_winner",
        "objectiveState_competing_options",
        "tutorState_competing_options",
      ].includes(diagnostic.reason ?? ""),
      "provider failure is not a semantic abstention",
    );
  }
  return { request, diagnostic };
}

export function assertCompletedLesson(report: Report, correction = false) {
  assert.equal(report.classifierVersion, CLASSIFIER_VERSION);
  assert.equal(report.status, "ended");
  assert.equal(report.error, null);
  assert.equal(report.runtime?.phase, "complete");
  assert.equal(report.runtime.lessonComplete, true);
  const events = report.events;
  assert(
    events.every(event => event.runtimeId === report.runtimeId),
    "mixed runtime journal",
  );
  const advances = transitions(events);
  assert.equal(advances.length, COUNTING_NODE_IDS.length, "exactly one success transition per visit required");
  for (const [index, nodeId] of COUNTING_NODE_IDS.entries()) {
    const visitId = index + 1;
    const advance = advances[index];
    const { before, after, trigger } = detail<Change>(advance);
    assert.equal(before.nodeId, nodeId);
    assert.equal(before.visitId, visitId);
    assert.equal(after.visitId, visitId + 1);
    const origin = after.pendingRender!.origin;
    assert.deepEqual(origin, { ...runtimeSource(before), nodeId, transcriptRevision: before.transcriptRevision });
    const prior = events.slice(0, events.indexOf(advance));
    const result = prior.findLast(event => event.type === "classifier.result" && matchesLessonEvent(event, origin));
    assert(result, "no fresh success classifier for transition origin");
    const { request, diagnostic } = classifierEvidence(events, result);
    assert.equal(diagnostic.outcome, "allow_semantic_completion_evidence");
    assert.equal(diagnostic.outputs?.objectiveState.choice, "completed");
    assert.equal(diagnostic.outputs?.tutorState.choice, "confirmed_completion");
    assert.equal(result.transcriptSpeaker, "tutor");
    const transcript = detail<{ transcript: string }>(request).transcript;
    const heardChild = currentChildText(events, request);
    const quantity = COUNTING_LESSON_GRAPH[nodeId].quantity;
    const expected = ["one", "two", "three"][quantity - 1];
    assert(
      heardChild && new RegExp(`\\b(?:${expected}|${quantity})\\b`, "i").test(heardChild),
      "authored child answer absent from success transcript",
    );
    assert(/Child:\s*\S/.test(transcript) && /Tutor:\s*\S/.test(transcript), "missing child/tutor transcript evidence");
    const received = prior.findLast(
      event => event.type === "runtime.event.proposal.received" && matchesLessonEvent(event, origin),
    );
    assert(
      received && detail<{ accepted: boolean }>(received).accepted,
      "proposal was not accepted by production reducer",
    );
    const receivedEvent = detail<{ event: Extract<LessonRuntimeEvent, { type: "proposal.received" }> }>(received).event;
    assert.deepEqual(receivedEvent.source, origin, "accepted proposal source differs from transition origin");
    assert.deepEqual(
      receivedEvent.proposal,
      detail<{ proposal: unknown }>(result).proposal,
      "classifier result differs from accepted proposal",
    );
    // Replay only the recorded transition trigger through the production contract; no harness gates replace it.
    const event: LessonRuntimeEvent =
      trigger === "clock.tick"
        ? { type: "clock.tick", source: runtimeSource(before), atMs: after.nowMs }
        : detail<{ event: LessonRuntimeEvent }>(prior.findLast(event => event.type === `runtime.event.${trigger}`)!)
            .event;
    const replay = reduceLessonRuntime(before, event);
    assert.deepEqual(replay.state, after, "transition differs from production reducer");
    assert.equal(replay.effects[0]?.type, "render.requested");
    assert.equal(before.childSpeaking, false);
    assert.equal(before.outputActivity, "quiet");
    assert.equal(before.tutorOutputObserved, true);
    assert(before.quietSinceMs !== null && after.nowMs - before.quietSinceMs >= before.quietDrainMs);
    // Evidence must be relevant to this ended child turn, rather than an earlier question's PCM.
    const turn = prior.findLast(
      event =>
        event.type === "runtime.event.child.turn.ended" &&
        event.visitId === visitId &&
        event.childTurnId === origin.childTurnId,
    );
    assert(turn, "confirmed child turn never ended");
    for (const type of ["microphone.speech_started", "microphone.speech_stopped"]) {
      assert(
        prior.some(
          event => event.type === type && event.visitId === visitId && event.childTurnId === origin.childTurnId,
        ),
        `missing app-owned VAD ${type}`,
      );
    }

    assert(
      prior.some(
        event =>
          event.type === "output.activity" &&
          event.visitId === visitId &&
          event.childTurnId === origin.childTurnId &&
          event.atMs > turn.atMs &&
          detail<{ state: string }>(event).state === "active",
      ),
      "missing post-answer tutor output onset",
    );
    const requested = events.find(event => event.type === "render.requested" && event.visitId === after.visitId);
    assert(requested);
    assert.deepEqual(detail<{ identity: unknown }>(requested).identity, after.pendingRender!.identity);
    const rendered = events.find(event => event.type === "render.confirmed" && event.visitId === after.visitId);
    assert(
      rendered && events.indexOf(rendered) > events.indexOf(requested),
      "render confirmation missing or premature",
    );
    assert.deepEqual(detail<{ identity: unknown }>(rendered).identity, after.pendingRender!.identity);
    const edge = COUNTING_LESSON_GRAPH[nodeId].onSuccess;
    assert.equal(after.pendingRender!.identity.nodeId, edge.kind === "node" ? edge.nodeId : null);
    const nextSteering = events.find(
      event => event.type === "gpt_live.steering_append" && event.visitId === after.visitId,
    );
    if (edge.kind === "node") {
      assert(
        nextSteering && events.indexOf(nextSteering) > events.indexOf(rendered),
        "next steering preceded exact render confirmation",
      );
      assert.equal(detail<{ renderToken: string }>(nextSteering).renderToken, after.pendingRender!.identity.token);
    } else assert.equal(nextSteering, undefined, "steering after final completion");
  }
  const ended = events.filter(event => event.type === "lesson.ended");
  assert.equal(ended.length, 1);
  assert.equal(detail<{ reason: string }>(ended[0]).reason, "lesson_completed");
  const completed = events.findLastIndex(event => event.type === "lesson.completed");
  assert(completed >= 0 && events.indexOf(ended[0]) > completed, "completion effect missing before end");
  if (correction) assertSettledCorrection(events);
}
