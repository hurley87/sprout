/** Tuned by replaying four live sessions (2026-11-04): 2.2 s quiet keeps pauses inside
 * instructed replies audible (1.2 s clipped twice as much), and 6.5 s covers ~p90 of the
 * send-to-reply latency. The cap had no measured effect and is a safety bound. */
export const CLOSE_AFTER_QUIET_MS = 2200;
export const OPEN_WAIT_MS = 6500;
export const MAX_OPEN_MS = 20000;

export type TutorAudioGateReason = "instruction" | "quiet" | "no_output" | "max_open";

export class TutorAudioGate {
  private openedAt: number;
  private active = false;
  /** Current output state, independent of the open window. */
  private speaking = false;
  private quietSince?: number;
  private closedReason?: TutorAudioGateReason;

  constructor(now: number) {
    this.openedAt = now;
  }

  /** Output already playing when an instruction arrives belongs to the previous utterance, so
   * it does not count as the reply: only output that starts after opening does. If that
   * output simply continues into the reply (no quiet gap), the wait deadline below keeps
   * the gate open instead of cutting the reply. */
  instructionSent(now: number) {
    this.openedAt = now;
    this.active = false;
    this.quietSince = undefined;
    this.closedReason = undefined;
  }

  outputActivity(state: "active" | "quiet" | "unavailable", now: number) {
    this.audible(now);
    this.speaking = state === "active";
    if (this.closedReason) return;
    if (state === "active") {
      this.active = true;
      this.quietSince = undefined;
    } else if (state === "quiet" && this.active) {
      this.quietSince ??= now;
    } else if (state === "unavailable") {
      this.quietSince = undefined;
    }
  }

  nextDeadline() {
    if (this.closedReason) return undefined;
    return Math.min(
      this.openedAt + MAX_OPEN_MS,
      this.active
        ? this.quietSince === undefined
          ? Infinity
          : this.quietSince + CLOSE_AFTER_QUIET_MS
        : this.openedAt + OPEN_WAIT_MS,
    );
  }

  audible(now: number) {
    let deadline = this.nextDeadline();
    if (
      deadline !== undefined &&
      now >= deadline &&
      !this.active &&
      this.speaking &&
      now < this.openedAt + MAX_OPEN_MS
    ) {
      // Still speaking since before the instruction: treat it as the reply rather than mute mid-sentence.
      this.active = true;
      this.quietSince = undefined;
      deadline = this.nextDeadline();
    }
    if (deadline !== undefined && now >= deadline) {
      this.closedReason = deadline === this.openedAt + MAX_OPEN_MS ? "max_open" : this.active ? "quiet" : "no_output";
    }
    return !this.closedReason;
  }

  reason() {
    return this.closedReason ?? "instruction";
  }
}
