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
    detail: { proposal: { nodeId, answerOutcome: outcome } },
  });
  const stage = page.locator(`[data-node-id="${nodeId}"][data-scene-id]`);
  await expect(stage.locator("[data-success-numeral]")).toHaveCount(0);
  expect((await observer.read())?.snapshot.display.nodeId).toBe(nodeId);
  const acknowledged = await observer.cursor();
  await page.evaluate(() => {
    (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0.2;
  });
  await observer.waitForEvent("output.activity", { after: acknowledged, scope, detail: { state: "active" } });
  await page.evaluate(
    text => (window as unknown as LocalSessionWindow).sendTranscript("session.output_transcript.delta", text),
    outcome === "correct" ? "Yes, that's right!" : "Let's try again.",
  );
  if (outcome === "correct")
    await expect(stage.locator("[data-success-numeral]")).toHaveText(String(node.presentation.quantity));
  else await expect(stage.locator("[data-success-numeral]")).toHaveCount(0);
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
  for (const outcome of ["incorrect", "unclear"] as const) {
    verdict = outcome;
    await answer(page, observer, microphone, GARDEN_RESCUE_NODE_IDS[0], outcome);
    await scene(page, observer, GARDEN_RESCUE_NODE_IDS[0]);
    await expect(page.locator("[data-game-status]")).toHaveAttribute("data-game-restored", "");
  }
  verdict = "correct";
  await answer(page, observer, microphone, GARDEN_RESCUE_NODE_IDS[0]);
  await scene(page, observer, GARDEN_RESCUE_NODE_IDS[1]);
  await expect(page.locator("[data-game-status]")).toHaveAttribute("data-game-restored", GARDEN_RESCUE_NODE_IDS[0]);
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
  await answer(page, observer, microphone, GARDEN_RESCUE_NODE_IDS[0]);
  await scene(page, observer, GARDEN_RESCUE_NODE_IDS[1]);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(game).toHaveAttribute("data-game-status", "stopped");
  await expect(game).toHaveAttribute("data-game-restored", GARDEN_RESCUE_NODE_IDS[0]);
  await expect(page.locator('[data-scene-id="complete"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await scene(page, observer, GARDEN_RESCUE_NODE_IDS[0]);
  await expect(game).not.toHaveAttribute("data-game-run", run!);
  await expect(game).toHaveAttribute("data-game-restored", "");
  await expect(page.getByRole("list", { name: "Game events" }).locator("li")).toHaveCount(2);
});
