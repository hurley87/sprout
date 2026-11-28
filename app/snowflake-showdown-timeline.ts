import type { MittenColour } from "@/lib/lesson-runtime/snowflake-showdown-plan";
import type { LessonStageProps } from "./lesson-screen";
import type { SnowflakePairing } from "./snowflake-showdown-scene";

/** Incorrect difficulties recorded in the current confirmed visit, as `christmasTreeMisses` counts them. */
export function snowflakeShowdownMisses(
  snapshot: LessonStageProps["snapshot"] | undefined,
  node: LessonStageProps["node"],
): number {
  const runtime = snapshot?.runtime;
  if (!runtime || !node || runtime.nodeId !== node.id || runtime.pendingRender) return 0;
  return (
    runtime.difficulties?.filter(record => record.kind === "incorrect" && record.source.visitId === runtime.visitId)
      .length ?? 0
  );
}

/** Both mittens turn from their backs to their snowflake sides together, once the round renders. */
export const FLIP_MS = 500;

/** Lead-in before the first pairing line, so the tutor's "Look, some are left over" can begin. */
export const PAIRING_LEAD_MS = 500;
/** About one pair every half second, timed by the app and not synced to the tutor's speech. */
export const PAIRING_STEP_MS = 500;

export type PairingStep = { readonly blue: number; readonly pink: number; readonly atMs: number };
export type PairingSchedule = {
  readonly steps: readonly PairingStep[];
  /** The larger side's unpaired slots, which glow gold at `leftoverAtMs`. */
  readonly leftover: { readonly colour: MittenColour; readonly slots: readonly number[] } | null;
  readonly leftoverAtMs: number;
  /** When the pairing is done: the leftovers glow and every line is drawn. */
  readonly endMs: number;
};

/**
 * When each pairing line appears after a wrong call, and when the leftovers glow: one pair every
 * PAIRING_STEP_MS after a short lead, then the glow one step after the last pair. With reduced motion
 * everything appears at once.
 */
export function pairingSchedule(pairing: SnowflakePairing, reduced = false): PairingSchedule {
  const steps = pairing.lines.map(({ blue, pink }, index) => ({
    blue,
    pink,
    atMs: reduced ? 0 : PAIRING_LEAD_MS + index * PAIRING_STEP_MS,
  }));
  const leftoverAtMs = reduced ? 0 : PAIRING_LEAD_MS + steps.length * PAIRING_STEP_MS;
  return { steps, leftover: pairing.leftover, leftoverAtMs, endMs: leftoverAtMs };
}

/** How many pairing lines are drawn `elapsedMs` after the pairing started. */
export function pairsShown(schedule: PairingSchedule, elapsedMs: number): number {
  return schedule.steps.filter(step => step.atMs <= elapsedMs).length;
}

/** Quiet time before both mittens wiggle once. */
export const SILENCE_WIGGLE_MS = 5_000;
export const WIGGLE_MS = 600;
/** At most this many wiggles per round. */
export const MAX_WIGGLES = 3;

/** What the stage watches for silence. */
export type SilenceSignals = {
  /** The round is live and listening: the flip has ended, nothing is pending and success is not showing. */
  readonly ready: boolean;
  readonly childSpeaking: boolean;
  readonly childCandidate: boolean;
  readonly tutorActive: boolean;
  /** Changes when a child turn starts or ends, so a short turn still restarts the wait. */
  readonly childTurnId: number;
};
export type SilenceClock = {
  /** When the current quiet began, or null while something is happening. */
  readonly quietSinceMs: number | null;
  readonly wiggles: number;
  readonly signature: string;
};
export const SILENCE_START: SilenceClock = { quietSinceMs: null, wiggles: 0, signature: "" };

/**
 * Folds the latest signals into the clock. The quiet restarts at the LATEST of: the round becoming
 * ready (the flip ending), the child's turn ending and the tutor going quiet. Any child speech, a
 * candidate or active tutor output cancels the pending wiggle. The same signals again change nothing.
 */
export function observeSilence(clock: SilenceClock, signals: SilenceSignals, atMs: number): SilenceClock {
  const busy = !signals.ready || signals.childSpeaking || signals.childCandidate || signals.tutorActive;
  const signature = `${busy}:${signals.childTurnId}`;
  if (busy)
    return clock.quietSinceMs === null && clock.signature === signature
      ? clock
      : { ...clock, quietSinceMs: null, signature };
  if (clock.quietSinceMs !== null && clock.signature === signature) return clock;
  return { ...clock, quietSinceMs: atMs, signature };
}

