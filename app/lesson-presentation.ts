import type { LessonDefinition } from "@/lib/lesson-runtime/lesson-definition";
import type { LessonSnapshot } from "@/lib/lesson-runtime/lesson-runtime";
import { hasCurrentCompletionEvidence } from "@/lib/lesson-runtime/lesson-runtime-reducer";

type PresentationSnapshot = Pick<LessonSnapshot, "status" | "error" | "awaitingSteering"> & {
  runtime: Pick<NonNullable<LessonSnapshot["runtime"]>, "phase" | "childSpeaking" | "outputActivity"> | null;
};

export function lessonPresentation(snapshot: PresentationSnapshot | null) {
  if (snapshot?.error)
    return {
      kind: "error",
      message: "Sprout couldn’t connect. Ask a grown-up to check the microphone and connection, then try Play again.",
    };
  if (!snapshot) return { kind: "welcome", message: "Come count with Sprout!" };
  if (snapshot.runtime?.phase === "complete")
    return { kind: "complete", message: "Our counting adventure is complete!" };
  if (snapshot.status === "ended")
    return { kind: "ended", message: "We’ve stopped for now. You can play again whenever you like." };
  if (snapshot.status !== "live") return { kind: "connecting", message: "Getting ready to play…" };
  if (snapshot.runtime?.outputActivity === "active") return { kind: "speaking", message: "Sprout is speaking…" };
  if (snapshot.runtime?.childSpeaking) return { kind: "listening", message: "Sprout is listening…" };
  if (snapshot.awaitingSteering || snapshot.runtime?.phase !== "active")
    return { kind: "waiting", message: "One moment…" };
  return { kind: "ready", message: "Your turn!" };
}

export type VoiceActivity = "off" | "waiting" | "your-turn" | "listening" | "speaking";

/** The cue follows the same session/VAD/output facts as the status copy; it never shows a
 * listening ear before the session (and its microphone input) is live. */
export function voiceActivity(presentation: ReturnType<typeof lessonPresentation>): VoiceActivity {
  switch (presentation.kind) {
    case "speaking":
    case "listening":
    case "waiting":
      return presentation.kind;
    case "ready":
      return "your-turn";
    default:
      return "off";
  }
}

type MotionSnapshot = Pick<LessonSnapshot, "status" | "error" | "awaitingSteering" | "display" | "runtime">;

/** Success reflects only the reducer's own authority for the displayed visit: the exact completion
 * evidence it will use to commit the next scene, plus the tutor's observed reply to that ended turn.
 * Only the audio drain remains, so the answered group is still on screen. Animation never feeds back. */
export function showsSuccessFeedback(snapshot: MotionSnapshot | null, lesson: LessonDefinition) {
  const runtime = snapshot?.runtime;
  return (
    !!runtime &&
    snapshot.status === "live" &&
    !snapshot.error &&
    !snapshot.awaitingSteering &&
    runtime.phase === "active" &&
    runtime.pendingRender === null &&
    runtime.nodeId === snapshot.display.nodeId &&
    !runtime.childSpeaking &&
    runtime.tutorOutputObserved &&
    hasCurrentCompletionEvidence(runtime, lesson)
  );
}

export type StageMotion = "idle" | "calm" | "success" | "celebrate";

export function stageMotion(snapshot: MotionSnapshot | null, lesson: LessonDefinition): StageMotion {
  if (snapshot?.runtime?.phase === "complete" && !snapshot.error) return "celebrate";
  if (showsSuccessFeedback(snapshot, lesson)) return "success";
  // Hold still while the child is answering and once the session has stopped or failed.
  if (snapshot?.error || snapshot?.status === "ended" || snapshot?.runtime?.childSpeaking) return "calm";
  return "idle";
}
