"use client";

import type { MicState } from "./mic-state";
import theme from "./calculus-theme.module.css";
import styles from "./mic-button.module.css";

export type MicButtonProps = {
  state: MicState;
  onStart: () => void;
  onStop: () => void;
  onAction?: () => void;
};

function MicIcon({ icon }: { icon: MicState["icon"] }) {
  if (icon === "wave") {
    return (
      <span className={styles.wave} aria-hidden="true">
        {[0, 1, 2, 3].map(index => (
          <span className={theme.micWave} style={{ animationDelay: `${index * 0.15}s` }} key={index} />
        ))}
      </span>
    );
  }
  return (
    <svg
      className={icon === "check" ? styles.check : styles.icon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={icon === "check" ? 2.4 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {icon === "check" ? (
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      ) : (
        <>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
          <path d="M12 17.5V21" />
          {icon === "off" ? <path d="M4 4l16 16" /> : null}
        </>
      )}
    </svg>
  );
}

export function MicButton({ state, onStart, onStop, onAction }: MicButtonProps) {
  const restart = state.kind === "before" || state.kind === "ended" || state.kind === "error";
  return (
    <div className={styles.control}>
      <div className={`${styles.wrap} ${state.big ? styles.big : ""}`}>
        {state.pulse ? (
          <>
            <span className={`${styles.pulse} ${theme.micPulse}`} aria-hidden="true" />
            <span
              className={`${styles.pulse} ${theme.micPulse}`}
              style={{ animationDelay: "0.9s" }}
              aria-hidden="true"
            />
          </>
        ) : null}
        {state.spin ? <span className={`${styles.spinner} ${theme.micSpin}`} aria-hidden="true" /> : null}
        <button
          type="button"
          className={`${styles.button} ${styles[state.look]}`}
          aria-label={state.label}
          onClick={restart ? onStart : onStop}
        >
          <MicIcon icon={state.icon} />
        </button>
      </div>
      <div className={styles.line} role="status" aria-live="polite">
        {state.line}
      </div>
      {state.action ? (
        <button type="button" className={styles.action} onClick={onAction ?? onStart}>
          {state.action}
        </button>
      ) : null}
    </div>
  );
}