/** When the next wiggle is due, or null while busy or once the round has had MAX_WIGGLES. */
export function wiggleDueAtMs(clock: SilenceClock): number | null {
  if (clock.quietSinceMs === null || clock.wiggles >= MAX_WIGGLES) return null;
  return clock.quietSinceMs + SILENCE_WIGGLE_MS;
}

/** A wiggle started at `atMs`; the next one waits for another SILENCE_WIGGLE_MS of quiet. */
export function recordWiggle(clock: SilenceClock, atMs: number): SilenceClock {
  return { ...clock, wiggles: clock.wiggles + 1, quietSinceMs: clock.quietSinceMs === null ? null : atMs };
}

/** Clean first-try rounds in a row that earn the flurry. */
export const STREAK_ROUNDS = 3;

/** Session-keyed streak state. `session` is the runtime id, so Stop then Play starts a new streak. */
export type StreakBook = {
  readonly session: string;
  readonly run: number;
  /** Visits already recorded, so a re-render never counts a success twice. */
  readonly recorded: ReadonlySet<string>;
  /** Visits whose success shows the flurry. */
  readonly flurries: ReadonlySet<string>;
};
export const STREAK_START: StreakBook = { session: "", run: 0, recorded: new Set(), flurries: new Set() };

/**
 * Records one round's success. A round won first try with no misses extends the run; a miss resets it.
 * The third clean round in a row shows the flurry, and the run starts over.
 */
export function recordShowdownSuccess(book: StreakBook, session: string, visit: string, missed: boolean): StreakBook {
  const current = book.session === session ? book : { ...STREAK_START, session };
  if (current.recorded.has(visit)) return current;
  const run = missed ? 0 : current.run + 1;
  const flurry = run >= STREAK_ROUNDS;
  return {
    session,
    run: flurry ? 0 : run,
    recorded: new Set([...current.recorded, visit]),
    flurries: flurry ? new Set([...current.flurries, visit]) : current.flurries,
  };
}

export function showsFlurry(book: StreakBook, session: string, visit: string): boolean {
  return book.session === session && book.flurries.has(visit);
}

/** The mitten with more dances first. */
export const SUCCESS_DANCE_MS = 600;
/** The snowman claps (blue has more) or shrugs happily (pink has more) just after the dance starts. */
export const SUCCESS_SNOWMAN_AT_MS = 200;
export const SUCCESS_SNOWMAN_MS = 900;
/** The star leaves the mitten as the dance ends and lands in her row. */
export const SUCCESS_STAR_AT_MS = 500;
export const SUCCESS_STAR_FLIGHT_MS = 1_000;
/** The streak flurry blows across once, alongside the star. */
export const SUCCESS_FLURRY_AT_MS = 600;
export const SUCCESS_FLURRY_MS = 1_500;

export type SuccessTimeline = {
  readonly danceMs: number;
  readonly snowmanAtMs: number;
  readonly starAtMs: number;
  /** When the star turns gold in its slot: on landing, or in place at `starAtMs` with reduced motion. */
  readonly starGoldAtMs: number;
  readonly flurryAtMs: number | null;
  readonly endMs: number;
};

/** The success sequence. It fits in the lesson's 2.5 s `successHoldMs`, flurry included. */
export function successTimeline({ streak = false, reduced = false } = {}): SuccessTimeline {
  const starGoldAtMs = reduced ? SUCCESS_STAR_AT_MS : SUCCESS_STAR_AT_MS + SUCCESS_STAR_FLIGHT_MS;
  const flurryAtMs = streak && !reduced ? SUCCESS_FLURRY_AT_MS : null;
  return {
    danceMs: SUCCESS_DANCE_MS,
    snowmanAtMs: SUCCESS_SNOWMAN_AT_MS,
    starAtMs: SUCCESS_STAR_AT_MS,
    starGoldAtMs,
    flurryAtMs,
    endMs: Math.max(
      SUCCESS_DANCE_MS,
      SUCCESS_SNOWMAN_AT_MS + SUCCESS_SNOWMAN_MS,
      starGoldAtMs,
      flurryAtMs === null ? 0 : flurryAtMs + SUCCESS_FLURRY_MS,
    ),
  };
}
