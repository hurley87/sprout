import { test, expect, type Page, type Route } from "@playwright/test";
import {
  COUNTING_LESSON_GRAPH,
  COUNTING_NODE_IDS,
  type CountingNodeId,
} from "../../lib/lesson-runtime/counting-lesson";
import { countingAnswer } from "../helpers/child-scenario";
import { classifierProposal } from "../helpers/runtime-classifier";
import { installLessonObserver, type LessonObserver } from "../helpers/lesson-observer";
import { installLocalSession, type LocalSessionWindow } from "../helpers/local-voice-session";
import { installSyntheticMicrophone } from "../helpers/synthetic-microphone";

type Microphone = Awaited<ReturnType<typeof installSyntheticMicrophone>>;
const WORDS = ["One", "Two", "Three", "Four"];

/** Echo the exact captured source identity; the reducer still applies every gate itself. */
function classifierReply(route: Route, answerOutcome: "correct" | "incorrect" = "correct") {
  return {
    proposal: classifierProposal(route.request().postDataJSON(), {
      answerOutcome,
      answerCommitment: "committed",
      tutorState: "acknowledging",
    }),
  };
}

/** Provider-free: local peer PCM, synthetic microphone VAD, injected transcripts and a mocked classifier.
 * `verdict` lets a test mark a learner answer wrong; every other gate is still the reducer's. */
async function setup(page: Page, verdict: () => "correct" | "incorrect" = () => "correct") {
  const microphone = await installSyntheticMicrophone(page);
  await installLocalSession(page);
  const observer = await installLessonObserver(page);
  // Registered after the local session default, so it takes precedence.
  await page.route("**/api/classify", route => route.fulfill({ json: classifierReply(route, verdict()) }));
  // Every stage motion and voice cue the child could have seen, in commit order.
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.assign(window, { motionLog: seen });
    const record = () => {
      const stage = document.querySelector("[data-scene-id]");
      const cue = document.querySelector("[data-voice-activity]");
      const numeral = stage?.querySelector("[data-success-numeral]")?.textContent ?? "none";
      const entry = `${stage?.getAttribute("data-node-id")}:${stage?.getAttribute("data-motion")}:${cue?.getAttribute("data-voice-activity")}:${numeral}`;
      if (seen.at(-1) !== entry) seen.push(entry);
    };
    document.addEventListener("DOMContentLoaded", () => {
      record();
      new MutationObserver(record).observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["data-node-id", "data-motion", "data-voice-activity"],
      });
    });
  });
  return { microphone, observer };
}

const motionLog = (page: Page) => page.evaluate(() => (window as unknown as { motionLog: string[] }).motionLog);
const stageFor = (page: Page, nodeId: string) => page.locator(`[data-scene-id][data-node-id="${nodeId}"]`);
const voiceCue = (page: Page) => page.locator("[data-voice-activity]");

const KEYFRAMES = {
  duck: { idle: "bob", success: "wiggle" },
  butterfly: { idle: "drift", success: "flutter" },
  flower: { idle: "sway", success: "bloom" },
} as const;

