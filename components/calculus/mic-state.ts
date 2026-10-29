import type { CalculusSnapshot } from "@/lib/lesson-runtime/calculus-runtime";
import type { LessonRuntimeState } from "@/lib/lesson-runtime/lesson-runtime-reducer";
import type { LessonSnapshot } from "@/lib/lesson-runtime/lesson-runtime";

export type MicStateInput = {
  snapshot: {
    status: LessonSnapshot["status"];
    error: string | null;
    runtime: Pick<LessonRuntimeState, "phase" | "childSpeaking" | "outputActivity"> | null;
    math?: Pick<CalculusSnapshot, "checking" | "complete">;
  } | null;
  live: boolean;
};

export type MicState = {
  kind: "before" | "connecting" | "tutor" | "listening" | "checking" | "your-turn" | "complete" | "ended" | "error";
  icon: "mic" | "off" | "check" | "wave";
  look: "primary" | "quiet" | "ok" | "look";
  pulse: boolean;
  spin: boolean;
  big: boolean;
  label: string;
  line: string;
  action?: string;
};

const STATES: Record<MicState["kind"], Omit<MicState, "kind">> = {
  before: {
    icon: "mic",
    look: "primary",
    pulse: false,
    spin: false,
    big: true,
    label: "Start practice",
    line: "Tap to start · 3 problems",
  },
  connecting: {
    icon: "mic",
    look: "quiet",
    pulse: false,
    spin: true,
    big: false,
    label: "End session",
    line: "Connecting…",
  },
  tutor: {
    icon: "wave",
    look: "quiet",
    pulse: false,
    spin: false,
    big: false,
    label: "End session",
    line: "Tutor is reading the problem",
  },
  listening: {
    icon: "mic",
    look: "primary",
    pulse: true,
    spin: false,
    big: false,
    label: "End session",
    line: "Listening…",
  },
  checking: {
    icon: "mic",
    look: "quiet",
    pulse: false,
    spin: true,
    big: false,
    label: "End session",
    line: "Checking what you said…",
  },
  "your-turn": {
    icon: "mic",
    look: "primary",
    pulse: false,
    spin: false,
    big: false,
    label: "End session",
    line: "Your turn",
  },
  complete: {
    icon: "check",
    look: "ok",
    pulse: false,
    spin: false,
    big: false,
    label: "End session",
    line: "Next problem in a moment",
  },
  ended: {
    icon: "mic",
    look: "primary",
    pulse: false,
    spin: false,
    big: false,
    label: "Restart practice",
    line: "Session stopped. Your work so far is shown above.",
  },
  error: {
    icon: "off",
    look: "look",
    pulse: false,
    spin: false,
    big: false,
    label: "Microphone blocked",
    line: "Microphone is blocked",
    action: "Allow microphone",
  },
};

// Errors win, then absent/stopped sessions, completion, checking, learner speech,
// connection setup, and observed tutor audio. Rendering is not reconnecting.
export function micState({ snapshot, live }: MicStateInput): MicState {
  let kind: MicState["kind"];
  if (snapshot?.error) kind = "error";
  else if (!snapshot) kind = "before";
  else if (!live || snapshot.status === "ended" || snapshot.runtime?.phase === "stopped") kind = "ended";
  else if (snapshot.math?.complete || snapshot.runtime?.phase === "complete") kind = "complete";
  else if (snapshot.math?.checking) kind = "checking";
  else if (snapshot.runtime?.childSpeaking) kind = "listening";
  else if (snapshot.status !== "live" || !snapshot.runtime) kind = "connecting";
  else if (snapshot.runtime.outputActivity === "active") kind = "tutor";
  else kind = "your-turn";
  return { kind, ...STATES[kind] };
}
