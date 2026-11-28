import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { ConversationStateClassifierInput } from "../../lib/lesson-runtime/conversation-state-classifier";
import type { LessonNodeDefinition } from "../../lib/lesson-runtime/lesson-definition";
import type { LessonRuntime } from "../../lib/lesson-runtime/lesson-runtime";
import {
  SNOWFLAKE_SHOWDOWN_NODE_IDS,
  parseSnowflakeShowdownLessonId,
  snowflakeShowdownLesson,
} from "../../lib/lesson-runtime/snowflake-showdown-lesson";
import {
  MITTEN_COLOURS,
  snowflakeLayout,
  snowflakeShowdownPlan,
  type MittenColour,
  type SnowflakeShowdownRound,
} from "../../lib/lesson-runtime/snowflake-showdown-plan";
import { latestChildColour, presentationColours, type LatestChildColour } from "../../lib/lesson-runtime/spoken-colour";
import { transcriptMessages } from "../../lib/lesson-runtime/tutor-observation";
import { SNOWFLAKE_SLOTS } from "../../app/snowflake-showdown-scene";
import { installLessonObserver, type LessonObserver } from "../helpers/lesson-observer";
import { installLocalSession, type LocalSessionWindow } from "../helpers/local-voice-session";
import { classifierProposal } from "../helpers/runtime-classifier";
import { installSyntheticMicrophone } from "../helpers/synthetic-microphone";

const route = "/scenes/snowflake-showdown";
const [firstRound, secondRound] = SNOWFLAKE_SHOWDOWN_NODE_IDS;
const numbers = /\b(?:\d+|one|two|three|four|five|six)\b/i;
const colourWords = /\b(?:pink|blue)\b/i;
const progressText = /^Scene (?:[1-9]|10)(?:, (?:done|playing now))?$/;
const completeCopy = "All ten stars are yours!";
const intro = "Pink is yours and blue is the snowman's. When they flip, tell me who has more snowflakes!";
const leftOverLine = "Look, some are left over. Who has more?";
const whichMitten = "Which mitten has more?";
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six"];

type Outcome = "correct" | "incorrect" | "unclear" | "none";
type ClassifyRequest = Pick<ConversationStateClassifierInput, "nodeId" | "transcriptRevision" | "transcript"> & {
  lessonId: string;
};
type Judgement = {
  nodeId: string;
  transcriptRevision: number;
  transcript: string;
  reader: LatestChildColour;
  answerOutcome: Outcome;
};
type Session = Awaited<ReturnType<typeof setup>>;

/**
 * The browser mock for /api/classify mirrors the server: a classifier that follows the lesson's criteria,
 * then `applySpokenColourCheck` (lib/lesson-runtime/spoken-colour-check.ts), which reads the transcript with
 * `latestChildColour` and the lesson's colours, `aliases` AND `childAliases` (her "mine" is pink, her "you"
 * and "snowman" are blue; tutor turns are read without them, so the tutor's "you" and "yours" never name
 * a side or disclose one).
 * - her own answer colour or side word, or a second separate repeat after the tutor said it alone
 *   ("assisted"): correct
 * - the other mitten's colour or side word, or a colour not on screen: incorrect
 * - an echo of a colour the tutor named alone: no answer (the check vetoes it to "none")
 * - a number, "that one", or no side at all: no_attempt, so "none"
 * - a question or two alternatives: unclear
 */
