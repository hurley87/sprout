import { expect, test, type Locator, type Page } from "@playwright/test";
import { GARDEN_RESCUE_LESSON, GARDEN_RESCUE_NODE_IDS } from "../../lib/lesson-runtime/garden-rescue-lesson";
import { classifierProposal } from "../helpers/runtime-classifier";
import { installLessonObserver, type LessonObserver } from "../helpers/lesson-observer";
import type { LocalSessionWindow } from "../helpers/local-voice-session";
import { installLocalSession } from "../helpers/local-voice-session";
import { installSyntheticMicrophone } from "../helpers/synthetic-microphone";

const viewports = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1180, height: 820 },
  { width: 1440, height: 1000 },
  { width: 844, height: 390 },
  { width: 932, height: 430 },
  { width: 1024, height: 600 },
];

async function clearOfObjects(page: Page, button: Locator) {
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  const objects = page.locator("[data-counting-object]");
  expect(await objects.count()).toBeGreaterThan(0);
  for (const object of await objects.all()) {
    const other = await object.boundingBox();
    expect(other).not.toBeNull();
    expect(
      box!.x + box!.width <= other!.x ||
        other!.x + other!.width <= box!.x ||
        box!.y + box!.height <= other!.y ||
        other!.y + other!.height <= box!.y,
    ).toBe(true);
  }
}

for (const viewport of viewports) {
  test(`plain Garden controls at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installSyntheticMicrophone(page);
    await installLocalSession(page);
    await page.goto("/games/garden");
    await expect(page.getByRole("complementary", { name: "Developer diagnostics" })).toHaveCount(0);
    const play = page.getByRole("button", { name: "Play", exact: true });
    await clearOfObjects(page, play);
    await play.click();
    const stop = page.getByRole("button", { name: "Stop", exact: true });
    await clearOfObjects(page, stop);
    await stop.click();
    await expect(page.locator("[data-game-status]")).toHaveAttribute("data-game-status", "stopped");
    await clearOfObjects(page, play);
    await play.click();
    await expect(stop).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Developer diagnostics" })).toHaveCount(0);
  });
}

type Microphone = Awaited<ReturnType<typeof installSyntheticMicrophone>>;
type Outcome = "correct" | "incorrect" | "unclear";

async function setup(page: Page, verdict: () => Outcome = () => "correct", hint?: RegExp) {
  const microphone = await installSyntheticMicrophone(page);
  await installLocalSession(page);
  const observer = await installLessonObserver(page);
  await page.route("**/api/classify", route => {
    const input = route.request().postDataJSON();
    const tutor = String(input.transcript ?? "")
      .split("\n")
      .findLast(line => line.startsWith("Tutor:"));
    return route.fulfill({
      json: {
        proposal: classifierProposal(input, {
          answerOutcome: verdict(),
          answerCommitment: "committed",
          supportState: verdict() === "unclear" ? "needs_help" : "none",
          tutorState: hint && tutor && hint.test(tutor) ? "helping" : "acknowledging",
        }),
      },
    });
  });
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

test("Play again stays reachable after a completed plain Garden game", async ({ page }) => {
  test.setTimeout(120_000);
  const { microphone, observer } = await setup(page);
  await page.goto("/games/garden");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  for (const nodeId of GARDEN_RESCUE_NODE_IDS) {
    await scene(page, observer, nodeId);
    await answer(page, observer, microphone, nodeId);
  }
  await expect(page.locator("[data-game-status]")).toHaveAttribute("data-game-status", "celebrating");
  const replay = page.getByRole("button", { name: "Play again", exact: true });
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect(replay).toBeVisible();
    const box = await replay.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    await expect(page.getByRole("complementary", { name: "Developer diagnostics" })).toHaveCount(0);
  }
  await replay.click();
  await scene(page, observer, GARDEN_RESCUE_NODE_IDS[0]);
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
});
