import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { ICE_CREAM_LESSON, ICE_CREAM_NODE_IDS } from "../../lib/lesson-runtime/ice-cream-lesson";
import { classifierProposal } from "../helpers/runtime-classifier";
import { installLessonObserver, type LessonObserver } from "../helpers/lesson-observer";
import { installLocalSession, type LocalSessionWindow } from "../helpers/local-voice-session";
import { installSyntheticMicrophone } from "../helpers/synthetic-microphone";

type Microphone = Awaited<ReturnType<typeof installSyntheticMicrophone>>;
type Outcome = "correct" | "incorrect" | "unclear";

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
      return (
        snapshot?.status === "live" &&
        snapshot.display.nodeId === nodeId &&
        snapshot.runtime?.phase === "active" &&
        !snapshot.awaitingSteering
      );
    })
    .toBe(true);
  return page.locator(`[data-scene-id][data-node-id="${nodeId}"]`);
}

async function answer(
  page: Page,
  observer: LessonObserver,
  microphone: Microphone,
  nodeId: string,
  text: string,
  outcome: Outcome = "correct",
) {
  await microphone.loadSpeech("counting");
  const before = await observer.cursor();
  const scope = { runtimeId: before.runtimeId, nodeId };
  const playback = await microphone.playSpeech("counting");
  await observer.waitForEvent("microphone.speech_started", { after: before, scope });
  await page.evaluate(
    value => (window as unknown as LocalSessionWindow).sendTranscript("session.input_transcript.delta", value),
    text,
  );
  expect(await microphone.waitForPlayback(playback.id)).toBe("ended");
  await observer.waitForEvent("microphone.speech_stopped", { after: before, scope });
  await observer.waitForEvent("classifier.result", {
    after: before,
    scope,
    detail: { proposal: { nodeId, answerOutcome: outcome } },
  });
  const acknowledged = await observer.cursor();
  await page.evaluate(() => {
    (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0.2;
  });
  await observer.waitForEvent("output.activity", { after: acknowledged, scope, detail: { state: "active" } });
  await page.evaluate(
    value => (window as unknown as LocalSessionWindow).sendTranscript("session.output_transcript.delta", value),
    outcome === "correct" ? "Yes, that's right!" : "Let's try again.",
  );
  if (outcome === "correct" && ICE_CREAM_LESSON.nodes[nodeId].presentation.answerKind === "order_step") {
    const stage = page.locator(`[data-node-id="${nodeId}"][data-scene-id]`);
    await expect(stage.locator("[data-landing]")).toHaveAttribute(
      "data-scoop",
      String(ICE_CREAM_LESSON.nodes[nodeId].presentation.answer),
    );
  }
  await page.evaluate(() => {
    (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0;
  });
  await observer.waitForEvent("output.activity", { after: acknowledged, scope, detail: { state: "quiet" } });
}

async function screenshots(page: Page, name: string) {
  if (!process.env.ICE_CREAM_SCREENSHOTS) return;
  await mkdir("/tmp/ice-cream-route-shots", { recursive: true });
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1024, height: 640 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    await page.screenshot({
      path: `/tmp/ice-cream-route-shots/${name}-${viewport.width}x${viewport.height}.png`,
      animations: "disabled",
    });
  }
}

test("voice-only shop progression and replay", async ({ page }) => {
  test.setTimeout(180_000);
  const { microphone, observer } = await setup(page);
  await page.goto("/ice-cream");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const expected = [
    [],
    ["pink"],
    ["pink", "yellow", "pink"],
    ["pink", "yellow"],
    ["pink", "pink", "yellow"],
    ["pink", "yellow", "chocolate"],
  ];
  const placed = [[], [], [], [], ["pink"], ["pink", "yellow", "chocolate"]];
  const cones = [2, 0, 0, 1, 1, 1];
  for (const [index, nodeId] of ICE_CREAM_NODE_IDS.entries()) {
    const stage = await scene(page, observer, nodeId);
    await expect(stage.locator("[data-scoop]")).toHaveCount(expected[index].length);
    expect(
      await stage.locator("[data-scoop]").evaluateAll(items => items.map(item => item.getAttribute("data-scoop"))),
    ).toEqual(expected[index]);
    expect(
      await stage.locator("[data-placed]").evaluateAll(items => items.map(item => item.getAttribute("data-scoop"))),
    ).toEqual(placed[index]);
    await expect(stage.locator('img[src*="/ice-cream/cone.svg"]')).toHaveCount(cones[index]);
    await screenshots(page, nodeId);
    await answer(page, observer, microphone, nodeId, String(ICE_CREAM_LESSON.nodes[nodeId].presentation.answer));
  }
  await expect(page.getByText("Every order is done. Great work, little helper!")).toBeVisible();
  await screenshots(page, "complete");
  await page.getByRole("button", { name: "Play again", exact: true }).click();
  const stage = await scene(page, observer, "count-cones");
  await expect(stage.locator("[data-placed]")).toHaveCount(0);
});

test("direct load, reload, lesson identity and diagnostics", async ({ page }) => {
  const { observer } = await setup(page);
  await page.goto("/ice-cream?debug=1");
  await expect(page).toHaveTitle("Evie's Ice Cream Shop");
  await page.reload();
  const request = page.waitForRequest(request => request.url().endsWith("/api/live") && request.method() === "POST");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const liveRequest = await request;
  expect(liveRequest.postDataJSON().lessonId).toBe("ice-cream-shop");
  await (await liveRequest.response())!.finished();
  await scene(page, observer, "count-cones");
  const download = page.waitForEvent("download");
  await page
    .getByRole("complementary", { name: "Developer diagnostics" })
    .getByRole("button", { name: "Export diagnostics" })
    .click();
  const report = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  expect(report.lessonId ?? report.runtime?.lessonId).toBe("ice-cream-shop");
});

test("wrong order colours and unclear answers never place scoops", async ({ page }) => {
  test.setTimeout(180_000);
  let verdict: Outcome = "correct";
  const { microphone, observer } = await setup(page, () => verdict);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ice-cream");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  for (const nodeId of ICE_CREAM_NODE_IDS.slice(0, 3)) {
    const stage = await scene(page, observer, nodeId);
    if (ICE_CREAM_LESSON.nodes[nodeId].presentation.answerKind === "count")
      await expect(stage).not.toHaveAttribute("aria-label", /\b(?:two|three|2|3)\b/i);
    await answer(page, observer, microphone, nodeId, String(ICE_CREAM_LESSON.nodes[nodeId].presentation.answer));
  }
  let stage = await scene(page, observer, "order-first");
  verdict = "incorrect";
  await answer(page, observer, microphone, "order-first", "yellow", verdict);
  await expect(stage.locator("[data-placed]")).toHaveCount(0);
  verdict = "unclear";
  await answer(page, observer, microphone, "order-first", "I need help", verdict);
  await expect(stage.locator("[data-placed]")).toHaveCount(0);
  verdict = "correct";
  await answer(page, observer, microphone, "order-first", "pink", verdict);
  stage = await scene(page, observer, "order-second");
  await expect(stage.locator('[data-placed][data-scoop="pink"]')).toHaveCount(1);
  verdict = "incorrect";
  await answer(page, observer, microphone, "order-second", "pink", verdict);
  await expect(stage.locator("[data-placed]")).toHaveCount(1);
  verdict = "correct";
  await answer(page, observer, microphone, "order-second", "yellow", verdict);
  stage = await scene(page, observer, "count-scoops");
  await expect
    .poll(() =>
      stage
        .locator("[data-scoop] img")
        .evaluateAll(images => images.map(image => getComputedStyle(image).animationName)),
    )
    .toEqual(["none", "none", "none"]);
  await expect(stage.locator("[data-placed]")).toHaveCount(3);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  stage = await scene(page, observer, "count-cones");
  await expect(stage.locator("[data-placed]")).toHaveCount(0);
});
