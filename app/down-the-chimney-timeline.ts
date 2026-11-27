import {
  CHIMNEY_INITIAL_PACE,
  chimneyDropSequenceMs,
  nextChimneyPace,
  type ChimneyPace,
} from "@/lib/lesson-runtime/down-the-chimney-plan";
import type { LessonStageProps } from "./lesson-screen";

export const COUNT_ALONG_BUFFER_MS = 600;
export function countAlongDuration(count: number, interval: number) {
  return chimneyDropSequenceMs(count, interval) + COUNT_ALONG_BUFFER_MS;
}
export function chimneyMisses(snapshot: LessonStageProps["snapshot"] | undefined, node: LessonStageProps["node"]) {
  const runtime = snapshot?.runtime;
  if (!runtime || !node || runtime.nodeId !== node.id || runtime.pendingRender) return 0;
  return (
    runtime.difficulties?.filter(record => record.kind === "incorrect" && record.source.visitId === runtime.visitId)
      .length ?? 0
  );
}
export type PaceBook = { session: string; pace: ChimneyPace; succeeded: ReadonlySet<string> };
export function recordChimneySuccess(book: PaceBook, session: string, visit: string, missed: boolean): PaceBook {
  const current =
    book.session === session ? book : { session, pace: CHIMNEY_INITIAL_PACE, succeeded: new Set<string>() };
  if (current.succeeded.has(visit)) return current;
  return {
    session,
    pace: nextChimneyPace(current.pace, { missed }),
    succeeded: new Set([...current.succeeded, visit]),
  };
}

export function introDelay(round: number, outputObserved: boolean, fallbackElapsed: boolean): number | null {
  if (round !== 1) return 1000;
  if (outputObserved) return 1200;
  return fallbackElapsed ? 0 : null;
}

export function missReplayDelay(replySeen: boolean, fallbackElapsed: boolean): number | null {
  return replySeen ? 700 : fallbackElapsed ? 0 : null;
}

export function silenceReplayDelay(replays: number): number | null {
  return replays < 2 ? 6000 : null;
}
