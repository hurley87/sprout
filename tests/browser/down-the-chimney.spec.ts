import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { LessonRuntime } from "../../lib/lesson-runtime/lesson-runtime";
import { downTheChimneyPlan } from "../../lib/lesson-runtime/down-the-chimney-plan";
import { downTheChimneyLesson, parseDownTheChimneyLessonId } from "../../lib/lesson-runtime/down-the-chimney-lesson";
import type { ConversationStateClassifierInput } from "../../lib/lesson-runtime/conversation-state-classifier";
import { transcriptMessages } from "../../lib/lesson-runtime/tutor-observation";
import { installLessonObserver } from "../helpers/lesson-observer";
import { installLocalSession, type LocalSessionWindow } from "../helpers/local-voice-session";
import { classifierProposal } from "../helpers/runtime-classifier";
import { installSyntheticMicrophone } from "../helpers/synthetic-microphone";

type Input = Pick<ConversationStateClassifierInput, "nodeId" | "transcriptRevision" | "transcript"> & {
  lessonId: string;
};
async function setup(page: Page) {
  const microphone = await installSyntheticMicrophone(page);
  await installLocalSession(page);
  const observer = await installLessonObserver(page);
  const requests: Input[] = [];
  await page.route("**/api/classify", async route => {
    const input: Input = route.request().postDataJSON();
    requests.push(input);
    const seed = parseDownTheChimneyLessonId(input.lessonId);
    const node = seed === null ? undefined : downTheChimneyLesson(seed).nodes[input.nodeId];
    const messages = transcriptMessages(input.transcript);
    const child = messages?.findLast(message => message.speaker === "Child");
    const count = child?.text
      .trim()
      .split(/\n/)
      .at(-1)
      ?.match(/(?:^|,\s*)(\d+)\.$/)?.[1];
    const answerOutcome =
      count === undefined ? "unclear" : Number(count) === node?.presentation.answer ? "correct" : "incorrect";
    await route.fulfill({
      json: {
        proposal: classifierProposal(input, {
          answerOutcome,
          answerCommitment: answerOutcome === "unclear" ? "unresolved" : "committed",
          tutorState: "listening",
        }),
      },
    });
  });
  return { microphone, observer, requests };
}
const stage = (page: Page, node = "chimney-1") => page.locator(`[data-scene-id][data-node-id="${node}"]`);
async function speak(page: Page, session: Awaited<ReturnType<typeof setup>>, value: number) {
  const before = await session.observer.cursor();
  const scope = { runtimeId: before.runtimeId };
  const playback = await session.microphone.playSpeech("one");
  await session.observer.waitForEvent("microphone.speech_started", { after: before, scope });
  await page.evaluate(
    value => (window as unknown as LocalSessionWindow).sendTranscript("session.input_transcript.delta", `${value}.`),
    value,
  );
  expect(await session.microphone.waitForPlayback(playback.id)).toBe("ended");
  await session.observer.waitForEvent("microphone.speech_stopped", { after: before, scope });
}

