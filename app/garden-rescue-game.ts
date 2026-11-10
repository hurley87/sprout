"use client";

import { useState } from "react";
import { gardenGameEvents, projectGardenGame, type GardenGameEvent } from "@/lib/garden-rescue/game-state";
import type { LessonSnapshot } from "@/lib/lesson-runtime/lesson-runtime";

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
