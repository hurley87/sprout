import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { GARDEN_RESCUE_LESSON, GARDEN_RESCUE_NODE_IDS } from "../../lib/lesson-runtime/garden-rescue-lesson";
import { classifierProposal } from "../helpers/runtime-classifier";
import { installLessonObserver, type LessonObserver } from "../helpers/lesson-observer";
import { installLocalSession, type LocalSessionWindow } from "../helpers/local-voice-session";
import { installSyntheticMicrophone } from "../helpers/synthetic-microphone";

type Microphone = Awaited<ReturnType<typeof installSyntheticMicrophone>>;
type Outcome = "correct" | "incorrect" | "unclear";

async function screenshots(page: Page, nodeId: string) {
  if (!process.env.GARDEN_SCREENSHOTS) return;
  await mkdir("/tmp/garden-rescue-shots", { recursive: true });
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1024, height: 640 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.screenshot({
      path: `/tmp/garden-rescue-shots/${nodeId}-${viewport.width}x${viewport.height}.png`,
      animations: "disabled",
    });
  }
}

async function setup(page: Page, verdict: () => Outcome = () => "correct") {
  const microphone = await installSyntheticMicrophone(page);
  await installLocalSession(page);
  const observer = await installLessonObserver(page);
  await page.route("**/api/classify", route =>
    route.fulfill({
      json: {
        proposal: classifierProposal(route.request().postDataJSON(), {
          answerOutcome: verdict(),
          answerCommitment: "committed",
          supportState: verdict() === "unclear" ? "needs_help" : "none",
          tutorState: "acknowledging",
        }),
      },
    }),
  );
  return { microphone, observer };
}

async function scene(page: Page, observer: LessonObserver, nodeId: string) {
  await expect
    .poll(async () => {
      const snapshot = (await observer.read())?.snapshot;
      return snapshot?.display.nodeId === nodeId && snapshot.runtime?.phase === "active" && !snapshot.awaitingSteering;
    })
    .toBe(true);
  return page.locator(`[data-scene-id][data-node-id="${nodeId}"]`);
}

