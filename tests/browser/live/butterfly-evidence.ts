import assert from "node:assert/strict";
import type { WindowEvidence } from "../../helpers/injection-window";
import { matchesLessonEvent } from "../../helpers/lesson-observer";
import { scopeFromEvent } from "../../helpers/child-scenario";
import {
  assertCompletedLesson,
  classifierEvidence,
  currentChildText,
  detail,
  transitions,
  type Report,
  type Change,
} from "./evidence";

export const BUTTERFLY_OBSERVATION_MS = 8000;

export function assertInjectionWindow(report: Report, landed: WindowEvidence) {
  const { state, afterState, request, atMs, afterStartMs, cursor } = landed;
  assert.equal(report.runtimeId, cursor.runtimeId);
  assert.equal(state.runtimeId, cursor.runtimeId);
  assert.equal(state.visitId, request.from.scope.visitId);
  assert.equal(state.nodeId, "count-3-butterflies");
  assert.equal(state.phase, "active");
  assert.equal(state.childSpeaking, false);
  assert(state.childTurnId > request.from.scope.childTurnId!, "old answer window");
  for (const key of [
    "runtimeId",
    "visitId",
    "nodeId",
    "childTurnId",
    "transcriptRevision",
    "phase",
    "outputActivity",
  ] as const)
    assert.equal(afterState[key], state[key], `identity/window changed at audio start: ${key}`);
  assert(afterStartMs >= atMs && afterStartMs - atMs <= 100, "audio start clock evidence missing or delayed");
  const prior = report.events.slice(request.from.after.offset, cursor.offset);
  const present = (event: WindowEvidence["trigger"]) => {
    assert(
      prior.some(e => JSON.stringify(e) === JSON.stringify(event)),
      "trigger evidence absent from fresh journal",
    );
    assert.equal(event.runtimeId, state.runtimeId);
    assert.equal(event.visitId, state.visitId);
    assert.equal(event.nodeId, state.nodeId);
    assert.equal(event.childTurnId, state.childTurnId);
    assert(event.atMs <= atMs);
  };
  for (const event of [landed.child, landed.trigger, landed.output]) present(event);
  const output = prior.findLast(e => e.type === "output.activity");
  assert.deepEqual(output, landed.output, "old output event used as current window");
  assert.equal(detail<{ state: string }>(output!).state, state.outputActivity);
  const ended = prior.findLast(e => e.type === "runtime.event.child.turn.ended" && e.childTurnId === state.childTurnId);
  assert(ended, "answer not an ended confirmed child turn");
  assert(
    prior.some(
      e =>
        e.type === "output.activity" &&
        e.childTurnId === state.childTurnId &&
        e.atMs >= ended.atMs &&
        detail<{ state: string }>(e).state === "active",
    ),
    "no post-answer output",
  );
  const current = report.events.slice(0, cursor.offset).findLast(e => e.type === "runtime.changed");
  assert(current);
  assert.deepEqual(detail<Change>(current).after, state, "captured state differs from journal at injection");
  if (request.timing === "during-output") assert.equal(state.outputActivity, "active");
  else {
    assert.equal(state.outputActivity, "quiet");
    assert(landed.tutor, "confirmation transcript absent");
    present(landed.tutor);
    assert.equal(landed.trigger.transcriptRevision, state.transcriptRevision);
    if (request.timing === "confirmation-quiet") {
      assert.equal(landed.trigger.type, "tutor_stabilization.scheduled");
      assert(
        atMs < landed.trigger.atMs + detail<{ delayMs: number }>(landed.trigger).delayMs,
        "expired stabilization window",
      );
      assert(atMs - landed.output.atMs <= 1000, "confirmation quiet window too old");
      assert.deepEqual(
        prior.findLast(e =>
          ["tutor_stabilization.scheduled", "tutor_stabilization.cancelled", "tutor_stabilization.ready"].includes(
            e.type,
          ),
        ),
        landed.trigger,
      );
    } else {
      assert.equal(landed.trigger.type, "classifier.started");
      assert.equal(landed.trigger.transcriptSpeaker, "tutor");
      assert.deepEqual(
        prior.findLast(e =>
          [
            "classifier.started",
            "classifier.cancelled",
            "classifier.result",
            "classifier.held",
            "classifier.abstained",
            "classifier.error",
          ].includes(e.type),
        ),
        landed.trigger,
        "classifier no longer in flight",
      );
    }
  }
}

