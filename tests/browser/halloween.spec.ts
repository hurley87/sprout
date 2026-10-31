import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import {
  COUNTING_HALLOWEEN_LESSON,
  COUNTING_HALLOWEEN_NODE_IDS,
} from "../../lib/lesson-runtime/counting-halloween-lesson";
import { classifierProposal } from "../helpers/runtime-classifier";
import { installLessonObserver, type LessonObserver } from "../helpers/lesson-observer";
import { installLocalSession, type LocalSessionWindow } from "../helpers/local-voice-session";
import { installSyntheticMicrophone } from "../helpers/synthetic-microphone";

type Microphone = Awaited<ReturnType<typeof installSyntheticMicrophone>>;
type Outcome = "correct" | "incorrect" | "unclear";

async function screenshots(page: Page, nodeId: string) {
  if (!process.env.HALLOWEEN_SCREENSHOTS) return;
  await mkdir("/tmp/halloween-review/screens", { recursive: true });
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1024, height: 640 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.screenshot({
      path: `/tmp/halloween-review/screens/${nodeId}-${viewport.width}x${viewport.height}.png`,
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
  const node = COUNTING_HALLOWEEN_LESSON.nodes[nodeId];
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

test("plays the Halloween adventure and restarts", async ({ page }) => {
  test.setTimeout(120_000);
  const { microphone, observer } = await setup(page);
  await page.goto("/halloween");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  for (const nodeId of COUNTING_HALLOWEEN_NODE_IDS) {
    const stage = await scene(page, observer, nodeId);
    const node = COUNTING_HALLOWEEN_LESSON.nodes[nodeId];
    await expect(stage.locator(`[data-counting-object="${node.presentation.object}"]`)).toHaveCount(
      Number(node.presentation.quantity),
    );
    await expect(stage.locator("[data-counting-object]")).toHaveCount(Number(node.presentation.quantity));
    await screenshots(page, nodeId);
    await answer(page, observer, microphone, nodeId);
  }
  await expect(page.getByRole("status")).toHaveText("Our Halloween counting party is complete!");
  const stage = page.locator('[data-scene-id="complete"]');
  await expect(stage.locator("[data-celebration-character]")).toHaveCount(4);
  await expect(stage.locator("[data-success-numeral], [data-counting-object]")).toHaveCount(0);
  await screenshots(page, "complete");
  await page.getByRole("button", { name: "Play again", exact: true }).click();
  await scene(page, observer, COUNTING_HALLOWEEN_NODE_IDS[0]);
});

test("lesson identity reaches live setup and diagnostics export", async ({ page }) => {
  const { observer } = await setup(page);
  for (const [path, lessonId] of [
    ["/halloween?debug=1", "counting-halloween"],
    ["/", "counting"],
  ]) {
    await page.goto(path);
    const request = page.waitForRequest(request => request.url().endsWith("/api/live") && request.method() === "POST");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    const liveRequest = await request;
    expect(liveRequest.postDataJSON().lessonId).toBe(lessonId);
    await (await liveRequest.response())!.finished();
    await scene(page, observer, lessonId === "counting" ? "count-1-duck" : COUNTING_HALLOWEEN_NODE_IDS[0]);
    if (lessonId === "counting-halloween") {
      const diagnostics = page.getByRole("complementary", { name: "Developer diagnostics" });
      const download = page.waitForEvent("download");
      await diagnostics.getByRole("button", { name: "Export diagnostics" }).click();
      const report = JSON.parse(await readFile((await (await download).path())!, "utf8"));
      expect(report.lessonId ?? report.runtime?.lessonId).toBe(lessonId);
      await page.reload();
      await expect(page.getByRole("status")).toHaveText("Come count Halloween friends with Sprout!");
    }
  }
});

test("wrong and unclear answers hold; correction advances", async ({ page }) => {
  test.setTimeout(60_000);
  let verdict: Outcome = "incorrect";
  const { microphone, observer } = await setup(page, () => verdict);
  await page.goto("/halloween");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await scene(page, observer, COUNTING_HALLOWEEN_NODE_IDS[0]);
  for (const outcome of ["incorrect", "unclear"] as const) {
    verdict = outcome;
    await answer(page, observer, microphone, COUNTING_HALLOWEEN_NODE_IDS[0], outcome);
    await expect(page.locator(`[data-node-id="${COUNTING_HALLOWEEN_NODE_IDS[0]}"][data-scene-id]`)).toBeVisible();
  }
  verdict = "correct";
  await answer(page, observer, microphone, COUNTING_HALLOWEEN_NODE_IDS[0]);
  await scene(page, observer, COUNTING_HALLOWEEN_NODE_IDS[1]);
});

test("reduced motion and stopping mid-adventure", async ({ page }) => {
  const { microphone, observer } = await setup(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/halloween");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const stage = await scene(page, observer, COUNTING_HALLOWEEN_NODE_IDS[0]);
  await expect
    .poll(() =>
      stage
        .locator("[data-counting-object] img")
        .evaluateAll(images => images.map(image => getComputedStyle(image).animationName)),
    )
    .toEqual(["none"]);
  await answer(page, observer, microphone, COUNTING_HALLOWEEN_NODE_IDS[0]);
  await scene(page, observer, COUNTING_HALLOWEEN_NODE_IDS[1]);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("We’ve stopped for now. You can play again whenever you like.");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await scene(page, observer, COUNTING_HALLOWEEN_NODE_IDS[0]);
});

test("Halloween direct load, refresh, diagnostics and garden remain available", async ({ page }) => {
  await page.goto("/halloween");
  await expect(page.getByRole("status")).toHaveText("Come count Halloween friends with Sprout!");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  await expect(page.locator('[data-counting-object="ghost"]')).toHaveCount(1);
  await expect(page.locator("[data-progress]")).toHaveCount(7);
  await expect(page.locator("[data-artwork-state]")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("status")).toHaveText("Come count Halloween friends with Sprout!");
  await page.goto("/halloween?debug=1");
  await expect(page.getByRole("complementary", { name: "Developer diagnostics" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("Come count with Sprout!");
  await expect(page.locator('[data-counting-object="duck"]')).toHaveCount(1);
});