async function answer(
  page: Page,
  session: Awaited<ReturnType<typeof setup>>,
  value: number,
  outcome: "correct" | "incorrect",
  reply = true,
) {
  const before = await session.observer.cursor();
  await speak(page, session, value);
  await session.observer.waitForEvent("classifier.result", {
    after: before,
    scope: { runtimeId: before.runtimeId },
    detail: { proposal: { answerOutcome: outcome } },
  });
  if (reply) {
    const cursor = await session.observer.cursor();
    await page.evaluate(() => {
      (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0.2;
    });
    await session.observer.waitForEvent("output.activity", {
      after: cursor,
      scope: { runtimeId: cursor.runtimeId },
      detail: { state: "active" },
    });
    await page.evaluate(
      text => (window as unknown as LocalSessionWindow).sendTranscript("session.output_transcript.delta", text),
      outcome === "correct" ? `${value} presents!` : "Let's watch again.",
    );
    if (outcome === "correct")
      await expect(page.locator('[data-scene-id="down-the-chimney"]')).toHaveAttribute("data-phase", "reveal");
    await page.evaluate(() => {
      (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0;
    });
    await session.observer.waitForEvent("output.activity", {
      after: cursor,
      scope: { runtimeId: cursor.runtimeId },
      detail: { state: "quiet" },
    });
  }
}

async function expectNoEarlyAnswer(page: Page) {
  const main = page.getByRole("main");
  const numbers = /\b(?:\d+|one|two|three|four|five)\b/i;
  const progress = /^Scene [1-8](?:, (?:done|playing now))?$/;
  await expect(main.getByText(numbers).filter({ hasNotText: progress })).toHaveCount(0);
  const labels = ["aria-label", "aria-description", "aria-valuetext", "alt", "title"];
  const values = await main
    .locator(labels.map(label => `[${label}]`).join(", "))
    .evaluateAll(
      (elements, attrs) => elements.flatMap(element => attrs.map(attr => element.getAttribute(attr))),
      labels,
    );
  expect(values.join(" ")).not.toMatch(numbers);
  await expect(main.getByRole("status")).not.toContainText(numbers);
  await expect(page.locator('[class*="reveal"]')).toHaveCount(0);
}

test("an early number is held during the drops", async ({ page }) => {
  test.setTimeout(45_000);
  // Seed 2 starts with three presents, leaving time to observe the first turn.
  const seed = 2;
  expect(downTheChimneyPlan(seed).rounds[0].count).toBeGreaterThanOrEqual(3);
  const session = await setup(page);
  await page.goto(`/scenes/down-the-chimney?seed=${seed}`);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await session.microphone.loadSpeech("one");
  await expect(stage(page)).toHaveAttribute("data-phase", "dropping", { timeout: 15_000 });
  const start = await session.observer.cursor();
  await speak(page, session, 1);
  await expect(stage(page)).toHaveAttribute("data-phase", "dropping");
  expect(session.requests).toHaveLength(0);
  await expect(stage(page)).not.toHaveAttribute("data-hint", "glow");
  await expect(stage(page)).toHaveAttribute("data-drop-interval", "1500");
  await expect(stage(page)).toHaveAttribute("data-phase", "waiting", { timeout: 10_000 });
  await speak(page, session, downTheChimneyPlan(seed).rounds[0].count);
  await session.observer.waitForEvent("count_along.ended", { after: start, scope: { runtimeId: start.runtimeId } });
  await session.observer.waitForEvent("classifier.result", {
    after: start,
    scope: { runtimeId: start.runtimeId },
    detail: { proposal: { answerOutcome: "correct" } },
  });
  await page.evaluate(() => {
    (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0.2;
  });
  await page.evaluate(() => {
    (window as unknown as LocalSessionWindow).sendTranscript("session.output_transcript.delta", "Three presents!");
  });
  await expect(stage(page)).toHaveAttribute("data-phase", "reveal", { timeout: 10_000 });
});

test("silence peers twice, replays twice, then waits", async ({ page }) => {
  test.setTimeout(55_000);
  // Seed 0 starts with one present, keeping the silence timeline short.
  const session = await setup(page);
  await page.goto("/scenes/down-the-chimney?seed=0");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const scene = stage(page);
  for (let replay = 0; replay < 2; replay++) {
    await expect(scene).toHaveAttribute("data-phase", "waiting", { timeout: 15_000 });
    const waiting = Date.now();
    await expect(scene).toHaveAttribute("data-phase", "peering", { timeout: 8_000 });
    // Allow one second for browser scheduling around the six-second timer.
    expect(Date.now() - waiting).toBeGreaterThanOrEqual(5_000);
    expect(Date.now() - waiting).toBeLessThan(7_500);
    await expect(scene).toHaveAttribute("data-phase", "dropping", { timeout: 3_000 });
  }
  await expect(scene).toHaveAttribute("data-phase", "waiting", { timeout: 5_000 });
  await page.waitForTimeout(7_000);
  await expect(scene).toHaveAttribute("data-phase", "waiting");
  expect(session.requests).toHaveLength(0);
});

test("reduced motion fades the drop and suppresses the chimney jolt", async ({ page }) => {
  test.setTimeout(25_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setup(page);
  await page.goto("/scenes/down-the-chimney?seed=2");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const scene = stage(page);
  await expect(scene).toHaveAttribute("data-phase", "dropping", { timeout: 15_000 });
  const falling = scene.locator('[class*="falling"]');
  await expect(falling).toHaveCSS("animation-name", /fade-out/);
  await expect(scene.locator('[class*="jolt"]')).toHaveCSS("animation-name", "none");
});

test("misses slow replays and two clean rounds restore pace; restart resets it", async ({ page }) => {
  test.setTimeout(120_000);
  // Seed 0 starts with one present, so replay and pace checks run quickly.
  const plan = downTheChimneyPlan(0);
  const session = await setup(page);
  await page.goto("/scenes/down-the-chimney?seed=0");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await session.microphone.loadSpeech("one");
  const first = stage(page);
  await expect(first).toHaveAttribute("data-phase", "waiting", { timeout: 15_000 });
  await answer(page, session, plan.rounds[0].count + 1, "incorrect");
  await expect(first).toHaveAttribute("data-phase", "dropping", { timeout: 5_000 });
  await expect(first).toHaveAttribute("data-drop-interval", "1800");
  await expect(first).toHaveAttribute("data-phase", "waiting");
  const silentMiss = Date.now();
  await answer(page, session, plan.rounds[0].count + 1, "incorrect", false);
  await expect(first).toHaveAttribute("data-phase", "dropping", { timeout: 7_000 });
  // Classification and the four-second fallback have scheduling overhead.
  expect(Date.now() - silentMiss).toBeGreaterThan(4_000);
  expect(Date.now() - silentMiss).toBeLessThan(7_000);
  await expect(first).toHaveAttribute("data-drop-interval", "2000");
  await expect(first).toHaveAttribute("data-phase", "waiting");
  await answer(page, session, plan.rounds[0].count, "correct");
  for (let i = 1; i <= 2; i++) {
    const scene = stage(page, `chimney-${i + 1}`);
    await expect(scene).toHaveAttribute("data-phase", "waiting", { timeout: 20_000 });
    const planned = [1800, 1500, 1200, 900][plan.rounds[i].step + 1];
    expect(Number(await scene.getAttribute("data-drop-interval"))).toBeGreaterThan(planned);
    await answer(page, session, plan.rounds[i].count, "correct");
  }
  const fourth = stage(page, "chimney-4");
  await expect(fourth).toHaveAttribute("data-phase", "dropping", { timeout: 20_000 });
  await expect(fourth).toHaveAttribute("data-drop-interval", String([1800, 1500, 1200, 900][plan.rounds[3].step + 1]));
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(first).toHaveAttribute("data-phase", "dropping", { timeout: 15_000 });
  await expect(first).toHaveAttribute("data-drop-interval", String([1800, 1500, 1200, 900][plan.rounds[0].step + 1]));
});

for (const { query, seed, debug } of [
  { query: "?seed=0&debug=1", seed: 0, debug: true },
  { query: "?seed=1", seed: 1, debug: false },
  { query: "", seed: null, debug: false },
]) {
  test(`live and classify share the lesson ID for ${seed ?? "a server-selected seed"}`, async ({ page }) => {
    test.setTimeout(35_000);
    const session = await setup(page);
    await page.goto(`/scenes/down-the-chimney${query}`);
    const [request] = await Promise.all([
      page.waitForRequest(request => request.url().endsWith("/api/live") && request.method() === "POST"),
      page.getByRole("button", { name: "Play", exact: true }).click(),
    ]);
    const { lessonId } = request.postDataJSON();
    if (seed !== null) expect(lessonId).toBe(`counting-down-the-chimney-${seed}`);
    const chosen = parseDownTheChimneyLessonId(lessonId);
    expect(chosen).not.toBeNull();
    if (chosen === null) throw new Error(`Invalid lesson ID: ${lessonId}`);
    await session.microphone.loadSpeech("one");
    await expect(stage(page)).toHaveAttribute("data-phase", "waiting", { timeout: 15_000 });
    await answer(page, session, downTheChimneyPlan(chosen).rounds[0].count, "correct");
    expect(session.requests).toHaveLength(1);
    expect(session.requests[0]).toMatchObject({ lessonId, nodeId: "chimney-1" });
    if (debug) {
      const diagnostics = page.getByRole("complementary", { name: "Developer diagnostics" });
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        diagnostics.getByRole("button", { name: "Export diagnostics" }).click(),
      ]);
      const report: ReturnType<LessonRuntime["report"]> = JSON.parse(await readFile(await download.path(), "utf8"));
      expect(report.runtime).toMatchObject({ lessonId });
      expect(report.events.some(event => event.type === "count_along.started")).toBe(true);
    }
  });
}

test("counts along through every round, keeps answers private, and builds the pile", async ({ page }) => {
  test.setTimeout(180_000);
  // Seed 0 covers counts one through four and all three pace steps.
  const plan = downTheChimneyPlan(0);
  const session = await setup(page);
  await page.goto("/scenes/down-the-chimney?seed=0");
  await expect(stage(page)).toHaveAttribute("data-phase", "preview");
  await expectNoEarlyAnswer(page);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await session.microphone.loadSpeech("one");
  for (const round of plan.rounds) {
    const cursor = await session.observer.cursor();
    const scope = { runtimeId: cursor.runtimeId, nodeId: `chimney-${round.round}` };
    const scene = stage(page, `chimney-${round.round}`);
    await session.observer.waitForEvent("count_along.started", { after: cursor, scope, timeoutMs: 20_000 });
    await expect(scene).toHaveAttribute("data-phase", "dropping");
    const dropObserved = Date.now();
    const interval = Number(await scene.getAttribute("data-drop-interval"));
    const requestsBefore = session.requests.length;
    if (interval >= 1500) {
      // The 384 ms fixture plus the 900 ms quiet period fits between these drops.
      for (let number = 1; number <= round.count; number++) {
        const delay = dropObserved + (number - 1) * interval - Date.now();
        if (delay > 0) await page.waitForTimeout(delay);
        await expect(scene).toHaveAttribute("data-phase", "dropping");
        await speak(page, session, number);
        expect(session.requests).toHaveLength(requestsBefore);
      }
      await expect(scene).toHaveAttribute("data-phase", "waiting", { timeout: 5_000 });
      await expectNoEarlyAnswer(page);
      if (round.round % 2 === 0) await speak(page, session, round.count);
    } else {
      // Faster counting is one turn: the detector needs 900 ms of quiet to stop it.
      // Replay the 384 ms fixture with 100 ms gaps while sending landing deltas.
      let playing = true;
      const first = await session.microphone.playSpeech("one");
      await session.observer.waitForEvent("microphone.speech_started", { after: cursor, scope });
      const speech = (async () => {
        let playback = first;
        while (true) {
          expect(await session.microphone.waitForPlayback(playback.id)).toBe("ended");
          if (!playing) break;
          await page.waitForTimeout(100);
          if (!playing) break;
          playback = await session.microphone.playSpeech("one");
        }
      })();
      try {
        for (let number = 1; number <= round.count; number++) {
          const delay = dropObserved + (number - 1) * interval + 500 - Date.now();
          if (delay > 0) await page.waitForTimeout(delay);
          await page.evaluate(
            text => (window as unknown as LocalSessionWindow).sendTranscript("session.input_transcript.delta", text),
            `${number}${number === round.count && round.round % 2 !== 0 ? "." : ", "}`,
          );
          expect(session.requests).toHaveLength(requestsBefore);
        }
        await expect(scene).toHaveAttribute("data-phase", "waiting", { timeout: 5_000 });
        await expectNoEarlyAnswer(page);
        if (round.round % 2 === 0)
          await page.evaluate(
            value =>
              (window as unknown as LocalSessionWindow).sendTranscript("session.input_transcript.delta", `${value}.`),
            round.count,
          );
      } finally {
        playing = false;
        await speech;
      }
      await session.observer.waitForEvent("microphone.speech_stopped", { after: cursor, scope });
    }
    await session.observer.waitForEvent("count_along.ended", { after: cursor, scope });
    await session.observer.waitForEvent("classifier.result", {
      after: cursor,
      scope,
      detail: { proposal: { answerOutcome: "correct" } },
    });
    const events = (await session.observer.read(cursor))!.events;
    const started = events.findIndex(event => event.type === "count_along.started");
    const ended = events.findIndex(event => event.type === "count_along.ended");
    const classifications = events.flatMap((event, index) =>
      event.type === "classifier.started" && event.nodeId === scope.nodeId ? [index] : [],
    );
    expect(started).toBeGreaterThanOrEqual(0);
    expect(ended).toBeGreaterThan(started);
    expect(classifications).toHaveLength(1);
    expect(classifications[0]).toBeGreaterThan(ended);
    expect(classifications[0]).toBeGreaterThan(
      events.findLastIndex(event => event.type === "microphone.speech_stopped"),
    );
    expect(session.requests).toHaveLength(requestsBefore + 1);
    const turns = events.filter(event => event.type === "microphone.speech_stopped").map(event => event.childTurnId);
    expect(new Set(turns).size).toBe(interval >= 1500 ? round.count + (round.round % 2 === 0 ? 1 : 0) : 1);
    await page.evaluate(() => {
      (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0.2;
    });
    await page.evaluate(value => {
      (window as unknown as LocalSessionWindow).sendTranscript("session.output_transcript.delta", `${value} presents!`);
    }, round.count);
    await expect(scene).toHaveAttribute("data-phase", "reveal");
    await expect(scene.locator('[class*="reveal"]')).toHaveCount(round.count);
    // Existing pile presents plus the newly moved present equal completed rounds.
    const pile = scene.locator('[class*="layer"] > div:has(img[src*="present-"]):not([class*="reveal"])');
    await expect(pile).toHaveCount(round.round);
    await page.evaluate(() => {
      (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0;
    });
  }
  const complete = stage(page, "complete");
  await expect(complete).toHaveAttribute("data-phase", "complete", { timeout: 20_000 });
  await expect(complete).toHaveAttribute("data-motion", "celebrate");
});

test("counts three separate turns during the drop window", async ({ page }) => {
  test.setTimeout(30_000);
  // Seed 2 begins with three drops at 1500 ms, enough for distinct microphone turns.
  const round = downTheChimneyPlan(2).rounds[0];
  expect(round.count).toBe(3);
  const session = await setup(page);
  await page.goto("/scenes/down-the-chimney?seed=2");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await session.microphone.loadSpeech("one");
  const scene = stage(page);
  await expect(scene).toHaveAttribute("data-phase", "dropping", { timeout: 15_000 });
  const cursor = await session.observer.cursor();
  for (let number = 1; number <= round.count; number++) {
    await expect(scene).toHaveAttribute("data-phase", "dropping");
    await speak(page, session, number);
    if (number < round.count) expect(session.requests).toHaveLength(0);
  }
  await session.observer.waitForEvent("count_along.ended", { after: cursor, scope: { runtimeId: cursor.runtimeId } });
  await session.observer.waitForEvent("classifier.result", {
    after: cursor,
    scope: { runtimeId: cursor.runtimeId },
    detail: { proposal: { answerOutcome: "correct" } },
  });
  const events = (await session.observer.read(cursor))!.events;
  const ended = events.findIndex(event => event.type === "count_along.ended");
  const classified = events.findIndex(event => event.type === "classifier.started");
  expect(ended).toBeGreaterThanOrEqual(0);
  expect(classified).toBeGreaterThan(ended);
  expect(session.requests).toHaveLength(1);
  const turns = events.filter(event => event.type === "microphone.speech_stopped").map(event => event.childTurnId);
  expect(new Set(turns).size).toBe(3);
});
