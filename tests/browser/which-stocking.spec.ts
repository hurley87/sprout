import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { ConversationStateClassifierInput } from "../../lib/lesson-runtime/conversation-state-classifier";
import type { LessonNodeDefinition } from "../../lib/lesson-runtime/lesson-definition";
import type { LessonRuntime } from "../../lib/lesson-runtime/lesson-runtime";
import { latestChildColour, presentationColours, type LatestChildColour } from "../../lib/lesson-runtime/spoken-colour";
import { transcriptMessages } from "../../lib/lesson-runtime/tutor-observation";
import {
  WHICH_STOCKING_NODE_IDS,
  parseWhichStockingLessonId,
  stockingColourAliases,
  whichStockingLesson,
} from "../../lib/lesson-runtime/which-stocking-lesson";
import { THIRD_STOCKING_COLOUR, whichStockingPlan } from "../../lib/lesson-runtime/which-stocking-plan";
import { installLessonObserver, type LessonObserver } from "../helpers/lesson-observer";
import { installLocalSession, type LocalSessionWindow } from "../helpers/local-voice-session";
import { classifierProposal } from "../helpers/runtime-classifier";
import { installSyntheticMicrophone } from "../helpers/synthetic-microphone";

const route = "/scenes/which-stocking";
const [firstRound, secondRound] = WHICH_STOCKING_NODE_IDS;
const aliases = stockingColourAliases(THIRD_STOCKING_COLOUR) ?? {};
const numbers = /\b(?:\d+|one|two|three|four|five)\b/i;
const progressText = /^Scene [1-8](?:, (?:done|playing now))?$/;
const completeCopy = "Every stocking is full!";

type Outcome = "correct" | "incorrect" | "unclear" | "none";
type ClassifyRequest = Pick<ConversationStateClassifierInput, "nodeId" | "transcriptRevision" | "transcript"> & {
  lessonId: string;
};
type Judgement = { nodeId: string; transcriptRevision: number; reader: LatestChildColour; answerOutcome: Outcome };
type Session = Awaited<ReturnType<typeof setup>>;

/**
 * The browser mock for /api/classify mirrors the server: a classifier that follows the lesson's criteria,
 * then `applySpokenColourCheck` (lib/lesson-runtime/spoken-colour-check.ts), which reads the transcript
 * with `latestChildColour` and the lesson's colours and aliases.
 * - her own answer colour (or an alias), or a second separate repeat after the tutor said it ("assisted"):
 *   correct
 * - a different colour she chose, on screen or not: incorrect
 * - an echo of the tutor's colour: no answer (no_attempt maps to "none"; the check also vetoes it to "none")
 * - the number back, "that one", or no colour at all: no_attempt, so "none"
 * - a question or two alternatives: unclear
 */
function judge(input: ClassifyRequest): Pick<Judgement, "reader" | "answerOutcome"> {
  const seed = parseWhichStockingLessonId(input.lessonId);
  const lesson = seed === null ? undefined : whichStockingLesson(seed);
  const presentation = lesson?.nodes[input.nodeId]?.presentation;
  if (!lesson || !presentation) throw new Error(`Unknown Which Stocking request: ${input.lessonId} ${input.nodeId}`);
  const answer = String(presentation.answer);
  const reader = latestChildColour(input.transcript, {
    answer,
    colours: presentationColours(presentation),
    aliases: lesson.spokenColourCheck?.aliases,
  });
  const answerOutcome: Outcome =
    reader.status === "colour"
      ? reader.owner === "echo"
        ? "none"
        : reader.value === answer
          ? "correct"
          : "incorrect"
      : reader.status === "ambiguous"
        ? "unclear"
        : "none";
  return { reader, answerOutcome };
}