/** With motion allowed, every character of the group runs its kind's (module-scoped) keyframes. */
async function expectCharacterMotion(page: Page, nodeId: CountingNodeId, motion: "idle" | "success") {
  if (await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
  const node = COUNTING_LESSON_GRAPH[nodeId];
  expect(await characterAnimations(page, nodeId)).toEqual(
    Array(node.quantity).fill(expect.stringContaining(KEYFRAMES[node.object][motion])),
  );
  const fades = await stageFor(page, nodeId)
    .locator("[data-counting-object], [data-counting-object] img")
    .evaluateAll(elements =>
      elements.flatMap(element =>
        element
          .getAnimations()
          .flatMap(animation =>
            (animation.effect as KeyframeEffect).getKeyframes().filter(frame => frame.opacity !== undefined),
          ),
      ),
    );
  expect(fades).toEqual([]);
}

/** While the child counts, idle motion is paused and the entrance has finished (it never replays). */
async function expectCharactersStill(page: Page, nodeId: CountingNodeId) {
  if (await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
  const characters = stageFor(page, nodeId).locator("[data-counting-object]");
  await expect
    .poll(() =>
      characters.evaluateAll(boxes =>
        boxes.every(
          box =>
            box.getAnimations().length === 0 &&
            box
              .querySelector("img")!
              .getAnimations()
              .every(animation => animation.playState !== "running"),
        ),
      ),
    )
    .toBe(true);
}

/** The kind-specific success keyframes actually run on each answered character, or none under reduced motion. */
async function characterAnimations(page: Page, nodeId: string) {
  return stageFor(page, nodeId)
    .locator("[data-counting-object] img")
    .evaluateAll(images => images.map(image => getComputedStyle(image).animationName));
}

async function expectScene(page: Page, observer: LessonObserver, nodeId: CountingNodeId) {
  const node = COUNTING_LESSON_GRAPH[nodeId];
  await expect
    .poll(async () => {
      const snapshot = (await observer.read())?.snapshot;
      return snapshot?.display.nodeId === nodeId && snapshot.runtime?.phase === "active" && !snapshot.awaitingSteering;
    })
    .toBe(true);
  const stage = page.getByRole("img", {
    name: `${node.quantity} ${node.object}${node.quantity === 1 ? "" : "s"} to count`,
    exact: true,
  });
  await expect(stage).toHaveAttribute("data-node-id", nodeId);
  await expect(stage).toHaveAttribute("data-scene-id", node.sceneId);
  await expect(stage.locator(`[data-counting-object="${node.object}"]`)).toHaveCount(node.quantity);
  await expect(stage.locator("[data-counting-object]")).toHaveCount(node.quantity);
  const index = COUNTING_NODE_IDS.indexOf(nodeId);
  await expectProgress(
    page,
    COUNTING_NODE_IDS.map((_, step) => (step < index ? "done" : step === index ? "current" : "upcoming")),
  );
}

async function expectProgress(page: Page, expected: string[]) {
  const leaves = page.getByRole("list", { name: "Adventure progress" }).getByRole("listitem");
  await expect
    .poll(() => leaves.evaluateAll(items => items.map(item => item.getAttribute("data-progress"))))
    .toEqual(expected);
}

async function setTutorLevel(page: Page, gain: number) {
  await page.evaluate(value => {
    (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = value;
  }, gain);
}

/** One exchange: child VAD turn + transcript, classifier proposal, then tutor PCM onset and quiet drain. */
async function answerCurrentScene(
  page: Page,
  observer: LessonObserver,
  microphone: Microphone,
  nodeId: CountingNodeId,
  correct = true,
) {
  const node = COUNTING_LESSON_GRAPH[nodeId];
  const fixture = countingAnswer(nodeId, correct);
  const spoken = WORDS[correct ? node.quantity - 1 : node.quantity % WORDS.length];
  await microphone.loadSpeech(fixture);
  const before = await observer.cursor();
  const scope = { runtimeId: before.runtimeId, nodeId };
  const playback = await microphone.playSpeech(fixture);
  await observer.waitForEvent("microphone.speech_started", { after: before, scope });
  await page.evaluate(
    text => (window as unknown as LocalSessionWindow).sendTranscript("session.input_transcript.delta", text),
    `${spoken}.`,
  );
  expect(await microphone.waitForPlayback(playback.id)).toBe("ended");
  await observer.waitForEvent("microphone.speech_stopped", { after: before, scope });
  await observer.waitForEvent("classifier.result", {
    after: before,
    scope,
    detail: { proposal: { nodeId, answerOutcome: correct ? "correct" : "incorrect" } },
  });
  // Accepted learner evidence alone must not move the scene, or be praised, before the tutor acknowledges it.
  expect((await observer.read())?.snapshot.display.nodeId).toBe(nodeId);
  await expect(stageFor(page, nodeId)).toHaveAttribute("data-motion", "calm");
  await expect(voiceCue(page)).toHaveAttribute("data-voice-activity", "thinking");
  await expect(page.getByRole("status")).toHaveText("Sprout is thinking…");
  await expect(stageFor(page, nodeId).locator("[data-success-numeral]")).toHaveCount(0);
  await expectCharactersStill(page, nodeId);
  const acknowledged = await observer.cursor();
  await setTutorLevel(page, 0.2);
  await observer.waitForEvent("output.activity", { after: acknowledged, scope, detail: { state: "active" } });
  await expect(voiceCue(page)).toHaveAttribute("data-voice-activity", correct ? "understood" : "speaking");
  if (!correct) {
    // Sprout's reply returns the scene from calm to idle; the characters' entrance must not replay.
    await expect(stageFor(page, nodeId)).toHaveAttribute("data-motion", "idle");
    expect(
      await stageFor(page, nodeId)
        .locator("[data-counting-object]")
        .evaluateAll(boxes => boxes.every(box => box.getAnimations().length === 0)),
    ).toBe(true);
  }
  await page.evaluate(
    text => (window as unknown as LocalSessionWindow).sendTranscript("session.output_transcript.delta", text),
    correct ? `Yes! ${spoken} ${node.object}${node.quantity === 1 ? "" : "s"}.` : `Let's count them together again.`,
  );
  // The answered group stays displayed, and celebrates, while the acknowledgment is still playing.
  await expect(stageFor(page, nodeId)).toHaveAttribute("data-motion", correct ? "success" : "idle");
  if (correct) await expect(stageFor(page, nodeId).locator("[data-success-numeral]")).toHaveText(String(node.quantity));
  else await expect(stageFor(page, nodeId).locator("[data-success-numeral]")).toHaveCount(0);
  await expectCharacterMotion(page, nodeId, correct ? "success" : "idle");
  expect((await observer.read())?.snapshot.display.nodeId).toBe(nodeId);
  await setTutorLevel(page, 0);
  await observer.waitForEvent("output.activity", { after: acknowledged, scope, detail: { state: "quiet" } });
}

test("plays all six authored scenes in order to the garden celebration", async ({ page }) => {
  test.setTimeout(90_000);
  const { microphone, observer } = await setup(page);
  await page.goto("/");
  // Before Play: the first authored scene and its progress, with no runtime yet.
  await expect(page.getByRole("img", { name: "1 duck to count", exact: true })).toHaveAttribute(
    "data-node-id",
    "count-1-duck",
  );
  await expectProgress(page, ["current", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming"]);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await observer.read())?.snapshot.status).toBe("live");

  for (const nodeId of COUNTING_NODE_IDS) {
    await expectScene(page, observer, nodeId);
    // A fresh group arrives calmly; nothing celebrates on entry.
    await expect(stageFor(page, nodeId)).not.toHaveAttribute("data-motion", "success");
    await expectCharacterMotion(page, nodeId, "idle");
    const from = await observer.cursor();
    await answerCurrentScene(page, observer, microphone, nodeId);
    const edge = COUNTING_LESSON_GRAPH[nodeId].onSuccess;
    const rendered = await observer.waitForEvent("render.confirmed", {
      after: from,
      scope: { runtimeId: from.runtimeId },
      detail: { identity: { nodeId: edge.kind === "node" ? edge.nodeId : null } },
    });
    if (edge.kind === "node") {
      // Next-question steering follows the exact render confirmation, never precedes it.
      await observer.waitForEvent("gpt_live.steering_append", {
        after: rendered.cursor,
        scope: { runtimeId: from.runtimeId, nodeId: edge.nodeId },
      });
    }
  }

  const { runtimeId } = await observer.cursor();
  await observer.waitForEvent("lesson.ended", {
    after: { runtimeId, offset: 0 },
    scope: { runtimeId },
    detail: { reason: "lesson_completed" },
  });
  await expect(page.getByRole("status")).toHaveText("Our counting adventure is complete!");
  const stage = page.getByRole("img", { name: "Lesson complete", exact: true });
  await expect(stage).toContainText("Garden celebration!");
  await expect(stage).toHaveAttribute("data-motion", "celebrate");
  await expect(stage.locator("[data-celebration-character]")).toHaveCount(3);
  await expect(stage.locator("[data-celebration-flower]")).toHaveCount(4);
  await expect(stage.locator("[data-counting-object]")).toHaveCount(0);
  await expect(voiceCue(page)).toHaveAttribute("data-voice-activity", "off");
  await expectProgress(
    page,
    COUNTING_NODE_IDS.map(() => "done"),
  );
  await expect(page.getByRole("button", { name: "Play again", exact: true })).toBeEnabled();
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const buttonBox = await page.getByRole("button", { name: "Play again", exact: true }).boundingBox();
    const textBox = await stage.getByText(/Garden celebration!/).boundingBox();
    expect(
      buttonBox &&
        textBox &&
        (buttonBox.y >= textBox.y + textBox.height || textBox.y >= buttonBox.y + buttonBox.height),
    ).toBe(true);
  }
  const report = await observer.report();
  expect(report?.runtime).toMatchObject({ phase: "complete", lessonComplete: true });
  const visited = report!.events
    .filter(event => event.type === "render.confirmed")
    .map(event => (event.detail as { identity: { nodeId: string | null } }).identity.nodeId);
  expect(visited).toEqual([...COUNTING_NODE_IDS, null]);

  // Each answered group celebrated while still displayed, and no scene began with its predecessor's success.
  const log = await motionLog(page);
  const seen = (entry: string) => log.findIndex(item => item.startsWith(entry));
  for (const [index, nodeId] of COUNTING_NODE_IDS.entries()) {
    const next = COUNTING_NODE_IDS[index + 1] ?? "complete";
    expect(seen(`${nodeId}:success:understood:${COUNTING_LESSON_GRAPH[nodeId].quantity}`)).toBeGreaterThan(-1);
    expect(seen(`${nodeId}:success`)).toBeLessThan(seen(`${next}:`));
    expect(log[seen(`${next}:`)]).toMatch(/:none$/);
  }
  expect(log.some(entry => entry.includes(":listening:"))).toBe(true);
});

test("a wrong answer gets no celebration; the corrected answer does", async ({ page }) => {
  let verdict: "correct" | "incorrect" = "incorrect";
  const { microphone, observer } = await setup(page, () => verdict);
  await page.goto("/");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expectScene(page, observer, "count-1-duck");
  await answerCurrentScene(page, observer, microphone, "count-1-duck", false);
  // Well past the drain: the wrong answer holds the scene and never showed success.
  await page.waitForTimeout(800);
  expect((await observer.read())?.snapshot).toMatchObject({
    display: { nodeId: "count-1-duck" },
    runtime: { phase: "active", answerAccepted: false },
  });
  expect((await motionLog(page)).filter(entry => entry.includes(":success:"))).toEqual([]);
  verdict = "correct";
  await answerCurrentScene(page, observer, microphone, "count-1-duck");
  await expectScene(page, observer, "count-2-ducks");
});

test("reduced motion keeps the success state static", async ({ page }) => {
  const { microphone, observer } = await setup(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expectScene(page, observer, "count-1-duck");
  await expect.poll(() => characterAnimations(page, "count-1-duck")).toEqual(["none"]);
  const { runtimeId } = await observer.cursor();
  const motion = page.evaluate(
    () =>
      new Promise<{ character: string[]; cue: string[]; filter: string }>(resolve => {
        const check = () => {
          const stage = document.querySelector('[data-node-id="count-1-duck"][data-motion="success"]');
          if (!stage) return requestAnimationFrame(check);
          const all = (root: Element) =>
            [root, ...root.querySelectorAll("*")].map(e => getComputedStyle(e).animationName);
          const image = stage.querySelector("[data-counting-object] img")!;
          resolve({
            character: all(stage),
            cue: all(document.querySelector("[data-voice-activity]")!),
            filter: getComputedStyle(image).filter,
          });
        };
        check();
      }),
  );
  await answerCurrentScene(page, observer, microphone, "count-1-duck");
  const seen = await motion;
  expect(new Set(seen.character)).toEqual(new Set(["none"]));
  expect(new Set(seen.cue)).toEqual(new Set(["none"]));
  expect(seen.filter).toContain("drop-shadow");
  await observer.waitForEvent("render.confirmed", {
    after: { runtimeId, offset: 0 },
    scope: { runtimeId },
    detail: { identity: { nodeId: "count-2-ducks" } },
  });
});

test("Stop mid-adventure shows the gentle ended state, never completion", async ({ page }) => {
  const { microphone, observer } = await setup(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expectScene(page, observer, "count-1-duck");
  await answerCurrentScene(page, observer, microphone, "count-1-duck");
  await expectScene(page, observer, "count-2-ducks");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("We’ve stopped for now. You can play again whenever you like.");
  await expect(stageFor(page, "count-2-ducks")).toHaveAttribute("data-motion", "calm");
  await expect(voiceCue(page)).toHaveAttribute("data-voice-activity", "off");
  await expect(page.getByRole("main")).not.toContainText(/complete|celebration/i);
  await expect(page.getByRole("img", { name: "2 ducks to count", exact: true })).toBeVisible();
  await expectProgress(page, ["done", "current", "upcoming", "upcoming", "upcoming", "upcoming"]);
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Play again", exact: true })).toHaveCount(0);
  expect((await observer.read())?.snapshot.runtime).toMatchObject({ phase: "stopped", lessonComplete: false });
});

/** Registered after `setup`, so it takes precedence: classifier replies wait until the test releases them. */
async function holdClassifier(page: Page) {
  const held: (() => Promise<void>)[] = [];
  let holding = true;
  await page.route("**/api/classify", route => {
    // The runtime may have aborted a superseded request; its late reply is irrelevant.
    const reply = () => route.fulfill({ json: classifierReply(route) }).catch(() => {});
    if (holding) held.push(reply);
    else return reply();
  });
  /** Answer only the requests already in flight; later requests stay held. */
  const answerInFlight = () => Promise.all(held.splice(0).map(reply => reply()));
  return {
    pending: () => held.length,
    answerInFlight,
    answerAll: () => {
      holding = false;
      return answerInFlight();
    },
  };
}

/** The child answers one duck (transcribed) and Sprout acknowledges it; its classification is held in flight. */
async function acknowledgeWithHeldClassifier(
  page: Page,
  observer: LessonObserver,
  microphone: Microphone,
  classifier: Awaited<ReturnType<typeof holdClassifier>>,
) {
  const nodeId = "count-1-duck";
  const fixture = countingAnswer(nodeId, true);
  await microphone.loadSpeech(fixture);
  const before = await observer.cursor();
  const scope = { runtimeId: before.runtimeId, nodeId };
  const playback = await microphone.playSpeech(fixture);
  await observer.waitForEvent("microphone.speech_started", { after: before, scope });
  await page.evaluate(
    text => (window as unknown as LocalSessionWindow).sendTranscript("session.input_transcript.delta", text),
    "One.",
  );
  expect(await microphone.waitForPlayback(playback.id)).toBe("ended");
  await observer.waitForEvent("microphone.speech_stopped", { after: before, scope });
  await setTutorLevel(page, 0.2);
  await observer.waitForEvent("output.activity", { after: before, scope, detail: { state: "active" } });
  await page.evaluate(
    text => (window as unknown as LocalSessionWindow).sendTranscript("session.output_transcript.delta", text),
    "Yes! One duck.",
  );
  await setTutorLevel(page, 0);
  const quiet = await observer.waitForEvent("output.activity", { after: before, scope, detail: { state: "quiet" } });
  await observer.waitForEvent("classifier.started", {
    after: quiet.cursor,
    scope,
    detail: { trigger: "tutor_utterance_stable" },
  });
  await expect.poll(() => classifier.pending()).toBeGreaterThan(0);
  return scope;
}

const reportEvents = async (observer: LessonObserver, type: string) =>
  (await observer.report())!.events.filter(event => event.type === type);
const renderedNodes = async (observer: LessonObserver) =>
  (await reportEvents(observer, "render.confirmed")).map(
    event => (event.detail as { identity: { nodeId: string } }).identity.nodeId,
  );

test("short microphone noise during the acknowledged answer's classification does not lose it", async ({ page }) => {
  const { microphone, observer } = await setup(page);
  const classifier = await holdClassifier(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expectScene(page, observer, "count-1-duck");
  const scope = await acknowledgeWithHeldClassifier(page, observer, microphone, classifier);
  const burstFrom = await observer.cursor();
  const burst = await microphone.noise({ seed: 30, durationMs: 40 });
  expect(await microphone.waitForPlayback(burst.id)).toBe("ended");
  await observer.waitForEvent("microphone.activity_discarded", { after: burstFrom, scope });
  // Only the request that was in flight during the burst answers; a re-run would stay held.
  await classifier.answerInFlight();
  await expectScene(page, observer, "count-2-ducks");
  const cancelled = await reportEvents(observer, "classifier.cancelled");
  expect(cancelled.filter(event => (event.detail as { reason: string }).reason === "child_turn_started")).toEqual([]);
  expect(await reportEvents(observer, "gpt_live.answer_recovery_append")).toEqual([]);
  expect(await renderedNodes(observer)).toEqual(["count-1-duck", "count-2-ducks"]);
  await classifier.answerAll();
});

test("a wordless confirmed turn after an acknowledged answer advances without asking again", async ({ page }) => {
  test.setTimeout(45_000);
  const { microphone, observer } = await setup(page);
  const classifier = await holdClassifier(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expectScene(page, observer, "count-1-duck");
  const scope = await acknowledgeWithHeldClassifier(page, observer, microphone, classifier);
  // Confirmed speech that GPT-Live never transcribes supersedes the in-flight classification.
  await microphone.loadSpeech("counting");
  const turnFrom = await observer.cursor();
  const playback = await microphone.playSpeech("counting");
  await observer.waitForEvent("classifier.cancelled", { after: turnFrom, scope });
  expect(await microphone.waitForPlayback(playback.id)).toBe("ended");
  await observer.waitForEvent("classifier.blocked", {
    after: turnFrom,
    scope,
    detail: { reason: "missing_current_turn_child_transcript" },
  });
  await classifier.answerAll();
  // The existing bounded missing-text window elapses, then the transcribed answer is restored.
  await observer.waitForEvent("render.confirmed", {
    after: turnFrom,
    scope: { runtimeId: scope.runtimeId },
    detail: { identity: { nodeId: "count-2-ducks" } },
    timeoutMs: 10_000,
  });
  await expectScene(page, observer, "count-2-ducks");
  expect(await reportEvents(observer, "answer_recovery.prior_answer_restored")).toHaveLength(1);
  expect(await reportEvents(observer, "gpt_live.answer_recovery_append")).toEqual([]);
  expect(await renderedNodes(observer)).toEqual(["count-1-duck", "count-2-ducks"]);
});