/** Applies to probes and strict tests. No cancelled/stale identity may supply authority. */
export function assertButterflySafety(report: Report, landed: WindowEvidence, bargeIn: boolean) {
  assertInjectionWindow(report, landed);
  assert.equal(report.error, null, "provider/runtime error is not a cancellation outcome");
  assert(
    report.events.every(e => e.runtimeId === report.runtimeId),
    "mixed attempt evidence",
  );
  assert(
    !report.events.some(e => ["classifier.error", "classifier.mapping_unavailable"].includes(e.type)),
    "provider failure or missing canonical diagnostic",
  );
  const postInjection = report.events.slice(landed.cursor.offset);
  const onset = postInjection.find(e => ["microphone.activity_started", "microphone.speech_started"].includes(e.type));
  assert(
    onset && onset.atMs >= landed.atMs && onset.atMs <= landed.afterStartMs + 250,
    "injected audio has no timely app-owned microphone onset",
  );
  assert.equal(onset.visitId, landed.state.visitId, "microphone onset landed in another visit");
  const atOnset = report.events.slice(0, report.events.indexOf(onset)).findLast(e => e.type === "runtime.changed");
  assert(atOnset);
  if (landed.request.timing === "during-output")
    assert.equal(detail<Change>(atOnset).after.outputActivity, "active", "VAD onset missed tutor output window");
  assert(
    postInjection.some(
      e => ["microphone.activity_discarded", "microphone.speech_stopped"].includes(e.type) && e.atMs >= onset.atMs,
    ),
    "injected activity never discarded or ended",
  );
  const advances = transitions(report.events).filter(e => detail<Change>(e).before.visitId === landed.state.visitId);
  assert(advances.length <= 1, "duplicate butterfly completion");
  for (const result of report.events.filter(e =>
    ["classifier.result", "classifier.held", "classifier.abstained"].includes(e.type),
  ))
    if (result.type === "classifier.result") classifierEvidence(report.events, result);
    else {
      const { diagnostic } = classifierEvidence(report.events, result);
      assert.equal(detail<{ proposal: unknown }>(result).proposal, null);
      assert(diagnostic.outputs, "held decision lacks canonical scores");
      if (result.type === "classifier.held") {
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
            "confirmation_without_completion",
          ].includes(diagnostic.reason ?? ""),
          "provider failure is not semantic held evidence",
        );
      }
    }
  if (advances.length) assertButterflyCompletion(report, landed);
  else {
    assert.equal(report.status, "live", "unexpected terminal state");
    assert.equal(report.runtime?.phase, "active");
    assert.equal(report.runtime.visitId, landed.state.visitId);
    assert(
      !report.events
        .slice(landed.cursor.offset)
        .some(e =>
          ["render.requested", "render.confirmed", "lesson.completed", "gpt_live.steering_append"].includes(e.type),
        ),
      "orphan render/steering while held",
    );
  }
  if (bargeIn) {
    const post = report.events.slice(landed.cursor.offset);
    const started = post.find(
      e => e.type === "runtime.event.child.turn.confirmed" || e.type === "runtime.event.child.turn.started",
    );
    const ended = post.find(
      e => e.type === "runtime.event.child.turn.ended" && e.childTurnId! > landed.state.childTurnId,
    );
    assert(started && ended, "genuine interruption not confirmed and ended by app-owned VAD");
    const confirmed = post.find(
      e =>
        e.type === "runtime.changed" &&
        ["child.turn.confirmed", "child.turn.started"].includes(detail<Change>(e).trigger),
    );
    assert(confirmed, "confirmed interruption state absent");
    const invalidated = detail<Change>(confirmed).after;
    assert.equal(invalidated.answerAccepted, false, "authority not invalidated at interruption");
    assert.equal(invalidated.acceptedAnswerRevision, null, "answer revision not invalidated at interruption");
    assert.equal(invalidated.acknowledgmentObserved, false, "earlier acknowledgment survived interruption");
    assert(invalidated.childTurnId > landed.state.childTurnId);
    assert(
      !post.some(e => e.type === "classifier.result" && e.childTurnId! <= landed.state.childTurnId),
      "old answer supplied post-interruption authority",
    );
    assert(
      post.some(e => e.type === "microphone.speech_started"),
      "barge-in missing speech VAD",
    );
    assert.equal(advances.length, 0, "barge-in reused earlier answer to complete");
    assert.equal(report.runtime?.answerAccepted, false, "earlier authority survived genuine interruption");
    assert.equal(report.runtime?.acceptedAnswerRevision, null, "earlier answer revision survived genuine interruption");
    const request = post.findLast(e => e.type === "classifier.started" && e.childTurnId === ended.childTurnId);
    assert(request, "barge-in never reevaluated");
    assert(
      /\bwait\b.*\bi want to say something\b/i.test(currentChildText(report.events, request).replaceAll("\n", " ")),
      "genuine barge-in words not heard in current turn",
    );
    const held = post.findLast(
      e =>
        ["classifier.held", "classifier.abstained"].includes(e.type) && matchesLessonEvent(e, scopeFromEvent(request)),
    );
    assert(held, "barge-in has no explicit fresh semantic held state");
    const { diagnostic } = classifierEvidence(report.events, held);
    assert(diagnostic.outputs, "barge-in hold lacks semantic scores");
    assert.equal(report.runtime?.childSpeaking, false);
  }
}