async function setup(page: Page) {
  const microphone = await installSyntheticMicrophone(page);
  await installLocalSession(page);
  const observer = await installLessonObserver(page);
  const requests: ClassifyRequest[] = [];
  const judgements: Judgement[] = [];
  // Judge the transcript in this request, so an in-flight classification keeps its own answer.
  await page.route("**/api/classify", async route => {
    const input: ClassifyRequest = route.request().postDataJSON();
    requests.push(input);
    const { reader, answerOutcome } = judge(input);
    judgements.push({ nodeId: input.nodeId, transcriptRevision: input.transcriptRevision, reader, answerOutcome });
    const messages = transcriptMessages(input.transcript);
    const tutorState =
      messages?.at(-1)?.speaker !== "Tutor"
        ? "listening"
        : answerOutcome === "correct"
          ? "acknowledging"
          : answerOutcome === "incorrect"
            ? "helping"
            : "clarifying";
    await route.fulfill({
      json: {
        proposal: classifierProposal(input, {
          answerOutcome,
          answerCommitment:
            answerOutcome === "none" ? "no_answer" : answerOutcome === "unclear" ? "unresolved" : "committed",
          tutorState,
        }),
      },
    });
  });
  return { microphone, observer, requests, judgements };
}

const stageFor = (page: Page, nodeId: string) => page.locator(`[data-scene-id][data-node-id="${nodeId}"]`);
const stocking = (stage: Locator, colour: string) => stage.locator(`[data-colour="${colour}"]`);
// CSS module classes end in `__<name>`; the stage scopes them so no other class can match.
const moduleClass = (stage: Locator, name: string) => stage.locator(`[class$="__${name}"], [class*="__${name} "]`);
const capitalised = (colour: string) => `${colour.charAt(0).toUpperCase()}${colour.slice(1)}`;
const successLabel = (node: LessonNodeDefinition) =>
  `${capitalised(String(node.presentation.answer))} has ${node.presentation.target}!`;

async function waitForRound(page: Page, observer: LessonObserver, nodeId: string) {
  await expect
    .poll(
      async () => {
        const snapshot = (await observer.read())?.snapshot;
        return (
          snapshot?.status === "live" &&
          snapshot.display.nodeId === nodeId &&
          snapshot.runtime?.phase === "active" &&
          !snapshot.awaitingSteering
        );
      },
      // The success hold (5 s) and the transition's 1.5 s of quiet come before the next round.
      { timeout: 15_000 },
    )
    .toBe(true);
  const stage = stageFor(page, nodeId);
  await expect(stage).toHaveAttribute("data-render-token", /\S+/);
  await expect(stage).toHaveAttribute("aria-busy", "false");
  return stage;
}

/** Incorrect difficulties in the current visit: the misses the stage counts. */
async function misses(observer: LessonObserver) {
  const runtime = (await observer.read())?.snapshot.runtime;
  return runtime?.difficulties?.filter(
    record => record.kind === "incorrect" && record.source.visitId === runtime.visitId,
  ).length;
}

/**
 * Nothing on screen gives away the right colour or the target before success. The allowed exceptions are
 * the round-progress labels, `data-colour` and `data-count` (not checked here), and, with `glow`, the
 * second-miss hint on the right stocking only.
 */
