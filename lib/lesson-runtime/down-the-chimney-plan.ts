import { mulberry32 } from "./seeded-random";

export const DOWN_THE_CHIMNEY_SEED_MIN = 0;
export const DOWN_THE_CHIMNEY_SEED_MAX = 99;
export const DOWN_THE_CHIMNEY_ROUNDS = 8;

export const CHIMNEY_PACE_INTERVALS_MS = [1800, 1500, 1200, 900] as const;
export const CHIMNEY_ASSISTED_INTERVAL_MS = 2000;
export const CHIMNEY_FALL_MS = 500;

export type ChimneyStep = 0 | 1 | 2;
export type ChimneyPace = { readonly slowdown: number; readonly cleanStreak: number };
export type DownTheChimneyRound = { readonly round: number; readonly count: number; readonly step: ChimneyStep };
export type DownTheChimneyPlan = { readonly seed: number; readonly rounds: readonly DownTheChimneyRound[] };

export const CHIMNEY_INITIAL_PACE: ChimneyPace = Object.freeze({ slowdown: 0, cleanStreak: 0 });

export function isDownTheChimneySeed(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= DOWN_THE_CHIMNEY_SEED_MIN &&
    value <= DOWN_THE_CHIMNEY_SEED_MAX
  );
}

/** The seed lets the server and browser independently reconstruct the same rounds. */
export function downTheChimneyPlan(seed: number): DownTheChimneyPlan {
  if (!isDownTheChimneySeed(seed)) throw new RangeError("Chimney seed must be an integer from 0 to 99");

  const random = mulberry32(seed);
  let previous = 0;
  const rounds = Array.from({ length: DOWN_THE_CHIMNEY_ROUNDS }, (_, index) => {
    const step: ChimneyStep = index < 2 ? 0 : index < 5 ? 1 : 2;
    const maximum = step + 3;
    // Skip the preceding answer while giving each remaining count equal probability.
    let count = Math.floor(random() * (maximum - (previous > 0 ? 1 : 0))) + 1;
    if (previous > 0 && count >= previous) count++;
    previous = count;
    return Object.freeze({ round: index + 1, count, step });
  });
  return Object.freeze({ seed, rounds: Object.freeze(rounds) });
}

/** Misses slow the next round relative to its planned step. */
export function chimneyRoundIntervalMs(step: ChimneyStep, pace: ChimneyPace): number {
  return CHIMNEY_PACE_INTERVALS_MS[Math.max(0, step + 1 - pace.slowdown)];
}

/** Two clean rounds restore the planned pace, even across step changes. */
export function nextChimneyPace(pace: ChimneyPace, { missed }: { readonly missed: boolean }): ChimneyPace {
  if (missed) return { slowdown: Math.min(3, pace.slowdown + 1), cleanStreak: 0 };
  if (pace.cleanStreak + 1 >= 2) return { slowdown: 0, cleanStreak: 0 };
  return { slowdown: pace.slowdown, cleanStreak: pace.cleanStreak + 1 };
}

/** Silence repeats the rhythm; misses slow it or add a count-along. */
export function chimneyReplayIntervalMs(roundIntervalMs: number, misses: number): number {
  if (misses >= 2) return CHIMNEY_ASSISTED_INTERVAL_MS;
  if (misses === 0) return roundIntervalMs;
  const level = CHIMNEY_PACE_INTERVALS_MS.findIndex(interval => interval === roundIntervalMs);
  return CHIMNEY_PACE_INTERVALS_MS[Math.max(0, level - 1)];
}

/** Include the final fall after the last drop starts. */
export function chimneyDropSequenceMs(count: number, intervalMs: number): number {
  return (count - 1) * intervalMs + CHIMNEY_FALL_MS;
}
