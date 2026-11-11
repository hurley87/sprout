"use client";

import { useState } from "react";
import { gardenGameEvents, projectGardenGame, type GardenGameEvent } from "@/lib/garden-rescue/game-state";
import type { LessonSnapshot } from "@/lib/lesson-runtime/lesson-runtime";
import { GARDEN_RESCUE_LESSON } from "@/lib/lesson-runtime/garden-rescue-lesson";
import { stageMotion } from "./lesson-presentation";

/** The visit whose scene is on screen: the pending render's origin until the next scene commits. */
function encounterVisit(snapshot: LessonSnapshot | null): number | null {
  const runtime = snapshot?.runtime;
  if (!runtime) return null;
  return runtime.phase === "rendering" && runtime.pendingRender
    ? runtime.pendingRender.origin.visitId
    : runtime.visitId;
}

/** Remounts the effect layer per run and visit, so a stale visit never inherits an animation. */
export function gardenEffectKey(snapshot: LessonSnapshot | null): string {
  return JSON.stringify([
    snapshot?.runtime?.runtimeId ?? null,
    snapshot?.display.nodeId ?? null,
    encounterVisit(snapshot),
  ]);
}

/** Presentation only. "playing" is the existing success window; "held" keeps the final frame on the
 * answered scene while its committed transition renders. Everything else, including Stop, an error,
 * renewed speech and a new run, is "before". */
export function gardenEffectState(
  snapshot: LessonSnapshot | null,
  lesson = GARDEN_RESCUE_LESSON,
): "before" | "playing" | "held" {
  if (stageMotion(snapshot, lesson) === "success") return "playing";
  const runtime = snapshot?.runtime;
  const origin = runtime?.pendingRender?.origin;
  if (
    snapshot?.status === "live" &&
    !snapshot.error &&
    runtime?.phase === "rendering" &&
    origin &&
    runtime.pendingRender?.outcome?.outcome !== "released_after_support_limit" &&
    origin.runtimeId === runtime.runtimeId &&
    origin.nodeId === snapshot.display.nodeId
  )
    return "held";
  return "before";
}

export function useGardenGame(snapshot: LessonSnapshot | null) {
  const game = projectGardenGame(snapshot);
  const [history, setHistory] = useState(() => ({
    snapshot,
    game,
    events: gardenGameEvents(projectGardenGame(null), game) as GardenGameEvent[],
  }));
  if (history.snapshot !== snapshot) {
    const events = gardenGameEvents(history.game, game);
    const next = {
      snapshot,
      game,
      events: game.runId === history.game.runId ? [...history.events, ...events] : events,
    };
    setHistory(next);
    return { game, events: next.events };
  }
  return { game, events: history.events };
}