async function expectNoEarlyAnswer(
  page: Page,
  node: LessonNodeDefinition,
  { glow = "none" }: { glow?: "none" | "allowed" | "shown" } = {},
) {
  const answer = String(node.presentation.answer);
  const words = [answer, ...Object.entries(aliases).flatMap(([word, colour]) => (colour === answer ? [word] : []))];
  const colour = new RegExp(`\\b(?:${words.join("|")})\\b`, "i");
  // The learner's screen: the stage, status and progress. The ?debug=1 diagnostics panel is developer-only.
  const main = page.getByRole("main").locator("section[data-palette]");
  for (const pattern of [numbers, colour]) {
    await expect(main.getByText(pattern).filter({ hasNotText: progressText })).toHaveCount(0);
    await expect(main.getByRole("status")).not.toContainText(pattern);
  }
  const labels = ["aria-label", "aria-description", "aria-valuetext", "alt", "title"];
  const values = (
    await main
      .locator(labels.map(label => `[${label}]`).join(", "))
      .evaluateAll(
        (elements, attrs) => elements.flatMap(element => attrs.map(attr => element.getAttribute(attr))),
        labels,
      )
  ).join(" ");
  expect(values).not.toMatch(numbers);
  expect(values).not.toMatch(colour);
  const stage = stageFor(page, node.id);
  await expect(stage).not.toHaveAttribute("data-motion", "success");
  for (const name of ["jiggle", "pop", "drop"]) await expect(moduleClass(stage, name)).toHaveCount(0);
  if (glow === "none") await expect(page.locator("[data-hint]")).toHaveCount(0);
  else await expect(page.locator(`[data-hint]:not([data-colour="${answer}"])`)).toHaveCount(0);
  if (glow === "shown") await expect(stocking(stage, answer)).toHaveAttribute("data-hint", "glow");
}