async function answer(
  page: Page,
  observer: LessonObserver,
  microphone: Microphone,
  nodeId: string,
  outcome: Outcome = "correct",
  duringSuccess?: () => Promise<void | "stopped">,
  tutorResponse?: string,
) {
  const node = GARDEN_RESCUE_LESSON.nodes[nodeId];
  await microphone.loadSpeech("counting");
  const before = await observer.cursor();
  const scope = { runtimeId: before.runtimeId, nodeId };
  const playback = await microphone.playSpeech("counting");
  await observer.waitForEvent("microphone.speech_started", { after: before, scope });
  await page.evaluate(
    text => (window as unknown as LocalSessionWindow).sendTranscript("session.input_transcript.delta", text),
    outcome === "unclear" ? "I don't know." : `${node.presentation.quantity}.`,
  );
  expect(await microphone.waitForPlayback(playback.id)).toBe("ended");
  await observer.waitForEvent("microphone.speech_stopped", { after: before, scope });
  await observer.waitForEvent("classifier.result", {
    after: before,
    scope,
    detail: {
      proposal: { nodeId, answerOutcome: outcome, supportState: outcome === "unclear" ? "needs_help" : "none" },
    },
  });
  const stage = page.locator(`[data-node-id="${nodeId}"][data-scene-id]`);
  await expect(stage.locator("[data-success-numeral]")).toHaveCount(0);
  if (nodeId !== GARDEN_RESCUE_NODE_IDS[3]) await expect(stage).toHaveAttribute("data-effect-state", "before");
  expect((await observer.read())?.snapshot.display.nodeId).toBe(nodeId);
  const acknowledged = await observer.cursor();
  await page.evaluate(() => {
    (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0.2;
  });
  await observer.waitForEvent("output.activity", { after: acknowledged, scope, detail: { state: "active" } });
  await page.evaluate(
    text => (window as unknown as LocalSessionWindow).sendTranscript("session.output_transcript.delta", text),
    tutorResponse ?? (outcome === "correct" ? "Yes, that's right!" : "Let's try again."),
  );
  if (outcome === "correct") {
    await expect(stage.locator("[data-success-numeral]")).toHaveText(String(node.presentation.quantity));
    if ((await duringSuccess?.()) === "stopped") return;
  } else await expect(stage.locator("[data-success-numeral]")).toHaveCount(0);
  await page.evaluate(() => {
    (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0;
  });
  await observer.waitForEvent("output.activity", { after: acknowledged, scope, detail: { state: "quiet" } });
}

test("plays the fixed quest order and records events", async ({ page }) => {
  test.setTimeout(120_000);
  const { microphone, observer } = await setup(page);
  await page.goto("/games/garden?debug=1");
  await screenshots(page, "before-play");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const game = page.locator("[data-game-status]");
  for (const [index, nodeId] of GARDEN_RESCUE_NODE_IDS.entries()) {
    const stage = await scene(page, observer, nodeId);
    const node = GARDEN_RESCUE_LESSON.nodes[nodeId];
    await expect(stage.locator(`[data-counting-object="${node.presentation.object}"]`)).toHaveCount(
      Number(node.presentation.quantity),
    );
    await screenshots(page, nodeId);
    await expect(game).toHaveAttribute("data-game-restored", GARDEN_RESCUE_NODE_IDS.slice(0, index).join(" "));
    await answer(page, observer, microphone, nodeId);
    await expect(game).toHaveAttribute("data-game-restored", GARDEN_RESCUE_NODE_IDS.slice(0, index).join(" "));
    if (index < 3) await scene(page, observer, GARDEN_RESCUE_NODE_IDS[index + 1]);
    else await expect(game).toHaveAttribute("data-game-status", "celebrating");
    await expect(game).toHaveAttribute("data-game-restored", GARDEN_RESCUE_NODE_IDS.slice(0, index + 1).join(" "));
    const dots = page.getByRole("list", { name: "Adventure progress" }).locator("li");
    await expect(dots.locator("img")).toHaveCount(Math.min(index + 1, 3));
    await expect(dots.nth(index).locator("img")).toHaveCount(index < 3 ? 1 : 0);
  }
  await expect(page.locator('[data-scene-id="complete"]')).toBeVisible();
  const celebration = page.locator('[data-scene-id="complete"]');
  await expect(celebration.locator('[data-celebration-character="duckling"]')).toHaveCount(3);
  await expect(celebration.locator('[data-celebration-character="lily-pad"]')).toHaveCount(3);
  await expect(celebration.locator('[data-celebration-character="butterfly-awake"]')).toHaveCount(3);
  await expect(celebration.locator("[data-celebration-flower]")).toHaveCount(4);
  const events = await page.getByRole("list", { name: "Game events" }).locator("li").allTextContents();
  const parsedEvents = events.map(event => JSON.parse(event));
  const effects = parsedEvents.filter(event => event.type === "world.effect");
  expect(effects.map(event => event.effect)).toEqual(["ducklings.crossed", "butterflies.awakened", "flowers.bloomed"]);
  for (const effect of effects) {
    const index = parsedEvents.indexOf(effect);
    expect(parsedEvents[index - 1]).toMatchObject({ type: "quest.succeeded", questId: effect.questId });
    const started = parsedEvents.find(event => event.type === "quest.started" && event.questId === effect.questId);
    expect(typeof effect.visitId).toBe("number");
    expect(effect.visitId).toBe(started.visitId);
  }
  expect(
    events.map(event => {
      const e = JSON.parse(event);
      return [e.type, e.questId ?? e.outcome].filter(Boolean).join(":");
    }),
  ).toEqual([
    "game.started",
    ...GARDEN_RESCUE_NODE_IDS.flatMap((id, index) => [
      `quest.started:${id}`,
      `quest.succeeded:${id}`,
      ...(index < 3 ? [`world.effect:${id}`] : []),
    ]),
    "game.ended:completed",
  ]);
  await screenshots(page, "celebration");
});

test("stopping during an effect discards it and restarting creates a fresh run", async ({ page }) => {
  test.setTimeout(120_000);
  const { microphone, observer } = await setup(page);
  await page.goto("/games/garden?debug=1");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const game = page.locator("[data-game-status]");
  const nodeId = GARDEN_RESCUE_NODE_IDS[0];
  const stage = await scene(page, observer, nodeId);
  const runId = await game.getAttribute("data-game-run");
  expect(runId).toBeTruthy();
  await answer(page, observer, microphone, nodeId, "correct", async () => {
    await expect(stage).toHaveAttribute("data-effect-state", "playing");
    await expect(stage.locator("[data-world-prop]")).toHaveCount(3);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    return "stopped";
  });
  await expect(game).toHaveAttribute("data-game-status", "stopped");
  await expect(game).toHaveAttribute("data-game-restored", "");
  await expect(page.locator('[data-scene-id][data-world-effect]:not([data-effect-state="before"])')).toHaveCount(0);
  await expect(page.locator("[data-world-prop]")).toHaveCount(0);
  const eventItems = page.getByRole("list", { name: "Game events" }).locator("li");
  expect((await eventItems.allTextContents()).map(event => JSON.parse(event).type)).not.toContain("world.effect");
  expect((await eventItems.allTextContents()).map(event => JSON.parse(event).type)).not.toContain("quest.succeeded");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const restarted = await scene(page, observer, nodeId);
  await expect(game).not.toHaveAttribute("data-game-run", runId!);
  const newRunId = await game.getAttribute("data-game-run");
  await expect(restarted).toHaveAttribute("data-effect-state", "before");
  await expect(restarted.locator("[data-world-prop]")).toHaveCount(0);
  await answer(page, observer, microphone, nodeId);
  await scene(page, observer, GARDEN_RESCUE_NODE_IDS[1]);
  const effects = (await eventItems.allTextContents())
    .map(event => JSON.parse(event))
    .filter(event => event.type === "world.effect");
  expect(effects).toHaveLength(1);
  expect(effects[0]).toMatchObject({ runId: newRunId, questId: nodeId, effect: "ducklings.crossed" });
});

test("effects and counting objects remain within responsive stages", async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { microphone, observer } = await setup(page);
  await page.goto("/games/garden?debug=1");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  for (const [index, nodeId] of GARDEN_RESCUE_NODE_IDS.slice(0, 3).entries()) {
    const stage = await scene(page, observer, nodeId);
    await answer(page, observer, microphone, nodeId, "correct", async () => {
      await expect(stage).toHaveAttribute("data-effect-state", "playing");
      await expect(stage.locator("[data-world-prop]")).toHaveCount(index === 2 ? 4 : 3);
      for (const viewport of [
        { width: 1440, height: 1000 },
        { width: 1024, height: 640 },
        { width: 390, height: 844 },
        { width: 844, height: 390 },
      ]) {
        await page.setViewportSize(viewport);
        const objects = stage.locator("[data-counting-object]");
        await expect(objects).toHaveCount(index === 2 ? 4 : 3);
        await expect(
          stage.locator(`[data-counting-object="${["duckling", "butterfly", "sprout"][index]}"]`),
        ).toHaveCount(index === 2 ? 4 : 3);
        const bounds = await stage.boundingBox();
        expect(bounds).not.toBeNull();
        for (const item of await stage.locator("[data-world-prop], [data-counting-object]").all()) {
          const box = await item.boundingBox();
          expect(box, `${nodeId} at ${viewport.width}x${viewport.height}`).not.toBeNull();
          expect(box!.x).toBeGreaterThanOrEqual(bounds!.x - 1);
          expect(box!.y).toBeGreaterThanOrEqual(bounds!.y - 1);
          expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
          expect(box!.y + box!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height + 1);
        }
      }
    });
  }
});

test("a correct answer after help reveals the effect only on acceptance", async ({ page }) => {
  test.setTimeout(90_000);
  let verdict: Outcome = "unclear";
  const { microphone, observer } = await setup(page, () => verdict);
  await page.goto("/games/garden?debug=1");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const nodeId = GARDEN_RESCUE_NODE_IDS[0];
  const stage = await scene(page, observer, nodeId);
  await answer(page, observer, microphone, nodeId, "unclear", undefined, "Let's count them together: one, two, three.");
  await scene(page, observer, nodeId);
  await expect(stage).toHaveAttribute("data-effect-state", "before");
  await expect(stage.locator("[data-world-prop]")).toHaveCount(0);
  verdict = "correct";
  await answer(page, observer, microphone, nodeId, "correct", async () => {
    await expect(stage).toHaveAttribute("data-effect-state", "playing");
    await expect(stage.locator("[data-world-prop]")).toHaveCount(3);
  });
  await scene(page, observer, GARDEN_RESCUE_NODE_IDS[1]);
  const events = await page.getByRole("list", { name: "Game events" }).locator("li").allTextContents();
  expect(events.map(event => JSON.parse(event)).filter(event => event.type === "world.effect")).toHaveLength(1);
});

for (const reducedMotion of [false, true]) {
  test(`flowers bloom after counting sprouts${reducedMotion ? " with reduced motion" : ""}`, async ({ page }) => {
    test.setTimeout(120_000);
    if (reducedMotion) await page.emulateMedia({ reducedMotion: "reduce" });
    let verdict: Outcome = "correct";
    const { microphone, observer } = await setup(page, () => verdict);
    await page.goto("/games/garden?debug=1");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    for (const nodeId of GARDEN_RESCUE_NODE_IDS.slice(0, 2)) {
      await scene(page, observer, nodeId);
      await answer(page, observer, microphone, nodeId);
    }
    const stage = await scene(page, observer, "grow-flowers");
    const sprouts = stage.locator('[data-counting-object="sprout"]');
    const flowers = stage.locator('[data-world-prop="flower-bloomed"]');
    const expectBefore = async () => {
      await expect(stage).toHaveAttribute("data-effect-state", "before");
      await expect(sprouts).toHaveCount(4);
      await expect(flowers).toHaveCount(0);
    };
    await expectBefore();
    if (!reducedMotion) {
      await screenshots(page, "grow-flowers-before");
      for (const outcome of ["incorrect", "unclear"] as const) {
        verdict = outcome;
        await answer(page, observer, microphone, "grow-flowers", outcome);
        await scene(page, observer, "grow-flowers");
        await expectBefore();
      }
    }
    verdict = "correct";
    await answer(page, observer, microphone, "grow-flowers", "correct", async () => {
      await expect(stage).toHaveAttribute("data-effect-state", "playing");
      await expect(sprouts).toHaveCount(4);
      await expect(flowers).toHaveCount(4);
      if (reducedMotion) {
        expect(await sprouts.evaluateAll(items => items.map(item => getComputedStyle(item).opacity))).toEqual([
          "0",
          "0",
          "0",
          "0",
        ]);
        expect(
          await flowers.locator("img").evaluateAll(items =>
            items.map(item => ({
              opacity: getComputedStyle(item).opacity,
              animation: getComputedStyle(item).animationName,
            })),
          ),
        ).toEqual(Array(4).fill({ opacity: "1", animation: "none" }));
      } else await screenshots(page, "grow-flowers-success");
    });
    await scene(page, observer, "fresh-challenge");
    const events = await page.getByRole("list", { name: "Game events" }).locator("li").allTextContents();
    expect(
      events
        .map(event => JSON.parse(event))
        .filter(event => event.type === "world.effect" && event.questId === "grow-flowers"),
    ).toHaveLength(1);
  });
}

test("direct load, reload, diagnostics and live lesson identity", async ({ page }) => {
  const { observer } = await setup(page);
  await page.goto("/games/garden");
  for (let i = 0; i < 2; i++) {
    await expect(page.getByRole("status")).toHaveText("Help the animals bring the garden back to life.");
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
    await expect(page.locator('[data-counting-object="duckling"]')).toHaveCount(3);
    await expect(page.locator("[data-progress]")).toHaveCount(4);
    await expect(page.locator("[data-artwork-state]")).toHaveCount(0);
    await expect(page.locator("[data-game-status]")).toHaveAttribute("data-game-status", "ready");
    if (i === 0) await page.reload();
  }
  for (const [path, id, node] of [
    ["/games/garden?debug=1", "garden-rescue", GARDEN_RESCUE_NODE_IDS[0]],
    ["/", "counting", "count-1-duck"],
  ]) {
    await page.goto(path);
    if (id === "garden-rescue") await expect(page.getByRole("region", { name: "Game state" })).toBeVisible();
    const request = page.waitForRequest(req => req.url().endsWith("/api/live") && req.method() === "POST");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    const liveRequest = await request;
    expect(liveRequest.postDataJSON().lessonId).toBe(id);
    await (await liveRequest.response())!.finished();
    await scene(page, observer, node);
  }
});

test("incorrect and unclear answers hold until correction", async ({ page }) => {
  test.setTimeout(60_000);
  let verdict: Outcome = "incorrect";
  const { microphone, observer } = await setup(page, () => verdict);
  await page.goto("/games/garden");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await scene(page, observer, GARDEN_RESCUE_NODE_IDS[0]);
  const stage = page.locator('[data-scene-id="rescue-ducklings"]');
  await expect(stage).toHaveAttribute("data-effect-state", "before");
  await expect(stage.locator('[data-world-prop="lily-pad"]')).toHaveCount(0);
  for (const outcome of ["incorrect", "unclear"] as const) {
    verdict = outcome;
    await answer(page, observer, microphone, GARDEN_RESCUE_NODE_IDS[0], outcome);
    await scene(page, observer, GARDEN_RESCUE_NODE_IDS[0]);
    await expect(stage).toHaveAttribute("data-effect-state", "before");
    await expect(stage.locator('[data-world-prop="lily-pad"]')).toHaveCount(0);
    await expect(page.locator("[data-game-status]")).toHaveAttribute("data-game-restored", "");
  }
  verdict = "correct";
  await answer(page, observer, microphone, GARDEN_RESCUE_NODE_IDS[0], "correct", async () => {
    await expect(stage).toHaveAttribute("data-effect-state", "playing");
    await expect(stage.locator('[data-world-prop="lily-pad"]')).toHaveCount(3);
    await expect(stage.locator('[data-counting-object="duckling"]')).toHaveCount(3);
    await screenshots(page, "duckling-crossing");
  });
  await scene(page, observer, GARDEN_RESCUE_NODE_IDS[1]);
  await expect(page.locator("[data-game-status]")).toHaveAttribute("data-game-restored", GARDEN_RESCUE_NODE_IDS[0]);
});

test("butterflies awaken only after a correct answer", async ({ page }) => {
  test.setTimeout(120_000);
  let verdict: Outcome = "correct";
  const { microphone, observer } = await setup(page, () => verdict);
  await page.goto("/games/garden?debug=1");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await scene(page, observer, GARDEN_RESCUE_NODE_IDS[0]);
  await answer(page, observer, microphone, GARDEN_RESCUE_NODE_IDS[0]);
  const nodeId = GARDEN_RESCUE_NODE_IDS[1];
  const stage = await scene(page, observer, nodeId);
  const awake = stage.locator('[data-world-prop="butterfly-awake"]');
  const expectBefore = async () => {
    await expect(stage).toHaveAttribute("data-effect-state", "before");
    await expect(awake).toHaveCount(0);
  };
  await expectBefore();
  for (const outcome of ["incorrect", "unclear"] as const) {
    verdict = outcome;
    await answer(page, observer, microphone, nodeId, outcome);
    await scene(page, observer, nodeId);
    await expectBefore();
  }
  verdict = "correct";
  await answer(page, observer, microphone, nodeId, "correct", async () => {
    await expect(stage).toHaveAttribute("data-effect-state", "playing");
    await expect(awake).toHaveCount(3);
    await expect(stage.locator('[data-counting-object="butterfly"]')).toHaveCount(3);
    await screenshots(page, "butterfly-awakening");
  });
  await scene(page, observer, GARDEN_RESCUE_NODE_IDS[2]);
  const events = await page.getByRole("list", { name: "Game events" }).locator("li").allTextContents();
  expect(
    events.map(event => JSON.parse(event)).filter(event => event.type === "world.effect" && event.questId === nodeId),
  ).toHaveLength(1);
});

test("reduced motion, stop and new run", async ({ page }) => {
  const { microphone, observer } = await setup(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/games/garden?debug=1");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const stage = await scene(page, observer, GARDEN_RESCUE_NODE_IDS[0]);
  await expect
    .poll(() =>
      stage
        .locator("[data-counting-object] img")
        .evaluateAll(images => images.map(image => getComputedStyle(image).animationName)),
    )
    .toEqual(["none", "none", "none"]);
  const game = page.locator("[data-game-status]");
  const run = await game.getAttribute("data-game-run");
  const beforePositions = await stage
    .locator('[data-counting-object="duckling"]')
    .evaluateAll(objects => objects.map(object => object.getBoundingClientRect().top));
  await answer(page, observer, microphone, GARDEN_RESCUE_NODE_IDS[0], "correct", async () => {
    await expect(stage).toHaveAttribute("data-effect-state", "playing");
    const pads = stage.locator('[data-world-prop="lily-pad"]');
    await expect(pads).toHaveCount(3);
    for (const pad of await pads.all()) await expect(pad).toBeVisible();
    expect(await pads.evaluateAll(objects => objects.map(object => getComputedStyle(object).animationName))).toEqual([
      "none",
      "none",
      "none",
    ]);
    const afterPositions = await stage
      .locator('[data-counting-object="duckling"]')
      .evaluateAll(objects => objects.map(object => object.getBoundingClientRect().top));
    afterPositions.forEach((position, index) => expect(position).toBeLessThan(beforePositions[index]));
  });
  const butterflyStage = await scene(page, observer, GARDEN_RESCUE_NODE_IDS[1]);
  await answer(page, observer, microphone, GARDEN_RESCUE_NODE_IDS[1], "correct", async () => {
    await expect(butterflyStage).toHaveAttribute("data-effect-state", "playing");
    const sleeping = butterflyStage.locator('[data-character="butterfly-sleeping"] img');
    const awake = butterflyStage.locator('[data-world-prop="butterfly-awake"]');
    await expect(awake).toHaveCount(3);
    await expect
      .poll(() => sleeping.evaluateAll(images => images.map(image => getComputedStyle(image).opacity)))
      .toEqual(["0", "0", "0"]);
    await expect
      .poll(() =>
        awake.evaluateAll(props =>
          props.map(prop => ({
            opacity: getComputedStyle(prop).opacity,
            animation: getComputedStyle(prop).animationName,
          })),
        ),
      )
      .toEqual(Array(3).fill({ opacity: "1", animation: "none" }));
  });
  await scene(page, observer, GARDEN_RESCUE_NODE_IDS[2]);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(game).toHaveAttribute("data-game-status", "stopped");
  await expect(game).toHaveAttribute("data-game-restored", GARDEN_RESCUE_NODE_IDS.slice(0, 2).join(" "));
  await expect(page.locator('[data-scene-id="complete"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await scene(page, observer, GARDEN_RESCUE_NODE_IDS[0]);
  await expect(game).not.toHaveAttribute("data-game-run", run!);
  await expect(game).toHaveAttribute("data-game-restored", "");
  await expect(page.getByRole("list", { name: "Game events" }).locator("li")).toHaveCount(2);
});