function judge(input: ClassifyRequest): Pick<Judgement, "reader" | "answerOutcome"> {
  const seed = parseSnowflakeShowdownLessonId(input.lessonId);
  const lesson = seed === null ? undefined : snowflakeShowdownLesson(seed);
  const presentation = lesson?.nodes[input.nodeId]?.presentation;
  if (!lesson || !presentation)
    throw new Error(`Unknown Snowflake Showdown request: ${input.lessonId} ${input.nodeId}`);
  const answer = String(presentation.answer);
  const reader = latestChildColour(input.transcript, {
    answer,
    colours: presentationColours(presentation),
    aliases: lesson.spokenColourCheck?.aliases,
    childAliases: lesson.spokenColourCheck?.childAliases,
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

type StageRecord = {
  t: number;
  kind: "face" | "pairing" | "wiggle" | "flurry" | "flight";
  node: string | null;
  value?: string | null;
  colour?: string | null;
  /** Computed animation-name of the mitten, its palm face and its back face, read as the face changes. */
  animations?: { mitten: string | null; palm: string | null; back: string | null };
  /** Mittens carrying the wiggle class as `data-wiggle` changes. */
  wiggling?: number;
};
type RecorderWindow = { __stageLog: StageRecord[] };

/**
 * A page-side journal of stage changes with `performance.now()` times, so short-lived states (the 500 ms
 * flip, a 600 ms wiggle, "running" pairing, the success flurry and star flight) are seen even when they
 * come and go between Playwright polls. Computed styles are read in the mutation callback, while the
 * state that set them is still rendered.
 */
async function installStageRecorder(page: Page) {
  await page.addInitScript(() => {
    const log: StageRecord[] = [];
    (window as unknown as RecorderWindow).__stageLog = log;
    const nodeOf = (element: Element) => element.closest("[data-node-id]")?.getAttribute("data-node-id") ?? null;
    const animation = (element: Element | null) => (element ? getComputedStyle(element).animationName : null);
    const face = (element: Element) =>
      log.push({
        t: performance.now(),
        kind: "face",
        node: nodeOf(element),
        colour: element.getAttribute("data-colour"),
        value: element.getAttribute("data-face"),
        animations: {
          mitten: animation(element),
          palm: animation(element.querySelector(':scope > [class*="__palm"]')),
          back: animation(element.querySelector(':scope > [class*="__back"]')),
        },
      });
    const stage = (element: Element, name: string) =>
      log.push({
        t: performance.now(),
        kind: name === "data-wiggle" ? "wiggle" : "pairing",
        node: element.getAttribute("data-node-id"),
        value: element.getAttribute(name),
        wiggling: element.querySelectorAll('[data-face][class*="__wiggle"]').length,
      });
    const scan = (root: Element) => {
      for (const element of [root, ...root.querySelectorAll("*")]) {
        if (element.hasAttribute("data-face")) face(element);
        if (element.hasAttribute("data-scene-id"))
          for (const name of ["data-pairing", "data-wiggle"]) if (element.hasAttribute(name)) stage(element, name);
        const names = element.getAttribute("class") ?? "";
        for (const kind of ["flurry", "flight"] as const)
          if (new RegExp(`__${kind}(?:\\s|$)`).test(names))
            log.push({ t: performance.now(), kind, node: nodeOf(element) });
      }
    };
    new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          mutation.addedNodes.forEach(node => {
            if (node instanceof Element) scan(node);
          });
        } else if (mutation.target instanceof Element) {
          if (mutation.attributeName === "data-face") face(mutation.target);
          else if (mutation.target.hasAttribute("data-scene-id")) stage(mutation.target, mutation.attributeName!);
        }
      }
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-face", "data-pairing", "data-wiggle"],
    });
  });
  return {
    read: (filter?: Partial<Pick<StageRecord, "kind" | "node">>) =>
      page.evaluate(
        ({ kind, node }) =>
          (window as unknown as RecorderWindow).__stageLog.filter(
            record => (kind === undefined || record.kind === kind) && (node === undefined || record.node === node),
          ),
        filter ?? {},
      ),
  };
}