/** The tutor talks: output audio goes active, its transcript lands, then the audio goes quiet. */
async function tutorSays(
  page: Page,
  observer: LessonObserver,
  nodeId: string,
  text: string,
  during?: () => Promise<void>,
) {
  const cursor = await observer.cursor();
  const scope = { runtimeId: cursor.runtimeId, nodeId };
  await page.evaluate(() => {
    (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0.2;
  });
  await observer.waitForEvent("output.activity", { after: cursor, scope, detail: { state: "active" } });
  await page.evaluate(
    value => (window as unknown as LocalSessionWindow).sendTranscript("session.output_transcript.delta", value),
    text,
  );
  await during?.();
  await page.evaluate(() => {
    (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0;
  });
  return observer.waitForEvent("output.activity", { after: cursor, scope, detail: { state: "quiet" } });
}

/**
 * One child turn and the tutor's reply. A wrong or unclear turn holds the round, and her next turn is only
 * classified after a tutor reply, so every turn gets one. `during` runs after the classification for a
 * turn that holds, and inside the tutor's confirmation, once success shows, for a correct one.
 */
async function turn(
  page: Page,
  { microphone, observer, judgements }: Session,
  node: LessonNodeDefinition,
  text: string,
  outcome: Outcome,
  { reply, during }: { reply?: string; during?: () => Promise<void> } = {},
) {
  const nodeId = node.id;
  await microphone.loadSpeech("one");
  const before = await observer.cursor();
  const scope = { runtimeId: before.runtimeId, nodeId };
  const playback = await microphone.playSpeech("one");
  await observer.waitForEvent("microphone.speech_started", { after: before, scope });
  await page.evaluate(
    value => (window as unknown as LocalSessionWindow).sendTranscript("session.input_transcript.delta", value),
    text,
  );
  expect(await microphone.waitForPlayback(playback.id)).toBe("ended");
  // The detector ends the turn after 900 ms of quiet.
  const stopped = await observer.waitForEvent("microphone.speech_stopped", { after: before, scope });
  const { event } = await observer.waitForEvent("classifier.result", {
    after: stopped.cursor,
    scope: { ...scope, childTurnId: stopped.event.childTurnId },
    detail: { proposal: { nodeId, answerOutcome: outcome } },
  });
  const judgement = judgements.find(
    item => item.nodeId === nodeId && item.transcriptRevision === event.transcriptRevision,
  );
  expect(judgement?.answerOutcome).toBe(outcome);
  const stage = stageFor(page, nodeId);
  if (outcome !== "correct") {
    await during?.();
    // After a second miss the glow may land on the right stocking, and only there.
    await expectNoEarlyAnswer(page, node, { glow: (await misses(observer))! >= 2 ? "allowed" : "none" });
  }
  await expect(stage).not.toHaveAttribute("data-motion", "success");
  await tutorSays(
    page,
    observer,
    nodeId,
    reply ??
      (outcome === "correct"
        ? successLabel(node)
        : outcome === "incorrect"
          ? "Let's count that one."
          : "What colour is it?"),
    outcome === "correct"
      ? async () => {
          await expect(stage).toHaveAttribute("data-motion", "success");
          await expect(page.getByRole("status")).toHaveText(successLabel(node));
          await during?.();
        }
      : undefined,
  );
  return judgement!;
}

async function play(page: Page, session: Session, seed: number) {
  await page.goto(`${route}?seed=${seed}`);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  return waitForRound(page, session.observer, firstRound);
}

test("plays every round to the finale with spoken colours, success motion and a growing pile", async ({ page }) => {
  test.setTimeout(180_000);
  // Seed 0's answers cover all three colours (pink once, purple four times, gold three times) and every
  // stocking position, so each spoken form, including "yellow" for gold, is exercised.
  const seed = 0;
  const plan = whichStockingPlan(seed);
  const lesson = whichStockingLesson(seed);
  expect(new Set(plan.rounds.map(round => round.answer))).toEqual(new Set(["pink", "purple", "gold"]));
  const forms: Record<string, string[]> = {
    pink: ["The pink one!"],
    purple: ["Purple.", "Um, purple!", "It's the purple one.", "Purple!"],
    gold: ["Yellow!", "Gold.", "The yellow one."],
  };
  const said: Record<string, number> = {};
  const session = await setup(page);
  await page.goto(`${route}?seed=${seed}`);
  const preview = stageFor(page, firstRound);
  await expect(preview).toHaveAttribute("aria-busy", "false");
  await expectNoEarlyAnswer(page, lesson.nodes[firstRound]);
  await page.getByRole("button", { name: "Play", exact: true }).click();

  for (const round of plan.rounds) {
    const node = lesson.nodes[WHICH_STOCKING_NODE_IDS[round.round - 1]];
    const stage = await waitForRound(page, session.observer, node.id);
    // The stockings hang left to right in plan order, each with its planned fan of candy canes.
    expect(await stage.locator("[data-colour]").evaluateAll(items => items.map(item => item.dataset.colour))).toEqual(
      round.stockings.map(item => item.colour),
    );
    for (const { colour, count } of round.stockings)
      await expect(stocking(stage, colour).locator("[data-count]")).toHaveAttribute("data-count", String(count));
    await expect(stage.locator("[data-picked], [data-highlight]")).toHaveCount(0);
    // One toy per completed round lies on the pile.
    const toys = stage.locator('[class*="layer"] > div:has(> img[src*="toy-"])');
    await expect(toys).toHaveCount(round.round - 1);
    await expectNoEarlyAnswer(page, node);

    const index = said[round.answer] ?? 0;
    said[round.answer] = index + 1;
    const text = forms[round.answer][index % forms[round.answer].length];
    const judgement = await turn(page, session, node, text, "correct", {
      during: async () => {
        // Success: the right stocking jiggles, only its canes pop, and this round's toy drops.
        await expect(stage).toHaveAttribute("data-motion", "success");
        await expect(moduleClass(stage, "jiggle")).toHaveCount(1);
        await expect(stocking(stage, round.answer)).toHaveCSS("animation-name", /jiggle$/);
        await expect(moduleClass(stage, "pop")).toHaveCount(round.target);
        await expect(moduleClass(stocking(stage, round.answer), "pop")).toHaveCount(round.target);
        await expect(moduleClass(stage, "drop")).toHaveCount(1);
        await expect(toys).toHaveCount(round.round);
      },
    });
    expect(judgement.reader).toMatchObject({ status: "colour", value: round.answer, owner: "child" });
  }
  expect(said.gold).toBeGreaterThan(0);

  const complete = stageFor(page, "complete");
  await expect(complete).toHaveAttribute("data-motion", "celebrate", { timeout: 15_000 });
  await expect(complete.getByText(completeCopy)).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(completeCopy);
  await expect(complete.locator('[class*="layer"] > div:has(> img[src*="toy-"])')).toHaveCount(plan.rounds.length);
});

test("a wrong on-screen colour lights the stocking she picked and holds the round", async ({ page }) => {
  test.setTimeout(60_000);
  // Seed 0 round 1 is pink 5 and purple 1 with target 5: the wrong pick, purple, has one cane, so its
  // highlight is short (0.5 s lead, one cane, 1.2 s hold).
  const seed = 0;
  const round = whichStockingPlan(seed).rounds[0];
  const node = whichStockingLesson(seed).nodes[firstRound];
  const wrong = round.stockings.find(item => item.colour !== round.answer)!;
  expect([round.answer, wrong.colour, wrong.count]).toEqual(["pink", "purple", 1]);
  const session = await setup(page);
  const stage = await play(page, session, seed);

  const judgement = await turn(page, session, node, "Purple.", "incorrect", {
    during: async () => {
      await expect(stage).toHaveAttribute("data-highlight", "pick");
      await expect(stage.locator("[data-picked]")).toHaveCount(1);
      await expect(stocking(stage, wrong.colour)).toHaveAttribute("data-picked", wrong.colour);
      await expect(stage.locator("[data-lit]")).toHaveCount(wrong.count);
      await expect(stocking(stage, wrong.colour).locator("[data-lit] img")).toHaveCSS(
        "transform",
        "matrix(1.15, 0, 0, 1.15, 0, 0)",
      );
      await expect(page.locator("[data-hint]")).toHaveCount(0);
    },
  });
  expect(judgement.reader).toMatchObject({ status: "colour", value: wrong.colour, owner: "child" });
  expect(await misses(session.observer)).toBe(1);
  await expect(stage).not.toHaveAttribute("data-highlight");
  await expect(stage.locator("[data-picked], [data-lit]")).toHaveCount(0);
  await waitForRound(page, session.observer, firstRound);
  await expectNoEarlyAnswer(page, node);

  await turn(page, session, node, "Pink!", "correct");
  await waitForRound(page, session.observer, secondRound);
});

test("a second miss counts every stocking, then the right one glows", async ({ page }) => {
  test.setTimeout(60_000);
  // Seed 1 round 1 is purple 4 and pink 1 with target 1: five canes in all keep the sweep to about 5 s.
  const seed = 1;
  const round = whichStockingPlan(seed).rounds[0];
  const node = whichStockingLesson(seed).nodes[firstRound];
  expect(round.answer).toBe("pink");
  const session = await setup(page);
  const stage = await play(page, session, seed);

  await turn(page, session, node, "Purple.", "incorrect", {
    during: () => expect(stocking(stage, "purple")).toHaveAttribute("data-picked", "purple"),
  });
  // A second wrong colour, this time one that is not on screen.
  await turn(page, session, node, "Red.", "incorrect", {
    during: async () => {
      await expect(stage).toHaveAttribute("data-highlight", "sweep");
      await expect(stage.locator("[data-picked], [data-hint]")).toHaveCount(0);
    },
  });
  expect(await misses(session.observer)).toBe(2);
  // 0.5 s lead, five canes at 0.8 s and a 0.5 s gap.
  await expect(stocking(stage, round.answer)).toHaveAttribute("data-hint", "glow", { timeout: 8_000 });
  await expect(stage).not.toHaveAttribute("data-highlight");
  await expectNoEarlyAnswer(page, node, { glow: "shown" });

  await turn(page, session, node, "Pink.", "correct");
  const next = await waitForRound(page, session.observer, secondRound);
  await expect(next.locator("[data-hint]")).toHaveCount(0);
});

test("the number back and pointing hold the round; an off-screen colour is a miss with no highlight", async ({
  page,
}) => {
  test.setTimeout(60_000);
  // Seed 0 round 1 targets 5. Round 1 never targets three (its counts are 1 and 4, 1 and 5, or 2 and 5),
  // so the number back is "Five."
  const seed = 0;
  const round = whichStockingPlan(seed).rounds[0];
  const node = whichStockingLesson(seed).nodes[firstRound];
  expect(round.target).toBe(5);
  const session = await setup(page);
  const stage = await play(page, session, seed);

  const back = await turn(page, session, node, "Five.", "none", { reply: "Which colour has five?" });
  expect(back.reader).toMatchObject({ status: "number_only" });
  const pointing = await turn(page, session, node, "That one.", "none");
  expect(pointing.reader).toMatchObject({ status: "deictic" });
  expect(await misses(session.observer)).toBe(0);
  await expect(stage.locator("[data-highlight], [data-picked], [data-lit]")).toHaveCount(0);
  await waitForRound(page, session.observer, firstRound);

  const offScreen = await turn(page, session, node, "Blue.", "incorrect");
  expect(offScreen.reader).toMatchObject({ status: "colour", value: "blue", owner: "child" });
  expect(await misses(session.observer)).toBe(1);
  await expect(stage).not.toHaveAttribute("data-highlight");
  await expect(stage.locator("[data-picked], [data-lit], [data-hint]")).toHaveCount(0);
  await waitForRound(page, session.observer, firstRound);
  await expectNoEarlyAnswer(page, node);
});

test("repeating a colour the tutor said first is an echo; a second separate repeat advances as assisted", async ({
  page,
}) => {
  test.setTimeout(60_000);
  // Seed 6 round 1 is purple 1 and pink 4 with target 1, so the answer is purple.
  const seed = 6;
  const node = whichStockingLesson(seed).nodes[firstRound];
  expect(node.presentation.answer).toBe("purple");
  const session = await setup(page);
  const stage = await play(page, session, seed);

  // The tutor slips and names the answer colour before she says any colour.
  await tutorSays(page, session.observer, firstRound, "One! Is it purple?");
  const echo = await turn(page, session, node, "Purple.", "none");
  expect(echo.reader).toMatchObject({ status: "colour", value: "purple", owner: "echo" });
  expect(await misses(session.observer)).toBe(0);
  await expect(stage.locator("[data-highlight], [data-picked]")).toHaveCount(0);
  await waitForRound(page, session.observer, firstRound);

  const assisted = await turn(page, session, node, "Purple.", "correct");
  expect(assisted.reader).toMatchObject({ status: "colour", value: "purple", owner: "assisted" });
  await waitForRound(page, session.observer, secondRound);
});

test("silence after the number gets one nudge at about six seconds", async ({ page }) => {
  test.setTimeout(45_000);
  const session = await setup(page);
  await play(page, session, 0);
  const { event: quiet, cursor } = await tutorSays(page, session.observer, firstRound, "Five!");
  const scope = { runtimeId: cursor.runtimeId, nodeId: firstRound };
  const { event: nudge } = await session.observer.waitForEvent("silence_nudge.requested", {
    after: cursor,
    scope,
    timeoutMs: 10_000,
  });
  // Both times are on the runtime clock, and the 6 s wait starts when the runtime sees the tutor go quiet
  // (about 6,001 ms locally). The tolerance is 6.0 to 6.75 s: never early, with 0.75 s for timer
  // scheduling when several workers share the machine.
  expect(nudge.atMs - quiet.atMs).toBeGreaterThanOrEqual(6_000);
  expect(nudge.atMs - quiet.atMs).toBeLessThan(6_750);
  expect(nudge.detail).toMatchObject({ step: 0, afterQuietMs: 6_000 });
  await session.observer.waitForEvent("gpt_live.silence_nudge_append", { after: cursor, scope });
  const instruction = whichStockingLesson(0).silenceNudges![0].instruction;
  expect(await page.evaluate(() => (window as unknown as LocalSessionWindow).steeringContents)).toContain(instruction);

  // Only once: another 7 s of silence brings no second nudge.
  await page.waitForTimeout(7_000);
  const events = (await session.observer.read(cursor))!.events;
  expect(events.filter(item => item.type === "silence_nudge.requested")).toHaveLength(1);
});

test("stopping and playing again restarts at the first round", async ({ page }) => {
  test.setTimeout(60_000);
  const seed = 0;
  const lesson = whichStockingLesson(seed);
  const session = await setup(page);
  await play(page, session, seed);
  await turn(page, session, lesson.nodes[firstRound], "The pink one!", "correct");
  await waitForRound(page, session.observer, secondRound);
  const firstAttempt = await session.observer.cursor();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("We’ve stopped for now. You can play again whenever you like.");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const stage = await waitForRound(page, session.observer, firstRound);
  expect((await session.observer.cursor()).runtimeId).not.toBe(firstAttempt.runtimeId);
  expect(await stage.locator("[data-colour]").evaluateAll(items => items.map(item => item.dataset.colour))).toEqual(
    whichStockingPlan(seed).rounds[0].stockings.map(item => item.colour),
  );
  await expect(stage.locator('[class*="layer"] > div:has(> img[src*="toy-"])')).toHaveCount(0);
  await expectNoEarlyAnswer(page, lesson.nodes[firstRound]);
});

test("reduced motion turns the highlight and success into brightness only", async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Seed 0 round 1: the one-cane purple pick keeps the highlight short, then pink (5 canes) succeeds.
  const seed = 0;
  const node = whichStockingLesson(seed).nodes[firstRound];
  const session = await setup(page);
  const stage = await play(page, session, seed);

  await turn(page, session, node, "Purple.", "incorrect", {
    during: async () => {
      await expect(stocking(stage, "purple")).toHaveAttribute("data-picked", "purple");
      // The lit cane brightens but does not grow.
      await expect(stocking(stage, "purple").locator("[data-lit] img")).toHaveCSS("transform", "none");
    },
  });
  await expect(stage).not.toHaveAttribute("data-highlight");

  await turn(page, session, node, "Pink.", "correct", {
    during: async () => {
      const right = stocking(stage, "pink");
      await expect(right).toHaveCSS("animation-name", "none");
      await expect(right.locator('[class*="__sock"] img')).toHaveCSS("animation-name", /flash$/);
      for (const cane of await moduleClass(right, "pop").locator("img").all())
        await expect(cane).toHaveCSS("animation-name", /pop-still$/);
      await expect(moduleClass(stage, "drop")).toHaveCSS("animation-name", /fade-in$/);
    },
  });
});

for (const { query, seed, debug } of [
  { query: "?seed=0&debug=1", seed: 0, debug: true },
  { query: "?seed=1", seed: 1, debug: false },
  { query: "", seed: null, debug: false },
]) {
  test(`live and classify share the lesson ID for ${seed ?? "a server-selected seed"}${debug ? " and diagnostics export it" : ""}`, async ({
    page,
  }) => {
    test.setTimeout(35_000);
    const session = await setup(page);
    await page.goto(`${route}${query}`);
    const [request] = await Promise.all([
      page.waitForRequest(request => request.url().endsWith("/api/live") && request.method() === "POST"),
      page.getByRole("button", { name: "Play", exact: true }).click(),
    ]);
    const { lessonId } = request.postDataJSON();
    if (seed !== null) expect(lessonId).toBe(`counting-which-stocking-${seed}`);
    const chosen = parseWhichStockingLessonId(lessonId);
    if (chosen === null) throw new Error(`Invalid Which Stocking lesson ID: ${lessonId}`);
    await waitForRound(page, session.observer, firstRound);
    await turn(page, session, whichStockingLesson(chosen).nodes[firstRound], "I'm not sure.", "none");
    expect(session.requests.length).toBeGreaterThan(0);
    for (const input of session.requests) expect(input).toMatchObject({ lessonId, nodeId: firstRound });
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
