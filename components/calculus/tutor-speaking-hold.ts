import { LESSON_TIMING } from "@/lib/lesson-runtime/lesson-runtime";
import type { MicState } from "./mic-state";

export function createTutorSpeakingHold(onChange: (speaking: boolean) => void) {
  let speaking = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function cancel() {
    clearTimeout(timer);
    timer = undefined;
  }

  function update(kind: MicState["kind"]) {
    cancel();
    if (kind === "your-turn" && speaking) {
      timer = setTimeout(() => {
        timer = undefined;
        speaking = false;
        onChange(false);
      }, LESSON_TIMING.tutorTranscriptStableMs);
      return;
    }
    speaking = kind === "tutor";
    onChange(speaking);
  }

  return { update, cancel };
}
