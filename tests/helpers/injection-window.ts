import type { Page } from "@playwright/test";
import { setTimeout as delay } from "node:timers/promises";
import type { LessonObservationWindow } from "../../lib/lesson-runtime/browser-observation";
import type { LessonDiagnostic, LessonObservation } from "../../lib/lesson-runtime/lesson-runtime";
import type { Checkpoint } from "./child-scenario";
import type { MicrophoneControl, NoiseOptions, Playback, SpeechFixture } from "./synthetic-microphone";

export type InjectionTiming = "during-output" | "confirmation-quiet" | "classifier-in-flight";
export type WindowRequest = {
  from: Checkpoint;
  timing: InjectionTiming;
  audio: { fixture: SpeechFixture } | { noise: NoiseOptions };
};
export type WindowEvidence = {
  request: WindowRequest;
  atMs: number;
  afterStartMs: number;
  cursor: LessonObservation["cursor"];
  state: NonNullable<LessonObservation["snapshot"]["runtime"]>;
  afterState: NonNullable<LessonObservation["snapshot"]["runtime"]>;
  trigger: LessonDiagnostic;
  output: LessonDiagnostic;
  child: LessonDiagnostic;
  tutor: LessonDiagnostic | null;
  playback: Playback;
};

/** Runs in ONE browser task: read current state, validate a fresh window, start already
 * decoded audio, then capture the same attempt clock. No awaited round trip between check/start.
 * Self-contained so Playwright can serialize it; local tests exercise this exact function. */
export function attemptWindowInjection(request: WindowRequest): WindowEvidence | null {
  const host = window as unknown as LessonObservationWindow & { syntheticMicrophone: MicrophoneControl };
  const value = host.sproutLessonObservation?.read();
  if (!value) throw new Error("Attempt detached before injection");
  const { from, timing } = request;
  const state = value.snapshot.runtime;
  if (value.cursor.runtimeId !== from.after.runtimeId) throw new Error("Attempt restarted before injection");
  if (!state || state.visitId !== from.scope.visitId || state.nodeId !== from.scope.nodeId)
    throw new Error("Target visit already left before injection");
  if (value.snapshot.status !== "live" || state.phase !== "active") throw new Error("Target is no longer active");
  if (state.childSpeaking || value.snapshot.awaitingSteering || state.childTurnId <= from.scope.childTurnId!)
    return null;
  const fresh = value.events
    .slice(from.after.offset)
    .filter(
      e =>
        e.runtimeId === value.cursor.runtimeId &&
        e.visitId === state.visitId &&
        e.nodeId === state.nodeId &&
        e.childTurnId === state.childTurnId,
    );
  const child = fresh.findLast(e => e.type === "transcript.snapshot" && e.transcriptSpeaker === "child");
  const ended = fresh.findLast(e => e.type === "runtime.event.child.turn.ended");
  if (!child || !ended || !state.hasChildTranscript) return null;
  // Establish what the provider actually heard. The harness grants no semantic authority.
  // Snapshots accumulate the visit transcript. Reconstruct each speaker's fragments,
  // removing the pre-answer prefix so earlier speech cannot satisfy this window.
  const speakerText = (event: LessonDiagnostic | undefined | null, speaker: "Child" | "Tutor") =>
    event
      ? (event.detail as { transcript: string }).transcript
          .split("\n")
          .filter(l => l.startsWith(`${speaker}:`))
          .map(l => l.slice(speaker.length + 1).trim())
          .join(" ")
      : "";
  const beforeAnswer = value.events
    .slice(0, value.events.indexOf(child))
    .findLast(
      (e, index) =>
        e.type === "transcript.snapshot" &&
        e.runtimeId === state.runtimeId &&
        e.visitId === state.visitId &&
        e.nodeId === state.nodeId &&
        (index < from.after.offset || e.childTurnId! < state.childTurnId),
    );
  const answerText = (event: LessonDiagnostic, speaker: "Child" | "Tutor") => {
    const text = speakerText(event, speaker);
    const prefix = speakerText(beforeAnswer, speaker);
    return text.startsWith(prefix) ? text.slice(prefix.length).trim() : "";
  };
  // ASR may omit hesitation words; require the current learner's total instead.
  if (!/\b(?:three|3)\b/i.test(answerText(child, "Child"))) return null;
  const output = fresh.findLast(e => e.type === "output.activity");
  const active = fresh.findLast(
    e => e.type === "output.activity" && (e.detail as { state: string }).state === "active",
  );
  if (!output || !active || active.atMs < ended.atMs) return null;
  const tutor =
    fresh.findLast(e => e.type === "transcript.snapshot" && e.transcriptSpeaker === "tutor" && e.atMs >= ended.atMs) ??
    null;
  let trigger = output;
  if (timing === "during-output") {
    if (state.outputActivity !== "active" || (output.detail as { state: string }).state !== "active") return null;
  } else {
    // A wording-specific regression needs audible confirmation evidence before the late burst.
    // Canonical scores determine completion separately; these words only select injection timing.
    const tutorText = tutor && answerText(tutor, "Tutor");
    if (!tutorText || !/\b(?:yes|right|correct|great|good|got it)\b.*\b(?:three|3)\b/i.test(tutorText)) return null;
    if (state.outputActivity !== "quiet" || (output.detail as { state: string }).state !== "quiet") return null;
    if (timing === "confirmation-quiet") {
      // Require a currently outstanding stabilization schedule, not an old quiet event.
      const work = fresh.findLast(e =>
        ["tutor_stabilization.scheduled", "tutor_stabilization.cancelled", "tutor_stabilization.ready"].includes(
          e.type,
        ),
      );
      if (
        !work ||
        work.type !== "tutor_stabilization.scheduled" ||
        work.transcriptRevision !== state.transcriptRevision
      )
        return null;
      const dueMs = work.atMs + (work.detail as { delayMs: number }).delayMs;
      if (value.nowMs >= dueMs || value.nowMs - output.atMs > 1000) return null;
      trigger = work;
    } else {
      const work = fresh.findLast(e =>
        [
          "classifier.started",
          "classifier.cancelled",
          "classifier.result",
          "classifier.held",
          "classifier.abstained",
          "classifier.error",
        ].includes(e.type),
      );
      if (
        !work ||
        work.type !== "classifier.started" ||
        work.transcriptRevision !== state.transcriptRevision ||
        work.transcriptSpeaker !== "tutor"
      )
        return null;
      trigger = work;
    }
  }
  if (host.syntheticMicrophone.state().activeSources !== 0) return null;
  const playback =
    "fixture" in request.audio
      ? host.syntheticMicrophone.speech(request.audio.fixture)
      : host.syntheticMicrophone.noise(request.audio.noise);
  const after = host.sproutLessonObservation!.read()!;
  return {
    request,
    atMs: value.nowMs,
    afterStartMs: after.nowMs,
    cursor: value.cursor,
    state,
    afterState: after.snapshot.runtime!,
    trigger,
    output,
    child,
    tutor,
    playback,
  };
}

