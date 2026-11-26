import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { CHRISTMAS_TREE_KINDS, christmasTreeArrangement } from "../../lib/lesson-runtime/christmas-tree-arrangement";
import {
  CHRISTMAS_TREE_NODE_IDS,
  christmasTreeLesson,
  parseChristmasTreeLessonId,
} from "../../lib/lesson-runtime/christmas-tree-lesson";
import type { ConversationStateClassifierInput } from "../../lib/lesson-runtime/conversation-state-classifier";
import type { LessonNodeDefinition } from "../../lib/lesson-runtime/lesson-definition";
import type { LessonRuntime } from "../../lib/lesson-runtime/lesson-runtime";
import { transcriptMessages } from "../../lib/lesson-runtime/tutor-observation";
import { installLessonObserver, type LessonObserver } from "../helpers/lesson-observer";
import { installLocalSession, type LocalSessionWindow } from "../helpers/local-voice-session";
import { classifierProposal } from "../helpers/runtime-classifier";
import { installSyntheticMicrophone } from "../helpers/synthetic-microphone";

const route = "/scenes/christmas-tree";
const seed = 0;
const seededRoute = `${route}?seed=${seed}`;
const lesson = christmasTreeLesson(seed);
const arrangement = christmasTreeArrangement(seed);
const [firstRound, secondRound] = CHRISTMAS_TREE_NODE_IDS;
const earlyAnswer = /\b(?:\d+|one|two|three|four|five)\b/i;
const progressText = /^Scene [1-3](?:, (?:done|playing now))?$/;
const unclearAnswer = "I'm not sure.";
const successMoves = {
  bauble: /swing$/,
  "candy-cane": /wiggle$/,
  gingerbread: /rock$/,
  present: /bounce$/,
};

type Outcome = "correct" | "incorrect" | "unclear";
type ClassifyRequest = Pick<ConversationStateClassifierInput, "nodeId" | "transcriptRevision" | "transcript"> & {
  lessonId: string;
};

async function setup(page: Page) {
  const microphone = await installSyntheticMicrophone(page);
  await installLocalSession(page);
  const observer = await installLessonObserver(page);

  // Use the transcript in this request so an in-flight classification keeps its own answer.
  await page.route("**/api/classify", async route => {
    const input: ClassifyRequest = route.request().postDataJSON();
    const requestSeed = parseChristmasTreeLessonId(input.lessonId);
    const node = requestSeed === null ? undefined : christmasTreeLesson(requestSeed).nodes[input.nodeId];
    const messages = transcriptMessages(input.transcript);
    const child = messages?.findLast(message => message.speaker === "Child");
    const count = child?.text.trim().match(/^(\d+)\.$/)?.[1];
    const answerOutcome =
      count === undefined ? "unclear" : Number(count) === node?.presentation.answer ? "correct" : "incorrect";
    const tutorState =
      messages?.at(-1)?.speaker !== "Tutor"
        ? "listening"
        : answerOutcome === "unclear"
          ? "clarifying"
          : answerOutcome === "correct"
            ? "acknowledging"
            : "asking";
    await route.fulfill({
      json: {
        proposal: classifierProposal(input, {
          answerOutcome,
          answerCommitment: answerOutcome === "unclear" ? "unresolved" : "committed",
          tutorState,
        }),
      },
    });
  });
  return { microphone, observer };
}

const stageFor = (page: Page, nodeId: string) => page.locator(`[data-scene-id][data-node-id="${nodeId}"]`);

async function waitForRound(page: Page, observer: LessonObserver, nodeId: string) {
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
  const stage = stageFor(page, nodeId);
  await expect(stage).toHaveAttribute("data-render-token", /\S+/);
  await expect(stage).toHaveAttribute("aria-busy", "false");
  return stage;
}

