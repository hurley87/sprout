import {
  GARDEN_RESCUE_LESSON,
  GARDEN_RESCUE_NODE_IDS,
  type GardenRescueNodeId,
} from "../lesson-runtime/garden-rescue-lesson";
import type { LessonSnapshot } from "../lesson-runtime/lesson-runtime";
import type { LessonRuntimeState } from "../lesson-runtime/lesson-runtime-reducer";

export type GardenQuestId = GardenRescueNodeId;
export type GardenProbe = "rehearsal" | "transfer";
const probeFor = (id: GardenQuestId): GardenProbe => {
  const role = GARDEN_RESCUE_LESSON.nodes[id].evidenceRole;
  if (!role) throw new Error(`Garden quest ${id} needs an evidence role`);
  return role;
};
export const GARDEN_WORLD_EFFECTS = {
  "rescue-ducklings": "ducklings.crossed",
  "wake-butterflies": "butterflies.awakened",
  "grow-flowers": "flowers.bloomed",
} as const;
export type GardenWorldEffect = (typeof GARDEN_WORLD_EFFECTS)[keyof typeof GARDEN_WORLD_EFFECTS];
export type GardenGameStatus = "ready" | "starting" | "playing" | "celebrating" | "stopped" | "error";
export type GardenGameSnapshot = Pick<LessonSnapshot, "status" | "display" | "error" | "awaitingSteering"> & {
  readonly runtime: Pick<
    LessonRuntimeState,
    "runtimeId" | "lessonId" | "nodeId" | "visitId" | "phase" | "pendingRender"
  > | null;
};
export type GardenGameState = {
  readonly status: GardenGameStatus;
  readonly runId: string | null;
  readonly quest: {
    readonly id: GardenQuestId;
    readonly visitId: number;
    readonly renderToken: string;
    readonly probe: GardenProbe;
  } | null;
  readonly encounter: { readonly id: GardenQuestId; readonly visitId: number; readonly probe: GardenProbe } | null;
  readonly restored: readonly GardenQuestId[];
};

export type GardenGameEvent =
  | { readonly type: "game.started"; readonly runId: string }
  | {
      readonly type: "quest.started";
      readonly runId: string;
      readonly questId: GardenQuestId;
      readonly visitId: number;
      readonly renderToken: string;
      readonly probe: GardenProbe;
    }
  | { readonly type: "quest.succeeded"; readonly runId: string; readonly questId: GardenQuestId }
  | {
      readonly type: "game.ended";
      readonly runId: string;
      readonly outcome: "completed" | "stopped" | "error";
      readonly restored: readonly GardenQuestId[];
    }
  | {
      readonly type: "world.effect";
      readonly runId: string;
      readonly questId: GardenQuestId;
      /** The visit whose answer committed; null only when the diff never observed it. */
      readonly visitId: number | null;
      readonly effect: GardenWorldEffect;
    }
  /** Reserved; the voice-only game does not emit interaction events. */
  | {
      readonly type: "object.interacted";
      readonly runId: string;
      readonly questId: GardenQuestId;
      readonly visitId: number;
      readonly objectId: string;
      readonly order: number;
      readonly modality: "touch" | "keyboard";
    };

const ready: GardenGameState = { status: "ready", runId: null, quest: null, encounter: null, restored: [] };

/** Read-only projection: a pending render is not yet a committed success. */
export function projectGardenGame(snapshot: GardenGameSnapshot | null): GardenGameState {
  if (!snapshot || (snapshot.runtime && snapshot.runtime.lessonId !== GARDEN_RESCUE_LESSON.id)) return ready;
  const runtime = snapshot.runtime;
  const status: GardenGameStatus = snapshot.error
    ? "error"
    : runtime?.phase === "complete"
      ? "celebrating"
      : snapshot.status === "ended"
        ? "stopped"
        : snapshot.status !== "live" || !runtime
          ? "starting"
          : "playing";
  if (!runtime) return { status, runId: null, quest: null, encounter: null, restored: [] };
  const authoritativeNode =
    runtime.phase === "rendering" && runtime.pendingRender ? runtime.pendingRender.origin.nodeId : runtime.nodeId;
  const index = GARDEN_RESCUE_NODE_IDS.findIndex(id => id === authoritativeNode);
  const encounterId = GARDEN_RESCUE_NODE_IDS.find(id => id === authoritativeNode);
  const encounter = encounterId
    ? {
        id: encounterId,
        probe: probeFor(encounterId),
        visitId:
          runtime.phase === "rendering" && runtime.pendingRender
            ? runtime.pendingRender.origin.visitId
            : runtime.visitId,
      }
    : null;
  const restored =
    runtime.phase === "complete" ? [...GARDEN_RESCUE_NODE_IDS] : GARDEN_RESCUE_NODE_IDS.slice(0, Math.max(index, 0));
  const questId = GARDEN_RESCUE_NODE_IDS.find(id => id === runtime.nodeId);
  const quest =
    status === "playing" &&
    runtime.phase === "active" &&
    !snapshot.awaitingSteering &&
    snapshot.display.nodeId === runtime.nodeId &&
    questId
      ? { id: questId, visitId: runtime.visitId, renderToken: snapshot.display.token, probe: probeFor(questId) }
      : null;
  return { status, runId: runtime.runtimeId, quest, encounter, restored };
}

const terminal = (status: GardenGameStatus) => status === "celebrating" || status === "stopped" || status === "error";

/** Diff consecutive projections from the same authoritative stream; terminal runs are absorbing. */
export function gardenGameEvents(previous: GardenGameState, next: GardenGameState): GardenGameEvent[] {
  if (next.runId === null) return [];
  const runId = next.runId;
  const newRun = previous.runId !== runId;
  if (!newRun && terminal(previous.status)) return [];
  const baseline = newRun ? ready : previous;
  const events: GardenGameEvent[] = [];
  if (newRun) events.push({ type: "game.started", runId });
  for (const questId of GARDEN_RESCUE_NODE_IDS) {
    if (next.restored.includes(questId) && !baseline.restored.includes(questId)) {
      events.push({ type: "quest.succeeded", runId, questId });
      const effect = GARDEN_WORLD_EFFECTS[questId as keyof typeof GARDEN_WORLD_EFFECTS];
      if (effect) {
        // The committing visit is the baseline's encounter. A diff that skips past it (e.g. the
        // first projection observed mid-run) records the visit as unknown rather than guessing.
        const visitId = baseline.encounter?.id === questId ? baseline.encounter.visitId : null;
        events.push({ type: "world.effect", runId, questId, visitId, effect });
      }
    }
  }
  if (next.quest && (next.quest.id !== baseline.quest?.id || next.quest.visitId !== baseline.quest.visitId)) {
    events.push({
      type: "quest.started",
      runId,
      questId: next.quest.id,
      visitId: next.quest.visitId,
      renderToken: next.quest.renderToken,
      probe: next.quest.probe,
    });
  }
  if (terminal(next.status))
    events.push({
      type: "game.ended",
      runId,
      outcome: next.status === "celebrating" ? "completed" : (next.status as "stopped" | "error"),
      restored: next.restored,
    });
  return events;
}
