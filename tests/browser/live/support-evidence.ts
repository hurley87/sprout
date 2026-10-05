import assert from "node:assert/strict";
import type { LessonDiagnostic } from "../../../lib/lesson-runtime/lesson-runtime";
import type { Checkpoint } from "../../helpers/child-scenario";
import {
  assertHoldDecision,
  assertWrongWindow,
  classifierEvidence,
  currentChildText,
  detail,
  type Report,
} from "./evidence";

export const HOLD_MS = 3000;
export const SILENCE_MS = 5000;

export function assertHoldWindow(
  report: Report,
  from: Checkpoint,
  fromMs: number,
  untilMs: number,
  minimumMs = HOLD_MS,
) {
  assert.equal(report.runtimeId, from.scope.runtimeId, "attempt identity changed");
  assert.equal(report.status, "live", "hold ended unexpectedly");
  assert.equal(report.error, null, "provider/runtime failure during hold");
  assert.equal(report.runtime?.visitId, from.scope.visitId, "hold visit changed");
  assertWrongWindow(report.events, from.scope.visitId!, fromMs, untilMs, minimumMs);
  for (const event of report.events.slice(from.after.offset)) {
    if (event.atMs > untilMs) continue;
    assert(
      !["render.requested", "render.confirmed", "lesson.completed", "gpt_live.steering_append"].includes(event.type),
      "render or steering during unresolved hold",
    );
    assert(
      !["classifier.error", "classifier.mapping_unavailable"].includes(event.type),
      "provider failure or missing diagnostics during hold",
    );
    if (["classifier.held", "classifier.abstained"].includes(event.type)) {
      // All decisions in the window must be semantic, even if a later one is valid.
      assertHoldDecision(report.events, event, /[\s\S]*/);
    }
  }
}

export function assertUnresolvedSpeech(
  events: readonly LessonDiagnostic[],
  event: LessonDiagnostic,
  from: Checkpoint,
  heard: RegExp,
  scaffold = false,
) {
  assert.equal(event.runtimeId, from.scope.runtimeId);
  assert.equal(event.visitId, from.scope.visitId);
  assert.equal(event.nodeId, from.scope.nodeId);
  assert(event.childTurnId! > from.scope.childTurnId!, "decision borrowed an earlier child turn");
  const evidence = assertHoldDecision(events, event, heard);
  const prior = events.slice(from.after.offset, events.indexOf(evidence.request));
  const turnEnded = prior.findLast(
    e => e.type === "runtime.event.child.turn.ended" && e.childTurnId === event.childTurnId,
  );
  assert(turnEnded, "unresolved utterance has no confirmed ended child turn");
  for (const type of ["microphone.speech_started", "microphone.speech_stopped"]) {
    assert(
      prior.some(e => e.type === type && e.childTurnId === event.childTurnId),
      `unresolved utterance missing app-owned VAD ${type}`,
    );
  }
  if (scaffold) {
    assert.equal(evidence.diagnostic.outputs?.tutorState.choice, "helping", "no classified tutor scaffold observed");
    assert(
      prior.some(
        e =>
          e.type === "transcript.snapshot" &&
          e.transcriptSpeaker === "tutor" &&
          e.atMs > turnEnded.atMs &&
          e.childTurnId === event.childTurnId,
      ),
      "scaffold tutor transcript missing",
    );
    assert(
      prior.some(
        e =>
          e.type === "output.activity" &&
          e.atMs > turnEnded.atMs &&
          e.childTurnId === event.childTurnId &&
          detail<{ state: string }>(e).state === "active",
      ),
      "scaffold tutor audio onset missing",
    );
  }
  return evidence;
}

export function assertFreshRecovery(report: Report, from: Checkpoint) {
  const results = report.events
    .slice(from.after.offset)
    .filter(e => e.type === "classifier.result" && e.visitId === from.scope.visitId);
  assert(results.length > 0, "missing recovery success authority");
  for (const result of results) {
    assert(result.childTurnId! > from.scope.childTurnId!, "recovery borrowed pre-answer authority");
    const { request } = classifierEvidence(report.events, result);
    assert(/\b(?:two|2)\b/i.test(currentChildText(report.events, request)), "fresh learner recovery total missing");
  }
}

export function assertStoppedWindow(report: Report, from: Checkpoint, fromMs: number, untilMs: number) {
  assert(untilMs - fromMs >= HOLD_MS, "stop observation shorter than three seconds");
  assert.equal(report.runtimeId, from.scope.runtimeId);
  assert.equal(report.status, "ended");
  assert.equal(report.error, null);
  assert.equal(report.runtime?.phase, "stopped");
  assert.equal(report.runtime.visitId, from.scope.visitId);
  const events = report.events.slice(from.after.offset);
  const ended = events.filter(e => e.type === "lesson.ended");
  assert.equal(ended.length, 1, "parent Stop end missing or duplicated");
  assert.equal(detail<{ reason: string }>(ended[0]).reason, "parent_stop");
  assert(
    !events.some(e =>
      [
        "render.requested",
        "render.confirmed",
        "lesson.completed",
        "classifier.result",
        "gpt_live.steering_append",
      ].includes(e.type),
    ),
    "progression authority or render after Stop checkpoint",
  );
  assert(
    !events.some(
      e =>
        e.type === "runtime.changed" && detail<{ after: { visitId: number } }>(e).after.visitId !== from.scope.visitId,
    ),
    "transient progression after Stop",
  );
}