export async function injectInWindow(page: Page, request: WindowRequest, signal: AbortSignal, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  do {
    signal.throwIfAborted();
    const result = await page.evaluate(attemptWindowInjection, request);
    if (result) return result;
    await delay(10, undefined, { signal });
  } while (Date.now() < deadline);
  const missing = await page.evaluate(diagnoseWindowMiss, request);
  throw new Error(`Missed current ${request.timing} injection window; no audio injected. ${JSON.stringify(missing)}`);
}

/** Timeout explanation only. Never grants permission to inject or substitutes tutor text
 * for current learner evidence. Read in the browser so diagnosis uses the attempt clock. */
export function diagnoseWindowMiss(request: WindowRequest) {
  const value = (window as LessonObservationWindow).sproutLessonObservation?.read();
  if (!value) return { reason: "attempt_detached" };
  const state = value.snapshot.runtime;
  if (!state || value.cursor.runtimeId !== request.from.after.runtimeId || state.visitId !== request.from.scope.visitId)
    return { reason: "target_identity_changed", atMs: value.nowMs };
  const fresh = value.events
    .slice(request.from.after.offset)
    .filter(
      e =>
        e.runtimeId === state.runtimeId &&
        e.visitId === state.visitId &&
        e.nodeId === state.nodeId &&
        e.childTurnId === state.childTurnId,
    );
  const child = fresh.findLast(e => e.type === "transcript.snapshot" && e.transcriptSpeaker === "child");
  const ended = fresh.findLast(e => e.type === "runtime.event.child.turn.ended");
  const blocked = fresh.findLast(e => e.type === "classifier.blocked");
  const work = fresh.findLast(e => e.type.startsWith("classifier.") || e.type.startsWith("tutor_stabilization."));
  return {
    reason:
      !child || !state.hasChildTranscript
        ? "missing_current_turn_child_transcript"
        : !ended
          ? "missing_confirmed_turn_end"
          : "requested_current_window_not_observed",
    explanation:
      !child || !state.hasChildTranscript
        ? "VAD or tutor paraphrasing cannot replace the learner transcript; check fixture recognition before retrying."
        : "See output/transcript/work ordering in the saved production timeline.",
    atMs: value.nowMs,
    runtimeId: state.runtimeId,
    visitId: state.visitId,
    childTurnId: state.childTurnId,
    transcriptRevision: state.transcriptRevision,
    hasChildTranscript: state.hasChildTranscript,
    outputActivity: state.outputActivity,
    childSnapshot: child ?? null,
    turnEnded: ended ?? null,
    blocked: blocked ?? null,
    latestWork: work ?? null,
  };
}
