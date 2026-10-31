import type { VoiceActivity } from "./lesson-presentation";
import styles from "./voice-cue.module.css";

/** Decorative companion to the status text, which carries the words for screen readers. */
export function VoiceCue({ activity }: { activity: VoiceActivity }) {
  return (
    <svg className={styles.cue} data-voice-activity={activity} viewBox="0 0 96 64" aria-hidden="true">
      <g className={styles.sprout}>
        <path d="M32 58 V30" stroke="#2f6b3f" strokeWidth="4" strokeLinecap="round" fill="none" />
        <path d="M32 36 C20 36 12 28 12 18 C24 18 32 25 32 36Z" fill="#5fae6c" />
        <path d="M32 31 C32 19 40 10 54 10 C54 23 45 31 32 31Z" fill="#7cc47f" />
        <ellipse cx="32" cy="58" rx="16" ry="4" fill="#c79a6b" />
      </g>
      {(activity === "speaking" || activity === "understood") && (
        <g className={styles.waves} stroke="#2f6b3f" strokeWidth="4" strokeLinecap="round" fill="none">
          <path d="M66 24 Q72 32 66 40" />
          <path d="M76 17 Q86 32 76 47" />
        </g>
      )}
      {activity === "thinking" && (
        <g fill="#2f6b3f">
          <circle cx="66" cy="30" r="3" />
          <circle cx="77" cy="24" r="3" />
          <circle cx="88" cy="18" r="3" />
        </g>
      )}
      {activity === "understood" && (
        <path d="M84 4 L87 12 L95 15 L87 18 L84 26 L81 18 L73 15 L81 12 Z" fill="#e7ad38" />
      )}
      {(activity === "listening" || activity === "your-turn") && (
        <g className={styles.ear} stroke="#2f6b3f" strokeWidth="4" strokeLinecap="round" fill="#fbe3cf">
          <path d="M66 32 C66 21 73 15 80 15 C88 15 92 21 92 28 C92 36 85 38 84 44 C83 49 80 52 76 52 C72 52 70 49 70 46" />
          <path d="M75 30 C75 25 78 22 81 22 C84 22 86 25 86 28" fill="none" />
        </g>
      )}
    </svg>
  );
}
