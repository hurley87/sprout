"use client";

import type { LessonSnapshot } from "@/lib/lesson-runtime/lesson-runtime";
import { CountingStage } from "./counting-stage";
import { gardenEffectKey, gardenEffectState, useGardenGame } from "./garden-rescue-game";
import styles from "./garden-rescue-effects.module.css";
import { GARDEN_RESCUE_THEME } from "./garden-rescue-theme";
import { LessonScreen, type LessonStageProps } from "./lesson-screen";

function GardenStage({ snapshot, node, ...props }: LessonStageProps) {
  const { game } = useGardenGame(snapshot);
  const state = gardenEffectState(snapshot);
  return (
    <div
      style={{ display: "contents" }}
      data-game-status={game.status}
      data-game-run={game.runId ?? ""}
      data-game-quest={game.quest?.id ?? ""}
      data-game-restored={game.restored.join(" ")}
      data-effect-state={state}
    >
      <CountingStage
        theme={GARDEN_RESCUE_THEME}
        effect={{ className: styles.effects, state, key: gardenEffectKey(snapshot) }}
        node={
          node
            ? {
                id: node.id,
                sceneId: String(node.presentation.sceneId),
                object: String(node.presentation.object),
                quantity: Number(node.presentation.quantity),
              }
            : null
        }
        {...props}
      />
    </div>
  );
}

function GardenDebug({ snapshot }: { snapshot: LessonSnapshot | null }) {
  const { game, events } = useGardenGame(snapshot);
  return (
    <section className="rounded border p-4" aria-label="Game state">
      <h2 className="font-semibold">Game state</h2>
      <p>
        Status: {game.status} · Run: {game.runId ?? "—"} · Quest: {game.quest?.id ?? "—"} · Restored:{" "}
        {game.restored.join(", ") || "—"}
      </p>
      <ol aria-label="Game events">
        {events.map((event, index) => (
          <li key={index}>{JSON.stringify(event)}</li>
        ))}
      </ol>
    </section>
  );
}

export default function GardenRescueLesson({ debug = false }: { debug?: boolean }) {
  return (
    <LessonScreen
      theme={GARDEN_RESCUE_THEME}
      debug={debug}
      renderStage={props => <GardenStage {...props} />}
      renderDebug={snapshot => <GardenDebug snapshot={snapshot} />}
    />
  );
}