/** Observed categories are descriptive. Bounded starvation is never successful recovery. */
export function butterflySummary(report: Report, landed: WindowEvidence | null, untilMs: number, bargeIn: boolean) {
  if (!landed)
    return {
      outcome: report.runtime?.nodeId === "count-3-butterflies" ? "incomplete-trigger" : "prerequisite-not-reached",
      recoveryVerified: false,
      prerequisiteDiagnostic: report.events.findLast(e => e.type === "classifier.mapping") ?? null,
      latestTranscript: report.events.findLast(e => e.type === "transcript.snapshot") ?? null,
      finalState: { status: report.status, runtime: report.runtime, error: report.error },
    };
  const post = report.events.slice(landed.cursor.offset);
  const classified = post.filter(e =>
    ["classifier.result", "classifier.held", "classifier.abstained"].includes(e.type),
  );
  const cancelled = post.filter(e => ["classifier.cancelled", "tutor_stabilization.cancelled"].includes(e.type));
  const advanced = transitions(post).length > 0;
  const currentHold = classified.some(
    e =>
      ["classifier.held", "classifier.abstained"].includes(e.type) &&
      report.runtime &&
      matchesLessonEvent(e, {
        runtimeId: report.runtimeId,
        visitId: report.runtime.visitId,
        nodeId: report.runtime.nodeId,
        childTurnId: report.runtime.childTurnId,
        transcriptRevision: report.runtime.transcriptRevision,
      }),
  );
  let safe = false;
  let safetyFailure: string | null = null;
  try {
    assertButterflySafety(report, landed, bargeIn);
    safe = true;
  } catch (error) {
    safetyFailure = error instanceof Error ? error.message : String(error);
  }
  const outcome = !safe
    ? "unsafe-or-incomplete"
    : advanced
      ? "safely-progressed"
      : currentHold
        ? "explicit-held"
        : "bounded-starvation-or-pending";
  return {
    outcome,
    recoveryVerified: safe && advanced,
    safetyFailure,
    observationMs: untilMs - landed.atMs,
    requiredObservationMs: BUTTERFLY_OBSERVATION_MS,
    injection: landed,
    activity: post.filter(e => e.type.startsWith("microphone.") || e.type.startsWith("runtime.event.child.")),
    heard: post.filter(e => e.type.startsWith("transcript.")),
    // Preserve canonical objective/tutor scores, mapped outcome, reasons, latency and identities unchanged.
    classifier: post.filter(e => e.type.startsWith("classifier.") || e.type.startsWith("tutor_stabilization.")),
    work: {
      cancelled: cancelled.length,
      blocked: post.filter(e => e.type === "classifier.blocked").length,
      rescheduled: post.filter(e => ["classifier.scheduled", "tutor_stabilization.scheduled"].includes(e.type)).length,
      reevaluated: post.filter(e => e.type === "classifier.started").length,
      decisions: classified.length,
    },
    finalState: { status: report.status, runtime: report.runtime, error: report.error },
  };
}