async function setup(page: Page) {
  const microphone = await installSyntheticMicrophone(page);
  await installLocalSession(page);
  const observer = await installLessonObserver(page);
  const recorder = await installStageRecorder(page);
  const requests: ClassifyRequest[] = [];
  const judgements: Judgement[] = [];
  // Judge the transcript in this request, so an in-flight classification keeps its own answer.
  await page.route("**/api/classify", async route => {
    const input: ClassifyRequest = route.request().postDataJSON();
    requests.push(input);
    const { reader, answerOutcome } = judge(input);
    judgements.push({
      nodeId: input.nodeId,
      transcriptRevision: input.transcriptRevision,
      transcript: input.transcript,
      reader,
      answerOutcome,
    });
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
  return { microphone, observer, recorder, requests, judgements };
}

const stageFor = (page: Page, nodeId: string) => page.locator(`[data-scene-id][data-node-id="${nodeId}"]`);
const mitten = (stage: Locator, colour: MittenColour) => stage.locator(`[data-face][data-colour="${colour}"]`);
// CSS module classes end in `__<name>`; the stage scopes them so no other class can match.
const moduleClass = (scope: Locator, name: string) => scope.locator(`[class$="__${name}"], [class*="__${name} "]`);
const flakes = (stage: Locator, colour: MittenColour) => moduleClass(mitten(stage, colour), "flake");
const goldStars = (stage: Locator) => stage.locator('[data-star="gold"]');
const capitalised = (colour: string) => `${colour.charAt(0).toUpperCase()}${colour.slice(1)}`;
const successLabel = (node: LessonNodeDefinition) => `${capitalised(String(node.presentation.answer))} has more!`;
/** The second-miss line, as one turn, pink first: "Pink has two. Blue has four. Blue has more!" */
const countLine = ({ presentation }: LessonNodeDefinition) =>
  `Pink has ${NUMBER_WORDS[Number(presentation.count_pink)]}. Blue has ${NUMBER_WORDS[Number(presentation.count_blue)]}. ${capitalised(String(presentation.answer))} has more!`;
const other = (colour: MittenColour) => MITTEN_COLOURS.find(item => item !== colour)!;

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
      // The success hold (2.5 s) and the transition's 1 s of quiet come before the next round.
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
 * The flipped round as planned: both mittens show their palms with `data-count` from the plan, and each
 * mitten draws exactly that many snowflakes, at the palm slots `snowflakeLayout` picks for it.
 */
async function expectPlannedRound(stage: Locator, seed: number, round: SnowflakeShowdownRound) {
  for (const colour of MITTEN_COLOURS) {
    const hand = mitten(stage, colour);
    await expect(hand).toHaveAttribute("data-face", "palm");
    await expect(hand).toHaveAttribute("data-count", String(round.counts[colour]));
    const slots = snowflakeLayout(seed, round.round, colour);
    expect(slots).toHaveLength(round.counts[colour]);
    await expect(flakes(stage, colour)).toHaveCount(slots.length);
    // Inline percentages round to four decimals in the browser; three is far finer than a slot apart.
    const at = await flakes(stage, colour).evaluateAll(items =>
      items.map(item => [parseFloat((item as HTMLElement).style.left), parseFloat((item as HTMLElement).style.top)]),
    );
    expect(at).toHaveLength(slots.length);
    slots.forEach((slot, index) => {
      expect(at[index][0]).toBeCloseTo(SNOWFLAKE_SLOTS[colour][slot].x * 100, 3);
      expect(at[index][1]).toBeCloseTo(SNOWFLAKE_SLOTS[colour][slot].y * 100, 3);
    });
  }
}

/**
 * Nothing on the learner's screen tells which mitten has more, or by how much, before success:
 * - no colour word or number in any text (status included), apart from the round-progress labels
 * - no colour word or number in aria-label, aria-description, aria-valuetext, alt or title
 * - no attribute named for the answer or the gap, and no other attribute whose value is the gap
 * - attributes naming a colour (data-colour, artwork URLs) are symmetric: swapping pink and blue gives
 *   the same set, so none singles out one mitten; the two mittens' classes match too
 * - no success marker: no success motion, dance, star flight, landed star, flurry or snowman reaction
 * Allowed: `data-count` and the snowflakes it describes, the progress labels and, with `pairing`, the
 * pairing markers (`data-pairing`, `data-pair`, `data-line`, `data-leftover`) after a miss.
 */
async function expectNoEarlyAnswer(
  page: Page,
  node: LessonNodeDefinition,
  { pairing = false }: { pairing?: boolean } = {},
) {
  const gap = String(node.presentation.gap);
  // The learner's screen: the stage, status and progress. The ?debug=1 diagnostics panel is developer-only.
  const main = page.getByRole("main").locator("section[data-palette]");
  const dom = await main.evaluate(root => {
    const texts: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode())
      if (text.textContent?.trim()) texts.push(text.parentElement?.textContent?.trim() ?? text.textContent.trim());
    const attributes = [...root.querySelectorAll("*")].flatMap(element =>
      [...element.attributes].map(({ name, value }) => ({
        name,
        value,
        progress: !!element.closest('ol[aria-label="Adventure progress"]'),
      })),
    );
    const classes = (selector: string) =>
      [...root.querySelectorAll(selector)].map(element => element.getAttribute("class") ?? "");
    return {
      texts,
      attributes,
      mittens: classes("[data-face]"),
      hands: classes('[data-face] [class*="__hand"]'),
    };
  });
  for (const text of dom.texts.filter(text => !progressText.test(text))) {
    expect(text).not.toMatch(colourWords);
    expect(text).not.toMatch(numbers);
  }
  const labelled = dom.attributes.filter(({ name }) =>
    ["aria-label", "aria-description", "aria-valuetext", "alt", "title"].includes(name),
  );
  for (const { value } of labelled) {
    expect(value).not.toMatch(colourWords);
    expect(value).not.toMatch(numbers);
  }
  const pairingMarkers = ["data-pairing", "data-pair", "data-line", "data-leftover"];
  for (const { name } of dom.attributes) {
    expect(name).not.toMatch(/answer|more|winner|correct|gap|target|hint|picked|highlight|result/i);
    if (!pairing) expect(pairingMarkers).not.toContain(name);
  }
  // Numbers that legitimately equal the gap: counts, pair and line indices, the wiggle count, and image
  // intrinsic sizes and next/image's constant `data-nimg="1"`. Styles hold positions, not facts.
  const numeric = new Set([
    "data-count",
    "data-pair",
    "data-line",
    "data-wiggle",
    "data-nimg",
    "width",
    "height",
    "style",
  ]);
  expect(dom.attributes.filter(({ name, value }) => value === gap && !numeric.has(name))).toEqual([]);
  const mentions = (colour: MittenColour) =>
    dom.attributes
      // The progress dots' theme classes (the current dot is always pink) say nothing about the round.
      .filter(
        ({ name, value, progress }) => name !== "style" && !progress && new RegExp(`\\b${colour}\\b`, "i").test(value),
      )
      .map(({ name, value }) => `${name}=${value.replaceAll(new RegExp(colour, "gi"), "<colour>")}`)
      .sort();
  expect(mentions("pink")).toEqual(mentions("blue"));
  expect(dom.mittens).toHaveLength(2);
  expect(dom.mittens[0]).toBe(dom.mittens[1]);
  expect(new Set(dom.hands).size).toBeLessThanOrEqual(1);
  const stage = stageFor(page, node.id);
  await expect(stage).not.toHaveAttribute("data-motion", "success");
  for (const name of ["dance", "flight", "landed", "flurry", "react"])
    await expect(moduleClass(stage, name)).toHaveCount(0);
  // The preload strip holds every artwork; on stage the snowman stands idle.
  await expect(moduleClass(stage, "layer").locator('img[src*="snowman-"]')).toHaveCount(0);
  if (!pairing) await expect(stage.locator("[data-pair], [data-leftover], [data-line]")).toHaveCount(0);
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
 * turn that holds, and inside the tutor's echo, once success shows, for a correct one.
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
  const missed = (await misses(observer))!;
  if (outcome !== "correct") {
    await during?.();
    await expectNoEarlyAnswer(page, node, { pairing: missed > 0 });
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
          ? missed >= 2
            ? countLine(node)
            : leftOverLine
          : whichMitten),
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
  await page.goto(`${route}?seed=${seed}&debug=1`);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  return waitForRound(page, session.observer, firstRound);
}

/** Success for one round: the mitten with more dances, the snowman reacts and her star lands gold. */
async function expectSuccess(stage: Locator, round: SnowflakeShowdownRound) {
  await expect(stage).toHaveAttribute("data-motion", "success");
  await expect(moduleClass(stage, "dance")).toHaveCount(1);
  await expect(mitten(stage, round.more)).toHaveClass(/__dance(?:\s|$)/);
  await expect(mitten(stage, other(round.more))).not.toHaveClass(/__dance(?:\s|$)/);
  const pose = round.more === "blue" ? "snowman-clap" : "snowman-shrug";
  await expect(moduleClass(stage, "layer").locator(`img[src*="${pose}"]`)).toHaveCount(1);
  // The star leaves at 0.5 s and turns gold on landing at 1.5 s, inside the 2.5 s success hold.
  await expect(goldStars(stage)).toHaveCount(round.round);
  await expect(stage.locator("[data-star]")).toHaveCount(10);
}

test("plays all ten rounds to the finale with every side word, success motion and a growing star row", async ({
  page,
}) => {
  test.setTimeout(240_000);
  // Seed 0 splits five rounds each way (p p b p b b p b p b) across all three tiers and shows every
  // amount from 1 to 6, so each of her three pink forms and three blue forms is used, some twice.
  const seed = 0;
  const plan = snowflakeShowdownPlan(seed);
  const lesson = snowflakeShowdownLesson(seed);
  expect(plan.rounds.map(round => round.more)).toEqual([
    "pink",
    "pink",
    "blue",
    "pink",
    "blue",
    "blue",
    "pink",
    "blue",
    "pink",
    "blue",
  ]);
  expect(new Set(plan.rounds.flatMap(round => [round.counts.pink, round.counts.blue]))).toEqual(
    new Set([1, 2, 3, 4, 5, 6]),
  );
  const forms: Record<MittenColour, string[]> = {
    pink: ["Pink!", "Mine!", "my one"],
    blue: ["Blue.", "You!", "The snowman's!"],
  };
  const said: Record<string, number> = {};
  const session = await setup(page);
  await page.goto(`${route}?seed=${seed}&debug=1`);
  const preview = stageFor(page, firstRound);
  await expect(preview).toHaveAttribute("aria-busy", "false");
  // Before Play both mittens show their backs, with no snowflakes at all.
  for (const colour of MITTEN_COLOURS) await expect(mitten(preview, colour)).toHaveAttribute("data-face", "back");
  await expect(moduleClass(preview, "flake")).toHaveCount(0);
  await expectNoEarlyAnswer(page, lesson.nodes[firstRound]);
  await page.getByRole("button", { name: "Play", exact: true }).click();

  for (const round of plan.rounds) {
    const node = lesson.nodes[SNOWFLAKE_SHOWDOWN_NODE_IDS[round.round - 1]];
    const stage = await waitForRound(page, session.observer, node.id);
    await expectPlannedRound(stage, seed, round);
    // One gold star per completed round, the rest pale.
    await expect(goldStars(stage)).toHaveCount(round.round - 1);
    await expect(stage.locator('[data-star="pale"]')).toHaveCount(10 - (round.round - 1));
    await expectNoEarlyAnswer(page, node);

    const index = said[round.more] ?? 0;
    said[round.more] = index + 1;
    const text = forms[round.more][index % forms[round.more].length];
    const judgement = await turn(page, session, node, text, "correct", {
      during: () => expectSuccess(stage, round),
    });
    expect(judgement.reader).toMatchObject({ status: "colour", value: round.more, owner: "child" });
  }
  expect(said).toEqual({ pink: 5, blue: 5 });

  const complete = stageFor(page, "complete");
  await expect(complete).toHaveAttribute("data-motion", "celebrate", { timeout: 15_000 });
  await expect(complete.getByText(completeCopy)).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(completeCopy);
  await expect(goldStars(complete)).toHaveCount(10);
  await expect(complete.locator('[data-star="pale"]')).toHaveCount(0);

  const log = await session.recorder.read();
  // Both mittens turned with the 3D flip in every round.
  for (const nodeId of SNOWFLAKE_SHOWDOWN_NODE_IDS)
    for (const colour of MITTEN_COLOURS)
      expect(
        log.find(
          item => item.kind === "face" && item.node === nodeId && item.colour === colour && item.value === "turning",
        )?.animations?.mitten,
      ).toMatch(/flip$/);
  // Every star flew to her row; with every round clean, the flurry blew on rounds 3, 6 and 9 only.
  expect([...new Set(log.filter(item => item.kind === "flight").map(item => item.node))]).toEqual([
    ...SNOWFLAKE_SHOWDOWN_NODE_IDS,
  ]);
  expect([...new Set(log.filter(item => item.kind === "flurry").map(item => item.node))]).toEqual([
    "showdown-3",
    "showdown-6",
    "showdown-9",
  ]);
});

test("the round-one intro names both mittens, so her first call after it is her own", async ({ page }) => {
  test.setTimeout(60_000);
  // Seed 1 round 1 is pink 1 and blue 4: blue has more, and the intro ends on "blue is the snowman's".
  const seed = 1;
  const node = snowflakeShowdownLesson(seed).nodes[firstRound];
  expect(node.presentation.answer).toBe("blue");
  expect(snowflakeShowdownLesson(seed).tutor.startInstruction).toContain(intro);
  const session = await setup(page);
  const stage = await play(page, session, seed);

  await tutorSays(page, session.observer, firstRound, intro);
  await expectNoEarlyAnswer(page, node);
  const call = await turn(page, session, node, "Blue!", "correct", {
    during: () => expectSuccess(stage, snowflakeShowdownPlan(seed).rounds[0]),
  });
  expect(call.transcript).toContain(`Tutor: ${intro}`);
  expect(call.reader).toMatchObject({ status: "colour", value: "blue", owner: "child" });
  await waitForRound(page, session.observer, secondRound);
});

test("the tutor's own 'you' never names the snowman's mitten", async ({ page }) => {
  test.setTimeout(60_000);
  // Seed 1 round 1: blue has more. Her "you" means blue; read in a tutor turn it would disclose blue and
  // make her "Blue!" an echo that holds.
  const seed = 1;
  const node = snowflakeShowdownLesson(seed).nodes[firstRound];
  expect(node.presentation.answer).toBe("blue");
  const session = await setup(page);
  await play(page, session, seed);

  await tutorSays(page, session.observer, firstRound, "Can you tell me who has more?");
  const call = await turn(page, session, node, "Blue!", "correct");
  expect(call.transcript).toContain("Tutor: Can you tell me who has more?");
  expect(call.reader).toMatchObject({ status: "colour", value: "blue", owner: "child" });
  await waitForRound(page, session.observer, secondRound);
});

test("a wrong call pairs the snowflakes off, the leftovers glow on the bigger side and the round holds", async ({
  page,
}) => {
  test.setTimeout(60_000);
  // Seed 8 round 1 is pink 5 and blue 2: two pairs (1.5 s at half a second each after a 0.5 s lead) and
  // three leftovers on pink, so the smaller count and the gap differ.
  const seed = 8;
  const round = snowflakeShowdownPlan(seed).rounds[0];
  const node = snowflakeShowdownLesson(seed).nodes[firstRound];
  expect(round).toMatchObject({ more: "pink", counts: { pink: 5, blue: 2 }, gap: 3 });
  const session = await setup(page);
  const stage = await play(page, session, seed);
  await expectPlannedRound(stage, seed, round);

  const wrong = await turn(page, session, node, "Blue!", "incorrect", {
    reply: leftOverLine,
    during: async () => {
      await expect(stage).toHaveAttribute("data-pairing", /running|done/);
      await expect(stage).toHaveAttribute("data-pairing", "done", { timeout: 5_000 });
      await expect(stage.locator("[data-line]")).toHaveCount(round.counts.blue);
      for (const colour of MITTEN_COLOURS) {
        await expect(mitten(stage, colour).locator("[data-pair]")).toHaveCount(round.counts.blue);
        // Each pair joins one snowflake on each mitten.
        const pairs = await mitten(stage, colour)
          .locator("[data-pair]")
          .evaluateAll(items => items.map(item => (item as HTMLElement).dataset.pair).sort());
        expect(pairs).toEqual(["0", "1"]);
      }
      await expect(stage.locator("[data-leftover]")).toHaveCount(round.gap);
      await expect(mitten(stage, "pink").locator("[data-leftover]")).toHaveCount(round.gap);
    },
  });
  expect(wrong.reader).toMatchObject({ status: "colour", value: "blue", owner: "child" });
  expect(await misses(session.observer)).toBe(1);
  const pairing = await session.recorder.read({ kind: "pairing", node: firstRound });
  expect(pairing.map(item => item.value)).toEqual(["running", "done"]);
  expect(pairing[1].t - pairing[0].t).toBeGreaterThanOrEqual(1_400);
  await waitForRound(page, session.observer, firstRound);
  await expect(stage).not.toHaveAttribute("data-motion", "success");
  await expectNoEarlyAnswer(page, node, { pairing: true });

  const right = await turn(page, session, node, "Pink!", "correct");
  expect(right.transcript).toContain(`Tutor: ${leftOverLine}`);
  expect(right.reader).toMatchObject({ status: "colour", value: "pink", owner: "child" });
  const next = await waitForRound(page, session.observer, secondRound);
  await expect(next).not.toHaveAttribute("data-pairing");
  await expect(next.locator("[data-pair], [data-leftover], [data-line]")).toHaveCount(0);
});

test("after a second miss the pairing stays, and her call after the one-turn count line succeeds", async ({ page }) => {
  test.setTimeout(60_000);
  // Seed 8 round 1 is pink 5 and blue 2, so the count line is "Pink has five. Blue has two. Pink has more!"
  const seed = 8;
  const round = snowflakeShowdownPlan(seed).rounds[0];
  const node = snowflakeShowdownLesson(seed).nodes[firstRound];
  const session = await setup(page);
  const stage = await play(page, session, seed);

  await turn(page, session, node, "Blue!", "incorrect", {
    during: () => expect(stage).toHaveAttribute("data-pairing", "done", { timeout: 5_000 }),
  });
  const second = await turn(page, session, node, "You!", "incorrect", {
    during: async () => {
      expect(await misses(session.observer)).toBe(2);
      await expect(stage).toHaveAttribute("data-pairing", "done");
      await expect(stage.locator("[data-line]")).toHaveCount(round.counts.blue);
      await expect(mitten(stage, "pink").locator("[data-leftover]")).toHaveCount(round.gap);
    },
  });
  expect(second.reader).toMatchObject({ status: "colour", value: "blue", owner: "child" });
  // The second miss did not restart the pairing.
  expect((await session.recorder.read({ kind: "pairing", node: firstRound })).map(item => item.value)).toEqual([
    "running",
    "done",
  ]);

  const right = await turn(page, session, node, "Pink!", "correct");
  expect(right.transcript).toContain(`Tutor: ${countLine(node)}`);
  expect(countLine(node)).toBe("Pink has five. Blue has two. Pink has more!");
  expect(right.reader).toMatchObject({ status: "colour", value: "pink", owner: "child" });
  await waitForRound(page, session.observer, secondRound);
});

test("a count line split over two tutor outputs with no child turn between still names both mittens", async ({
  page,
}) => {
  test.setTimeout(60_000);
  // Seed 2 round 1 is pink 1 and blue 5: blue has more.
  const seed = 2;
  const round = snowflakeShowdownPlan(seed).rounds[0];
  const node = snowflakeShowdownLesson(seed).nodes[firstRound];
  expect(round).toMatchObject({ more: "blue", counts: { pink: 1, blue: 5 } });
  const session = await setup(page);
  await play(page, session, seed);

  await turn(page, session, node, "Pink!", "incorrect");
  await turn(page, session, node, "Mine!", "incorrect", { reply: "Pink has one. Blue has five." });
  // A second, separate output burst. The runtime groups tutor speech by her child turn, so with no child
  // speech between, both bursts are one tutor turn that names both mittens: no disclosure.
  await tutorSays(page, session.observer, firstRound, "Blue has more!");
  const right = await turn(page, session, node, "Blue!", "correct");
  expect(right.transcript).toContain("Tutor: Pink has one. Blue has five.Blue has more!");
  expect(right.reader).toMatchObject({ status: "colour", value: "blue", owner: "child" });
  await waitForRound(page, session.observer, secondRound);
});

test("a tutor turn naming only the answer makes her first repeat an echo; the second is assisted", async ({ page }) => {
  test.setTimeout(75_000);
  // Seed 2 round 1: blue has more. Her "Um." between the counts and "Blue has more!" makes the latter its
  // own tutor turn naming blue alone.
  const seed = 2;
  const node = snowflakeShowdownLesson(seed).nodes[firstRound];
  const session = await setup(page);
  const stage = await play(page, session, seed);

  await turn(page, session, node, "Pink!", "incorrect");
  await turn(page, session, node, "Mine!", "incorrect", { reply: "Pink has one. Blue has five." });
  const um = await turn(page, session, node, "Um.", "none", { reply: "Blue has more!" });
  expect(um.reader).toMatchObject({ status: "none" });
  const echo = await turn(page, session, node, "Blue!", "none", { reply: whichMitten });
  expect(echo.transcript).toMatch(/Tutor: Blue has more!\nChild: Blue!$/);
  expect(echo.reader).toMatchObject({ status: "colour", value: "blue", owner: "echo" });
  expect(await misses(session.observer)).toBe(2);
  await waitForRound(page, session.observer, firstRound);
  await expect(stage).not.toHaveAttribute("data-motion", "success");

  const assisted = await turn(page, session, node, "Blue!", "correct");
  expect(assisted.reader).toMatchObject({ status: "colour", value: "blue", owner: "assisted" });
  await waitForRound(page, session.observer, secondRound);
});

test("a number or 'that one' holds the round with no miss and no pairing", async ({ page }) => {
  test.setTimeout(60_000);
  // Seed 0 round 1 is pink 4 and blue 1, so "Four." is pink's count said back instead of a side.
  const seed = 0;
  const node = snowflakeShowdownLesson(seed).nodes[firstRound];
  expect(snowflakeShowdownPlan(seed).rounds[0].counts).toEqual({ pink: 4, blue: 1 });
  const session = await setup(page);
  const stage = await play(page, session, seed);

  const count = await turn(page, session, node, "Four.", "none", { reply: whichMitten });
  expect(count.reader).toMatchObject({ status: "number_only" });
  const pointing = await turn(page, session, node, "That one.", "none", { reply: whichMitten });
  expect(pointing.reader).toMatchObject({ status: "deictic" });
  expect(await misses(session.observer)).toBe(0);
  await expect(stage).not.toHaveAttribute("data-pairing");
  await expect(stage.locator("[data-pair], [data-leftover], [data-line]")).toHaveCount(0);
  expect(await session.recorder.read({ kind: "pairing" })).toEqual([]);
  await waitForRound(page, session.observer, firstRound);

  await turn(page, session, node, "Pink!", "correct");
  await waitForRound(page, session.observer, secondRound);
});

test("silence after the flip wiggles both mittens every five seconds, three times at most", async ({ page }) => {
  test.setTimeout(60_000);
  const session = await setup(page);
  const stage = await play(page, session, 0);
  const cursor = await session.observer.cursor();
  await expect(mitten(stage, "pink")).toHaveAttribute("data-face", "palm");
  await expect
    .poll(async () => (await session.recorder.read({ kind: "wiggle", node: firstRound })).length, { timeout: 25_000 })
    .toBeGreaterThanOrEqual(6);
  // Seven more seconds of quiet: no fourth wiggle.
  await page.waitForTimeout(7_000);
  const log = await session.recorder.read({ node: firstRound });
  const palm = log.find(item => item.kind === "face" && item.value === "palm")!;
  const wiggles = log.filter(item => item.kind === "wiggle");
  const starts = wiggles.filter(item => item.value !== null);
  expect(starts.map(item => item.value)).toEqual(["1", "2", "3"]);
  expect(wiggles.filter(item => item.value === null)).toHaveLength(3);
  // Both mittens wiggle together.
  for (const start of starts) expect(start.wiggling).toBe(2);
  // Page clock times from the recorder. The wait starts when the round is ready: the flip ends (palm) and
  // the runtime is live and listening, which can trail the palm by a steering acknowledgement. Never early;
  // the first allows 1 s for that and for timer scheduling with several workers, later ones 0.75 s.
  const gaps = starts.map((start, index) => start.t - (index === 0 ? palm.t : starts[index - 1].t));
  expect(gaps[0]).toBeGreaterThanOrEqual(5_000 - 50);
  expect(gaps[0]).toBeLessThan(6_000);
  for (const gap of gaps.slice(1)) {
    expect(gap).toBeGreaterThanOrEqual(5_000 - 50);
    expect(gap).toBeLessThan(5_750);
  }
  // The wiggle replaces the spoken nudge: the lesson asks the tutor nothing.
  const events = (await session.observer.read(cursor))!.events;
  expect(events.filter(item => item.type === "silence_nudge.requested")).toHaveLength(0);
  await expectNoEarlyAnswer(page, snowflakeShowdownLesson(0).nodes[firstRound]);
});

test("three clean first-try rounds in a row blow the flurry once, and a miss starts the run over", async ({ page }) => {
  test.setTimeout(150_000);
  // Seed 0 rounds 1 to 6 are p p b p b b. Clean, clean, a miss in round 3, then clean 4, 5 and 6. Without
  // the reset the flurry would come in round 3 or 4; with it, only in round 6.
  const seed = 0;
  const plan = snowflakeShowdownPlan(seed);
  const lesson = snowflakeShowdownLesson(seed);
  const session = await setup(page);
  await play(page, session, seed);
  for (const round of plan.rounds.slice(0, 6)) {
    const node = lesson.nodes[SNOWFLAKE_SHOWDOWN_NODE_IDS[round.round - 1]];
    const stage = await waitForRound(page, session.observer, node.id);
    if (round.round === 3) await turn(page, session, node, capitalised(other(round.more)) + "!", "incorrect");
    await turn(page, session, node, capitalised(round.more) + "!", "correct", {
      during: async () => {
        if (round.round !== 6) return;
        await expect(moduleClass(stage, "flurry")).toHaveCount(1);
        await expect(moduleClass(stage, "flurry")).toHaveCSS("animation-name", /flurry$/);
      },
    });
  }
  await waitForRound(page, session.observer, SNOWFLAKE_SHOWDOWN_NODE_IDS[6]);
  const flurries = await session.recorder.read({ kind: "flurry" });
  expect([...new Set(flurries.map(item => item.node))]).toEqual(["showdown-6"]);
});

test("stopping and playing again restarts at round one with no gold stars and a fresh streak", async ({ page }) => {
  test.setTimeout(90_000);
  // Seed 0 rounds 1 and 2 are both pink. Two clean rounds, then a restart: if the streak carried over, the
  // first clean round after it would be the third in a row and blow the flurry.
  const seed = 0;
  const lesson = snowflakeShowdownLesson(seed);
  const plan = snowflakeShowdownPlan(seed);
  const session = await setup(page);
  await play(page, session, seed);
  await turn(page, session, lesson.nodes[firstRound], "Pink!", "correct");
  await waitForRound(page, session.observer, secondRound);
  await turn(page, session, lesson.nodes[secondRound], "Pink!", "correct");
  const third = await waitForRound(page, session.observer, SNOWFLAKE_SHOWDOWN_NODE_IDS[2]);
  await expect(goldStars(third)).toHaveCount(2);
  const firstAttempt = await session.observer.cursor();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("We’ve stopped for now. You can play again whenever you like.");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const stage = await waitForRound(page, session.observer, firstRound);
  expect((await session.observer.cursor()).runtimeId).not.toBe(firstAttempt.runtimeId);
  await expectPlannedRound(stage, seed, plan.rounds[0]);
  await expect(goldStars(stage)).toHaveCount(0);
  await expect(stage.locator('[data-star="pale"]')).toHaveCount(10);
  await expectNoEarlyAnswer(page, lesson.nodes[firstRound]);

  await turn(page, session, lesson.nodes[firstRound], "Pink!", "correct", {
    during: () => expect(goldStars(stage)).toHaveCount(1),
  });
  await waitForRound(page, session.observer, secondRound);
  expect(await session.recorder.read({ kind: "flurry" })).toEqual([]);
});

test("reduced motion fades the mittens, draws the pairing at once and turns the star gold in place", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Seed 8 round 1 is pink 5 and blue 2: a wrong "Blue!" draws two pairs, which normally take 1.5 s.
  const seed = 8;
  const round = snowflakeShowdownPlan(seed).rounds[0];
  const node = snowflakeShowdownLesson(seed).nodes[firstRound];
  const session = await setup(page);
  const stage = await play(page, session, seed);
  await expectPlannedRound(stage, seed, round);
  // The flip: no 3D turn; the palm fades in over the fading back.
  const turning = (await session.recorder.read({ kind: "face", node: firstRound })).filter(
    item => item.value === "turning",
  );
  for (const colour of MITTEN_COLOURS)
    expect(turning.find(item => item.colour === colour)?.animations).toMatchObject({
      mitten: "none",
      palm: expect.stringMatching(/fade-in$/),
      back: expect.stringMatching(/fade-out$/),
    });
  await expect(moduleClass(stage, "swish")).toHaveCount(0);

  await turn(page, session, node, "Blue!", "incorrect", {
    during: async () => {
      await expect(stage).toHaveAttribute("data-pairing", "done");
      await expect(stage.locator("[data-line]")).toHaveCount(2);
      await expect(mitten(stage, "pink").locator("[data-leftover]")).toHaveCount(3);
      // The lines are drawn in full, with no stroke animation.
      for (const line of await stage.locator("[data-line] line").all()) {
        await expect(line).toHaveCSS("animation-name", "none");
        await expect(line).toHaveCSS("stroke-dashoffset", "0px");
      }
    },
  });
  const pairing = await session.recorder.read({ kind: "pairing", node: firstRound });
  expect(pairing.map(item => item.value)).toEqual(["running", "done"]);
  // All at once: the pairing's zero-delay timers finish within a few frames, against 1.5 s with motion.
  expect(pairing[1].t - pairing[0].t).toBeLessThan(250);

  await turn(page, session, node, "Pink!", "correct", {
    during: async () => {
      await expect(goldStars(stage)).toHaveCount(1);
      await expect(mitten(stage, "pink")).toHaveCSS("animation-name", "none");
      await expect(moduleClass(stage, "landed").locator("img")).toHaveCSS("animation-name", /flash$/);
    },
  });
  // The star turned gold in place: nothing flew.
  expect(await session.recorder.read({ kind: "flight" })).toEqual([]);
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
    if (seed !== null) expect(lessonId).toBe(`counting-snowflake-showdown-${seed}`);
    const chosen = parseSnowflakeShowdownLessonId(lessonId);
    if (chosen === null) throw new Error(`Invalid Snowflake Showdown lesson ID: ${lessonId}`);
    await waitForRound(page, session.observer, firstRound);
    await turn(page, session, snowflakeShowdownLesson(chosen).nodes[firstRound], "I'm not sure.", "none", {
      reply: whichMitten,
    });
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
