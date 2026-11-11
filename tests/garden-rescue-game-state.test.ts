import { describe, expect, it } from "vitest";
import {
  GARDEN_WORLD_EFFECTS,
  gardenGameEvents,
  projectGardenGame,
  type GardenGameSnapshot,
} from "../lib/garden-rescue/game-state";
import { GARDEN_RESCUE_LESSON, GARDEN_RESCUE_NODE_IDS as ids } from "../lib/lesson-runtime/garden-rescue-lesson";
import { createLessonRuntime, reduceLessonRuntime } from "../lib/lesson-runtime/lesson-runtime-reducer";

function snapshot(runId = "run"): GardenGameSnapshot {
  return {
    status: "live",
    error: null,
    awaitingSteering: false,
    display: { token: "initial", nodeId: ids[0], sceneId: ids[0] },
    runtime: createLessonRuntime(runId, { lesson: GARDEN_RESCUE_LESSON }),
  };
}

describe("Garden Rescue game projection", () => {
  it("handles ready, starting, steering and matching display", () => {
    expect(projectGardenGame(null).status).toBe("ready");
    expect(projectGardenGame(null).encounter).toBeNull();
    const s = snapshot();
    expect(projectGardenGame({ ...s, runtime: null }).status).toBe("starting");
    expect(projectGardenGame({ ...s, runtime: null }).encounter).toBeNull();
    expect(projectGardenGame({ ...s, status: "connecting" }).status).toBe("starting");
    expect(projectGardenGame({ ...s, awaitingSteering: true }).quest).toBeNull();
    expect(projectGardenGame({ ...s, display: { ...s.display, nodeId: null } }).quest).toBeNull();
    expect(projectGardenGame(s).quest).toEqual({ id: ids[0], visitId: 1, renderToken: "initial", probe: "rehearsal" });
    expect(projectGardenGame({ ...s, runtime: { ...s.runtime!, lessonId: "other" } })).toEqual(projectGardenGame(null));
  });

  it("emits the exact progression only when each render commits", () => {
    let s = snapshot();
    let previous = projectGardenGame(null);
    const events = [...gardenGameEvents(previous, projectGardenGame(s))];
    previous = projectGardenGame(s);
    for (let i = 0; i < ids.length; i++) {
      const identity = { token: `token-${i + 1}`, nodeId: ids[i + 1] ?? null, sceneId: ids[i + 1] ?? null };
      s = {
        ...s,
        runtime: {
          ...s.runtime!,
          nodeId: ids[i + 1] ?? ids[i],
          visitId: i + 2,
          phase: "rendering",
          pendingRender: {
            identity,
            origin: { runtimeId: "run", nodeId: ids[i], visitId: i + 1, childTurnId: 1, transcriptRevision: 1 },
          },
        },
      };
      const rendering = projectGardenGame(s);
      expect(rendering.restored).toEqual(ids.slice(0, i));
      expect(rendering.encounter).toEqual({ id: ids[i], visitId: i + 1, probe: i === 3 ? "transfer" : "rehearsal" });
      expect(gardenGameEvents(previous, rendering).filter(event => event.type === "world.effect")).toEqual([]);
      events.push(...gardenGameEvents(previous, rendering));
      previous = rendering;
      s = {
        ...s,
        display: identity,
        runtime: {
          ...s.runtime!,
          phase: i === ids.length - 1 ? "complete" : "active",
          pendingRender: null,
          visitOutcomes: [
            ...(s.runtime!.visitOutcomes ?? []),
            {
              nodeId: ids[i],
              visitId: i + 1,
              outcome: "succeeded",
              source: { runtimeId: "run", nodeId: ids[i], visitId: i + 1, childTurnId: 1, transcriptRevision: 1 },
            },
          ],
        },
      };
      const confirmed = projectGardenGame(s);
      events.push(...gardenGameEvents(previous, confirmed));
      expect(gardenGameEvents(confirmed, confirmed)).toEqual([]);
      previous = confirmed;
    }
    expect(events).toEqual([
      { type: "game.started", runId: "run" },
      { type: "quest.started", runId: "run", questId: ids[0], visitId: 1, renderToken: "initial", probe: "rehearsal" },
      ...ids.flatMap((questId, i) => [
        { type: "quest.succeeded", runId: "run", questId },
        ...(i < 3
          ? [
              {
                type: "world.effect",
                runId: "run",
                questId,
                visitId: i + 1,
                effect: Object.values(GARDEN_WORLD_EFFECTS)[i],
              },
            ]
          : []),
        ...(i < 3
          ? [
              {
                type: "quest.started",
                runId: "run",
                questId: ids[i + 1],
                visitId: i + 2,
                renderToken: `token-${i + 1}`,
                probe: i === 2 ? "transfer" : "rehearsal",
              },
            ]
          : []),
      ]),
      { type: "game.ended", runId: "run", outcome: "completed", restored: [...ids], released: [] },
    ]);
    expect(events.filter(event => event.type === "world.effect")).toHaveLength(3);
    expect(previous.status).toBe("celebrating");
    expect(gardenGameEvents(previous, projectGardenGame({ ...s, error: "failed" }))).toEqual([]);
    expect(projectGardenGame({ ...s, error: "failed" }).status).toBe("error");
  });

  it("uses the real reducer to revert a pending success on stop", () => {
    const initial = createLessonRuntime("run", { lesson: GARDEN_RESCUE_LESSON });
    const identity = { token: "pending", nodeId: ids[1], sceneId: ids[1] };
    const rendering = {
      ...initial,
      nodeId: ids[1],
      visitId: 2,
      phase: "rendering" as const,
      lessonComplete: true,
      pendingRender: {
        identity,
        origin: { runtimeId: "run", nodeId: ids[0], visitId: 1, childTurnId: 1, transcriptRevision: 1 },
      },
    };
    const s = { ...snapshot(), runtime: rendering };
    const before = projectGardenGame(s);
    expect(before.restored).toEqual([]);
    const stopped = reduceLessonRuntime(
      rendering,
      { type: "stop", runtimeId: "run", atMs: 1 },
      GARDEN_RESCUE_LESSON,
    ).state;
    expect(stopped).toMatchObject({ nodeId: ids[0], phase: "stopped", lessonComplete: false, pendingRender: null });
    const after = projectGardenGame({ ...s, status: "ended", runtime: stopped });
    expect(gardenGameEvents(before, after)).toEqual([
      { type: "game.ended", runId: "run", outcome: "stopped", restored: [], released: [] },
    ]);
    expect(gardenGameEvents(after, projectGardenGame(snapshot()))).toEqual([]);
  });

  it("starts new runs and does not repeat successes across consecutive projections", () => {
    const first = projectGardenGame(snapshot());
    const progressed = projectGardenGame({
      ...snapshot(),
      display: { token: "two", nodeId: ids[1], sceneId: ids[1] },
      runtime: {
        ...snapshot().runtime!,
        nodeId: ids[1],
        visitId: 2,
        visitOutcomes: [
          {
            nodeId: ids[0],
            visitId: 1,
            outcome: "succeeded",
            source: { runtimeId: "run", nodeId: ids[0], visitId: 1, childTurnId: 1, transcriptRevision: 1 },
          },
        ],
      },
    });
    expect(gardenGameEvents(first, progressed).filter(e => e.type === "quest.succeeded")).toEqual([
      { type: "quest.succeeded", runId: "run", questId: ids[0] },
    ]);
    expect(gardenGameEvents(progressed, { ...progressed, quest: null })).toEqual([]);
    expect(gardenGameEvents(progressed, progressed)).toEqual([]);
    expect(gardenGameEvents(progressed, projectGardenGame(snapshot("new")))[0]).toEqual({
      type: "game.started",
      runId: "new",
    });
    expect(
      gardenGameEvents(progressed, projectGardenGame(snapshot("new"))).filter(e => e.type === "world.effect"),
    ).toEqual([]);
    expect(gardenGameEvents(first, projectGardenGame(null))).toEqual([]);
  });

  it("does not emit effects for an uncommitted answer", () => {
    const current = projectGardenGame(snapshot());
    const wrong = projectGardenGame({ ...snapshot(), awaitingSteering: true });
    expect(gardenGameEvents(current, wrong).filter(event => event.type === "world.effect")).toEqual([]);
  });

  it("records an unobserved committing visit as unknown", () => {
    const first = projectGardenGame(snapshot());
    const third = projectGardenGame({
      ...snapshot(),
      runtime: {
        ...snapshot().runtime!,
        nodeId: ids[2],
        visitId: 3,
        visitOutcomes: ids.slice(0, 2).map((nodeId, i) => ({
          nodeId,
          visitId: i + 1,
          outcome: "succeeded" as const,
          source: { runtimeId: "run", nodeId, visitId: i + 1, childTurnId: 1, transcriptRevision: 1 },
        })),
      },
    });
    expect(gardenGameEvents(first, third).filter(event => event.type === "world.effect")).toMatchObject([
      { questId: ids[0], visitId: 1 },
      { questId: ids[1], visitId: null },
    ]);
    const noEncounter = { ...first, encounter: null };
    expect(gardenGameEvents(noEncounter, third).filter(event => event.type === "world.effect")).toMatchObject([
      { visitId: null },
      { visitId: null },
    ]);
  });
});

it("projects released visits without success effects and finishes gently", () => {
  const before = projectGardenGame(snapshot());
  const source = { runtimeId: "run", nodeId: ids[0], visitId: 1, childTurnId: 3, transcriptRevision: 3 };
  const released = projectGardenGame({
    ...snapshot(),
    runtime: {
      ...snapshot().runtime!,
      phase: "complete",
      visitOutcomes: [{ nodeId: ids[0], visitId: 1, outcome: "released_after_support_limit", source }],
    },
  });
  expect(released.status).toBe("finished");
  expect(released.restored).toEqual([]);
  expect(released.released).toEqual([ids[0]]);
  expect(gardenGameEvents(before, released)).toEqual([
    { type: "quest.released", runId: "run", questId: ids[0] },
    { type: "game.ended", runId: "run", outcome: "completed", restored: [], released: [ids[0]] },
  ]);
});
