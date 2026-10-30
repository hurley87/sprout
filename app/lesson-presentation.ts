import type { LessonSnapshot } from "@/lib/lesson-runtime/lesson-runtime";

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
