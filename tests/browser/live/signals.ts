import { LESSON_TIMING, type LessonObservation } from "../../../lib/lesson-runtime/lesson-runtime";
import type { CountingNodeId } from "../../../lib/lesson-runtime/counting-lesson";
import { detail } from "./evidence";

/** Audio quiet is a physical signal; combine it with transcript settlement, never call it semantic completion. */
export function settledTutorResponse(value: LessonObservation, offset: number) {
  const events = value.events.slice(offset);
  const tutor = events.findLast(event => event.type === "transcript.snapshot" && event.transcriptSpeaker === "tutor");
  const active = events.findLast(
    event => event.type === "output.activity" && detail<{ state: string }>(event).state === "active",
  );
  const quiet = events.findLast(
    event => event.type === "output.activity" && detail<{ state: string }>(event).state === "quiet",
  );
  return Boolean(
    value.snapshot.runtime?.phase === "active" &&
    !value.snapshot.runtime.childSpeaking &&
    tutor &&
    active &&
    quiet &&
    quiet.atMs > active.atMs &&
    value.snapshot.runtime.outputActivity === "quiet" &&
    value.nowMs - tutor.atMs >= LESSON_TIMING.tutorTranscriptStableMs &&
    value.nowMs - quiet.atMs >= LESSON_TIMING.tutorClassificationQuietMs,
  );
}

export function settledPrompt(value: LessonObservation, nodeId: CountingNodeId, visitId: number, runtimeId: string) {
  const state = value.snapshot.runtime;
  const events = value.events.filter(event => event.visitId === visitId && event.runtimeId === runtimeId);
  const steering = events.find(event => event.type === "gpt_live.steering_append");
  const ack =
    steering &&
    events.find(
      event =>
        event.type === "gpt_live.context_appended" &&
        detail<{ name: string; clientEventId: string }>(event).name === "session.instructions.appended" &&
        detail<{ clientEventId: string }>(event).clientEventId === detail<{ eventId: string }>(steering).eventId,
    );
  const boundary =
    ack &&
    events.find(event => event.type === "transcript.visit_boundary" && events.indexOf(event) > events.indexOf(ack));
  return Boolean(
    value.cursor.runtimeId === runtimeId &&
    state?.nodeId === nodeId &&
    state.visitId === visitId &&
    !value.snapshot.awaitingSteering &&
    boundary &&
    settledTutorResponse({ ...value, events }, 0),
  );
}
