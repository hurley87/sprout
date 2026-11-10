"use client";

import type { LessonSnapshot } from "@/lib/lesson-runtime/lesson-runtime";
import { CountingStage } from "./counting-stage";
import { projectGardenGame } from "@/lib/garden-rescue/game-state";
import { gardenEffectKey, gardenEffectState, useGardenGame } from "./garden-rescue-game";
import styles from "./garden-rescue-effects.module.css";
import { GARDEN_RESCUE_THEME } from "./garden-rescue-theme";
import { LessonScreen, type LessonStageProps } from "./lesson-screen";

function GardenStage({ snapshot, node, ...props }: LessonStageProps) {
  const { game } = useGardenGame(snapshot);
  const state = gardenEffectState(snapshot);
  return (
    <div
      className={styles.gardenStage}
      data-game-status={game.status}
      data-game-run={game.runId ?? ""}
      data-game-quest={game.quest?.id ?? ""}
      data-game-restored={game.restored.join(" ")}
      data-game-released={game.released.join(" ")}
      data-effect-state={state}
    >
      {node?.id === "fresh-challenge" && <span className={styles.challengeLabel}>New challenge!</span>}
      <CountingStage
        theme={
          game.status === "finished" ||
          (node === null &&
            (game.released.length > 0 ||
              snapshot?.runtime?.pendingRender?.outcome?.outcome === "released_after_support_limit"))
            ? {
                ...GARDEN_RESCUE_THEME,
                celebration: {
                  ...GARDEN_RESCUE_THEME.celebration,
                  decorations: game.restored.includes("grow-flowers")
                    ? GARDEN_RESCUE_THEME.celebration.decorations
                    : [],
                  friends: GARDEN_RESCUE_THEME.celebration.friends.filter(friend =>
                    ["lily-pad", "duckling"].includes(friend.asset)
                      ? game.restored.includes("rescue-ducklings")
                      : game.restored.includes("wake-butterflies"),
                  ),
                  message: "Thank you for helping the garden friends!",
                },
              }
            : GARDEN_RESCUE_THEME
        }
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
        motion={game.status === "finished" ? "calm" : props.motion}
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
      presentationCopy={snapshot =>
        projectGardenGame(snapshot).status === "finished"
          ? { ...GARDEN_RESCUE_THEME.copy, complete: "Thank you for helping the garden friends!" }
          : GARDEN_RESCUE_THEME.copy
      }
      progressOutcome={(snapshot, id) => {
        const game = projectGardenGame(snapshot);
        return game.restored.some(quest => quest === id)
          ? "succeeded"
          : game.released.some(quest => quest === id)
            ? "released"
            : undefined;
      }}
    />
  );
}