async function expectNoEarlyAnswer(page: Page) {
  const main = page.getByRole("main");
  // The screen-reader progress labels contain round numbers.
  await expect(main.getByText(earlyAnswer).filter({ hasNotText: progressText })).toHaveCount(0);
  const labels = ["aria-label", "aria-description", "aria-valuetext", "alt", "title"];
  const attributes = await main
    .locator(labels.map(label => `[${label}]`).join(", "))
    .evaluateAll(
      (elements, labels) => elements.flatMap(element => labels.map(label => element.getAttribute(label))),
      labels,
    );
  expect(attributes.join(" ")).not.toMatch(earlyAnswer);
  await expect(main.getByRole("status")).not.toContainText(earlyAnswer);
}

async function answer(
  page: Page,
  { microphone, observer }: Awaited<ReturnType<typeof setup>>,
  node: LessonNodeDefinition,
  { outcome = "correct", successAnimation }: { outcome?: Outcome; successAnimation?: RegExp } = {},
) {
  const { id: nodeId, presentation } = node;
  const count = Number(presentation.answer);
  const label = `${count} ${count === 1 ? presentation.object : presentation.objects}!`;
  const text = outcome === "unclear" ? unclearAnswer : `${count + (outcome === "incorrect" ? 1 : 0)}.`;
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
  const stopped = await observer.waitForEvent("microphone.speech_stopped", { after: before, scope });
  await observer.waitForEvent("classifier.result", {
    after: stopped.cursor,
    scope: { ...scope, childTurnId: stopped.event.childTurnId },
    detail: { proposal: { nodeId, answerOutcome: outcome } },
  });

  const stage = stageFor(page, nodeId);
  await expect(stage).not.toHaveAttribute("data-motion", "success");
  const reply = await observer.cursor();
  await page.evaluate(() => {
    (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0.2;
  });
  await observer.waitForEvent("output.activity", { after: reply, scope, detail: { state: "active" } });
  await page.evaluate(
    value => (window as unknown as LocalSessionWindow).sendTranscript("session.output_transcript.delta", value),
    outcome === "correct" ? label : outcome === "incorrect" ? "Let's look again." : "Can you say that again?",
  );
  if (outcome === "correct") {
    await expect(stage).toHaveAttribute("data-motion", "success");
    await expect(stage).not.toHaveAttribute("data-hint", "glow");
    await expect(page.getByRole("status")).toHaveText(label);
    if (successAnimation) {
      const items = stage.locator('[data-asked="true"] > div');
      await expect(items).toHaveCount(count);
      for (const item of await items.all()) {
        await expect(item).toHaveCSS("animation-name", successAnimation);
      }
    }
  }
  await page.evaluate(() => {
    (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0;
  });
  await observer.waitForEvent("output.activity", { after: reply, scope, detail: { state: "quiet" } });
}

test("counts every round with picture cues and celebrates completion", async ({ page }) => {
  test.setTimeout(60_000);
  const session = await setup(page);
  await page.goto(seededRoute);
  const preview = stageFor(page, firstRound);
  await expect(preview).toHaveAttribute("aria-busy", "false");
  for (const kind of CHRISTMAS_TREE_KINDS)
    await expect(preview.locator(`[data-kind="${kind}"]`)).toHaveCount(arrangement.counts[kind]);
  await expectNoEarlyAnswer(page);

  await page.getByRole("button", { name: "Play", exact: true }).click();
  for (const [index, nodeId] of CHRISTMAS_TREE_NODE_IDS.entries()) {
    const stage = await waitForRound(page, session.observer, nodeId);
    const kind = arrangement.asked[index];
    const asked = stage.locator('[data-asked="true"]');
    const cue = page.locator("[data-picture-cue]");
    await expect(cue).toBeVisible();
    await expect(cue).toHaveAttribute("data-picture-cue", kind);
    await expect(cue).toHaveCSS("animation-name", /bubble-pop$/);
    await expect(asked).toHaveCount(arrangement.counts[kind]);
    await expect(stage.locator(`[data-kind="${kind}"][data-asked="true"]`)).toHaveCount(arrangement.counts[kind]);
    await expectNoEarlyAnswer(page);
    await answer(page, session, lesson.nodes[nodeId], { successAnimation: successMoves[kind] });
  }
  await expect(stageFor(page, "complete")).toHaveAttribute("data-motion", "celebrate");
  await expect(page.getByRole("status")).toHaveText("The tree is all counted!");
  await expect(page.locator("[data-picture-cue]")).toHaveCount(0);
});

test("an unclear answer holds without a glow, a wrong answer glows and correction advances", async ({ page }) => {
  const session = await setup(page);
  await page.goto(seededRoute);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const stage = await waitForRound(page, session.observer, firstRound);

  await answer(page, session, lesson.nodes[firstRound], { outcome: "unclear" });
  await waitForRound(page, session.observer, firstRound);
  await expect(stage).not.toHaveAttribute("data-hint", "glow");

  await answer(page, session, lesson.nodes[firstRound], { outcome: "incorrect" });
  await waitForRound(page, session.observer, firstRound);
  await expect(stage).toHaveAttribute("data-hint", "glow");

  await answer(page, session, lesson.nodes[firstRound]);
  const next = await waitForRound(page, session.observer, secondRound);
  await expect(next).not.toHaveAttribute("data-hint", "glow");
});

test("reduces motion and restarts from the first round after stopping", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const session = await setup(page);
  await page.goto(seededRoute);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await waitForRound(page, session.observer, firstRound);
  const cue = page.locator("[data-picture-cue]");
  await expect(cue).toBeVisible();
  await expect(cue).toHaveCSS("animation-duration", "0s");

  await answer(page, session, lesson.nodes[firstRound], { successAnimation: /highlight$/ });
  await waitForRound(page, session.observer, secondRound);
  const firstAttempt = await session.observer.cursor();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("We’ve stopped for now. You can play again whenever you like.");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await waitForRound(page, session.observer, firstRound);
  expect((await session.observer.cursor()).runtimeId).not.toBe(firstAttempt.runtimeId);
  await expectNoEarlyAnswer(page);
});

for (const { query, expectedSeed, debug = false } of [
  { query: "?seed=0&debug=1", expectedSeed: 0, debug: true },
  { query: "?seed=1", expectedSeed: 1 },
  { query: "", expectedSeed: null },
]) {
  test(`sends the same lesson ID to live setup and classification for seed ${expectedSeed ?? "chosen by the server"}${debug ? " and exports it in diagnostics" : ""}`, async ({
    page,
  }) => {
    const session = await setup(page);
    await page.goto(`${route}${query}`);
    const [request] = await Promise.all([
      page.waitForRequest(request => request.url().endsWith("/api/live") && request.method() === "POST"),
      page.getByRole("button", { name: "Play", exact: true }).click(),
    ]);
    const { lessonId } = request.postDataJSON();
    if (expectedSeed !== null) expect(lessonId).toBe(`counting-scene-christmas-tree-${expectedSeed}`);
    const requestSeed = parseChristmasTreeLessonId(lessonId);
    if (requestSeed === null) throw new Error(`Invalid Christmas Tree lesson ID: ${lessonId}`);
    await waitForRound(page, session.observer, firstRound);

    const [classification] = await Promise.all([
      page.waitForRequest(request => {
        if (!request.url().endsWith("/api/classify") || request.method() !== "POST") return false;
        const input: ClassifyRequest = request.postDataJSON();
        return transcriptMessages(input.transcript)?.at(-1)?.text.trim() === unclearAnswer;
      }),
      answer(page, session, christmasTreeLesson(requestSeed).nodes[firstRound], { outcome: "unclear" }),
    ]);
    expect(classification.postDataJSON()).toMatchObject({ lessonId, nodeId: firstRound });

    if (debug) {
      const diagnostics = page.getByRole("complementary", { name: "Developer diagnostics" });
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        diagnostics.getByRole("button", { name: "Export diagnostics" }).click(),
      ]);
      const report: ReturnType<LessonRuntime["report"]> = JSON.parse(await readFile(await download.path(), "utf8"));
      expect(report.runtime).toMatchObject({ lessonId });
    }
  });
}
