import { expect, test, type Page } from "@playwright/test";
import { GARDEN_RESCUE_LESSON, GARDEN_RESCUE_NODE_IDS } from "../../lib/lesson-runtime/garden-rescue-lesson";
import { classifierProposal } from "../helpers/runtime-classifier";
import { installLessonObserver, type LessonObserver } from "../helpers/lesson-observer";
import { installLocalSession, type LocalSessionWindow } from "../helpers/local-voice-session";
import { installSyntheticMicrophone } from "../helpers/synthetic-microphone";

type Microphone = Awaited<ReturnType<typeof installSyntheticMicrophone>>;
type Outcome = "correct" | "incorrect" | "unclear";

/** `hint` labels the latest tutor line "helping" when it matches, as a real classifier describes the
 * latest tutor message even when the child spoke after it; otherwise tutor turns are acknowledging. */
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

test("keyboard controls retain visible focus through scene changes", async ({ page }) => {
  test.setTimeout(120_000);
  const { microphone, observer } = await setup(page);
  await page.goto("/games/garden");
  const play = page.getByRole("button", { name: "Play", exact: true });
  await page.keyboard.press("Tab");
  await expect(play).toBeFocused();
  expect(await play.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe("none");
  await page.keyboard.press("Enter");
  await scene(page, observer, GARDEN_RESCUE_NODE_IDS[0]);
  const stop = page.getByRole("button", { name: "Stop", exact: true });
  await page.keyboard.press("Tab");
  await expect(stop).toBeFocused();
  expect(await stop.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe("none");
  await answer(page, observer, microphone, GARDEN_RESCUE_NODE_IDS[0]);
  await scene(page, observer, GARDEN_RESCUE_NODE_IDS[1]);
  await expect(stop).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.locator("[data-game-status]")).toHaveAttribute("data-game-status", "stopped");
  await page.keyboard.press("Tab");
  await expect(play).toBeFocused();
  await page.keyboard.press("Space");
  for (const nodeId of GARDEN_RESCUE_NODE_IDS) {
    await scene(page, observer, nodeId);
    await answer(page, observer, microphone, nodeId);
  }
  const again = page.getByRole("button", { name: "Play again" });
  await expect(again).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(again).toBeFocused();
  await page.keyboard.press("Enter");
  await scene(page, observer, GARDEN_RESCUE_NODE_IDS[0]);
});

test("quest descriptions, decorative images and polite status", async ({ page }) => {
  const { observer } = await setup(page);
  await page.goto("/games/garden");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const stage = await scene(page, observer, GARDEN_RESCUE_NODE_IDS[0]);
  await expect(stage).toHaveAccessibleName("3 ducklings to count");
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(1);
  await expect(page.getByRole("status")).not.toBeEmpty();
  const images = stage.locator("img");
  expect(await images.count()).toBeGreaterThan(0);
  for (const image of await images.all()) await expect(image).toHaveAttribute("alt", "");
});

test("each authored quest has distinct countable objects and reduced-motion effects", async ({ page }) => {
  test.setTimeout(120_000);
  const { microphone, observer } = await setup(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/games/garden");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  for (const [index, nodeId] of GARDEN_RESCUE_NODE_IDS.entries()) {
    const stage = await scene(page, observer, nodeId);
    const node = GARDEN_RESCUE_LESSON.nodes[nodeId];
    const name = node.presentation.object === "butterfly" ? "butterflies" : `${node.presentation.object}s`;
    await expect(stage).toHaveAccessibleName(`${node.presentation.quantity} ${name} to count`);
    const announcement = page.locator('[aria-live="polite"][aria-atomic="true"]');
    await expect(announcement).toHaveText(`Garden quest: ${nodeId.replaceAll("-", " ")}`);
    const objects = stage.locator("[data-counting-object]");
    await expect(objects).toHaveCount(Number(node.presentation.quantity));
    const boxes = await objects.evaluateAll(els =>
      els.map(el => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      }),
    );
    for (let a = 0; a < boxes.length; a++)
      for (let b = a + 1; b < boxes.length; b++) {
        expect(
          boxes[a].right <= boxes[b].left ||
            boxes[b].right <= boxes[a].left ||
            boxes[a].bottom <= boxes[b].top ||
            boxes[b].bottom <= boxes[a].top,
        ).toBe(true);
      }
    await answer(page, observer, microphone, nodeId, "correct", async () => {
      if (index < 3) {
        const props = stage.locator("[data-world-prop]");
        await expect(props).toHaveCount(Number(node.presentation.quantity));
        for (const prop of await props.all()) await expect(prop).toBeVisible();
        expect(await props.evaluateAll(els => els.map(el => getComputedStyle(el).animationName))).toEqual(
          Array(Number(node.presentation.quantity)).fill("none"),
        );
      }
    });
  }
});

test("failed Garden artwork leaves a countable fallback for each object", async ({ page }) => {
  test.setTimeout(120_000);
  const { observer, microphone } = await setup(page);
  await page.route("**/*", route => {
    const url = decodeURIComponent(route.request().url());
    return /\/garden-rescue\/.*\.(png|jpg)/.test(url) ? route.abort() : route.fallback();
  });
  await page.goto("/games/garden");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  for (const nodeId of GARDEN_RESCUE_NODE_IDS) {
    const stage = await scene(page, observer, nodeId);
    const fallbacks = stage.locator("[data-counting-object] [data-artwork-fallback]");
    await expect(fallbacks).toHaveCount(Number(GARDEN_RESCUE_LESSON.nodes[nodeId].presentation.quantity));
    for (const fallback of await fallbacks.all()) await expect(fallback).toBeVisible();
    await expect(stage.locator('[data-artwork-state="error"]')).toHaveCount(0);
    await answer(page, observer, microphone, nodeId);
  }
});

test("other lesson and adult demo routes retain their entry scenes", async ({ page }) => {
  for (const [path, node] of [
    ["/", "count-1-duck"],
    ["/halloween", "count-1-ghost"],
    ["/concert", "count-1-microphone"],
    ["/ice-cream", "count-cones"],
  ]) {
    await page.goto(path);
    await expect(page.locator(`[data-node-id="${node}"]`)).toBeVisible();
    await expect(page.locator("[data-game-status]")).toHaveCount(0);
  }
  for (const path of [
    "/demos/catching-unicorns",
    "/demos/latex",
    "/demos/mae386",
    "/demos/math-steps",
    "/demos/math-steps/reciprocal",
    "/demos/math-steps/difference-quotient",
    "/demos/calculus",
  ]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator("[data-game-status]")).toHaveCount(0);
  }
});
