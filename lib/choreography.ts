import type { LocalPlaybackEvent, PlaybackIdentity } from "./events";

export type ChoreographyPhase =
  | "accepted_pending_ack"
  | "ack_playing"
  | "ack_draining"
  | "ack_completed"
  | "transition_waiting_display"
  | "next_question_pending"
  | "next_question_released"
  | "superseded"
  | "stopped"
  | "failed";
export type DisplayIdentity = { sceneId: string; displayedAtMs: number; token: string };
export type LocalPlaybackTimeline = Omit<LocalPlaybackEvent, "type"> & {
  type: "local_playback";
  provenance: "application_finite_audio";
  role: "acknowledgment" | "instructional_help" | "clarification";
  text: string;
  display: DisplayIdentity;
  /** Explicit local-to-session mapping; absent when no canonical origin exists. */
  sessionClockOrigin?: number;
  sessionAtMs?: number;
};
export type ChoreographyTimeline = {
  type: "choreography_phase";
  provenance: "application_controller";
  sessionAttemptId: string;
  choreographyEpoch: number;
  correlationKey: string;
  phase: ChoreographyPhase;
  display: DisplayIdentity;
  questionToken: string;
  questionStatus: "pending" | "authorized_delivery_unknown" | "cancelled";
  reason?: string;
  /** Canonical child fragment keys. These fragments have no established scene
   * during a pending transition and never become next-question answers. */
  transitionFragmentKeys?: string[];
};
export function immutable<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(immutable);
    Object.freeze(value);
  }
  return value;
}
export function samePlayback(left: PlaybackIdentity, right: PlaybackIdentity) {
  return (
    left.sessionAttemptId === right.sessionAttemptId &&
    left.originSourceId === right.originSourceId &&
    left.owningSourceId === right.owningSourceId &&
    left.evaluatedSceneIndex === right.evaluatedSceneIndex &&
    left.transcriptRevision === right.transcriptRevision &&
    left.answerVersion === right.answerVersion &&
    left.correlationKey === right.correlationKey &&
    left.choreographyEpoch === right.choreographyEpoch &&
    left.playbackAttemptId === right.playbackAttemptId &&
    sameValue(left.responseIdentity, right.responseIdentity)
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const a = Object.entries(left).filter(([, value]) => value !== undefined);
  const b = Object.entries(right).filter(([, value]) => value !== undefined);
  return a.length === b.length && a.every(([key, value]) => sameValue(value, (right as Record<string, unknown>)[key]));
}