/** Human-readable index; unchanged report/timeline retain the full event detail. */
export function formatButterflySummary(
  name: string,
  summary: ReturnType<typeof butterflySummary>,
  observeOnly: boolean,
) {
  const lines = [
    `Case: ${name}`,
    `Mode: ${observeOnly ? "evidence only; no recovery claim" : "strict product regression"}`,
    `Outcome: ${summary.outcome}`,
    `Safe completion verified: ${summary.recoveryVerified}`,
  ];
  if (!summary.injection)
    return (
      lines
        .concat(
          "No completed injection evidence; see harness failure.",
          `Latest prerequisite classifier: ${JSON.stringify(summary.prerequisiteDiagnostic)}`,
          `Latest transcript: ${JSON.stringify(summary.latestTranscript)}`,
          `Final: ${JSON.stringify(summary.finalState)}`,
        )
        .join("\n") + "\n"
    );
  const injection = summary.injection;
  lines.push(
    `Injected: ${JSON.stringify(injection.request.audio)} (${injection.playback.durationSeconds.toFixed(3)}s)`,
    `Window: ${injection.request.timing}; start ${injection.atMs.toFixed(3)}–${injection.afterStartMs.toFixed(3)}ms`,
    `Identity: runtime=${injection.state.runtimeId} visit=${injection.state.visitId} turn=${injection.state.childTurnId} revision=${injection.state.transcriptRevision}`,
    `Observed after start: ${(summary.observationMs ?? 0).toFixed(0)}ms (bounded target ${summary.requiredObservationMs}ms)`,
    `Work: ${JSON.stringify(summary.work)}`,
    `Safety failure: ${summary.safetyFailure ?? "none"}`,
  );
  for (const e of (summary.activity ?? []).filter(e => !e.type.startsWith("microphone.detector")))
    lines.push(`VAD/runtime ${e.atMs.toFixed(3)}ms turn=${e.childTurnId} ${e.type}`);
  for (const e of (summary.heard ?? []).filter(e => e.type === "transcript.snapshot"))
    lines.push(
      `Heard ${e.atMs.toFixed(3)}ms turn=${e.childTurnId} revision=${e.transcriptRevision}: ${detail<{ transcript: string }>(e).transcript}`,
    );
  for (const e of (summary.classifier ?? []).filter(e =>
    [
      "classifier.mapping",
      "classifier.cancelled",
      "classifier.blocked",
      "classifier.result",
      "classifier.held",
      "classifier.abstained",
    ].includes(e.type),
  ))
    lines.push(
      `Jev/work ${e.atMs.toFixed(3)}ms turn=${e.childTurnId} revision=${e.transcriptRevision} ${e.type}: ${JSON.stringify(e.detail)}`,
    );
  lines.push(`Final: ${JSON.stringify(summary.finalState)}`);
  return lines.join("\n") + "\n";
}

export function assertButterflyCompletion(report: Report, landed: WindowEvidence) {
  assertCompletedLesson(
    report,
    false,
    "noise" in landed.request.audio || landed.request.audio.fixture === "uh"
      ? {
          visitId: landed.state.visitId,
          answerTurnId: landed.state.childTurnId,
          afterMs: landed.atMs,
        }
      : undefined,
  );
}
