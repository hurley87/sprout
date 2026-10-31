"use client";

import { useEffect, useState } from "react";
import type { VoiceActivity } from "./lesson-presentation";
import styles from "./glow-cue.module.css";

/** States that a short gap in tutor audio can fall back to while the tutor is still mid-reply. */
const GAP_STATES: ReadonlySet<VoiceActivity> = new Set(["your-turn", "waiting"]);

/** Whether a speaking cue should stay up through a quiet gap. Pure, so the rule is testable. */
export function holdsSpeaking(previous: VoiceActivity, next: VoiceActivity, holding: boolean) {
  return GAP_STATES.has(next) && (previous === "speaking" || holding);
}

/** Keeps "speaking" through the brief audio gaps between words for `holdMs`, so the cue does not
 * flicker. Child speech, thinking and success still show immediately. Presentation only. */
export function useHeldVoiceActivity(activity: VoiceActivity, holdMs: number): VoiceActivity {
  const [previous, setPrevious] = useState(activity);
  const [holding, setHolding] = useState(false);
  if (activity !== previous) {
    setPrevious(activity);
    setHolding(holdMs > 0 && holdsSpeaking(previous, activity, holding));
  }
  useEffect(() => {
    if (!holding) return;
    const timer = setTimeout(() => setHolding(false), holdMs);
    return () => clearTimeout(timer);
  }, [holding, holdMs]);
  return holding ? "speaking" : activity;
}

/** An abstract moon glow with soft sound bars: the bars rise and fall slowly while Sprout talks, the
 * glow rests warmly with a ring on the child's turn, the ring pulses while the child speaks and
 * everything dims while Sprout thinks. Words stay in the status text for screen readers. */
export function GlowCue({ activity }: { activity: VoiceActivity }) {
  return (
    <span className={styles.cue} data-voice-activity={activity} aria-hidden="true">
      <span className={styles.light}>
        <span className={styles.halo} />
        <span className={styles.orb} />
      </span>
      <span className={styles.bars}>
        <span />
        <span />
        <span />
      </span>
    </span>
  );
}
