import { test, expect, type Page } from "@playwright/test";
import {
  COUNTING_LESSON_GRAPH,
  COUNTING_NODE_IDS,
  type CountingNodeId,
} from "../../lib/lesson-runtime/counting-lesson";
import { countingAnswer } from "../helpers/child-scenario";
import { installLessonObserver, type LessonObserver } from "../helpers/lesson-observer";
import { installLocalSession, type LocalSessionWindow } from "../helpers/local-voice-session";
import { installSyntheticMicrophone } from "../helpers/synthetic-microphone";

type Microphone = Awaited<ReturnType<typeof installSyntheticMicrophone>>;
const WORDS = ["One", "Two", "Three", "Four"];

/** Provider-free: local peer PCM, synthetic microphone VAD, injected transcripts and a mocked classifier. */
async function setup(page: Page) {
  const microphone = await installSyntheticMicrophone(page);
  await installLocalSession(page);
  const observer = await installLessonObserver(page);
  // Registered after the local session default, so it takes precedence. Echo the exact captured
  // source identity; the reducer still applies every turn, revision, audio and render gate itself.
  await page.route("**/api/classify", route => {
    const { nodeId, transcriptRevision } = route.request().postDataJSON();
    return route.fulfill({
      json: {
        proposal: {
          nodeId,
          transcriptRevision,
          childActivity: "unknown",
          answerOutcome: "correct",
          answerCommitment: "committed",
          supportState: "none",
          tutorState: "acknowledging",
        },
      },
    });
  });
  return { microphone, observer };
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

/** One correct exchange: child VAD turn + transcript, classifier proposal, then tutor PCM onset and quiet drain. */
async function answerCurrentScene(
  page: Page,
  observer: LessonObserver,
  microphone: Microphone,
  nodeId: CountingNodeId,
) {
  const node = COUNTING_LESSON_GRAPH[nodeId];
  const fixture = countingAnswer(nodeId, true);
  await microphone.loadSpeech(fixture);
  const before = await observer.cursor();
  const scope = { runtimeId: before.runtimeId, nodeId };
  const playback = await microphone.playSpeech(fixture);
  await observer.waitForEvent("microphone.speech_started", { after: before, scope });
  await page.evaluate(
    text => (window as unknown as LocalSessionWindow).sendTranscript("session.input_transcript.delta", text),
    `${WORDS[node.quantity - 1]}.`,
  );
  expect(await microphone.waitForPlayback(playback.id)).toBe("ended");
  await observer.waitForEvent("microphone.speech_stopped", { after: before, scope });
  await observer.waitForEvent("classifier.result", {
    after: before,
    scope,
    detail: { proposal: { nodeId, answerOutcome: "correct" } },
  });
  // Accepted learner evidence alone must not move the scene before the tutor acknowledges it.
  expect((await observer.read())?.snapshot.display.nodeId).toBe(nodeId);
  const acknowledged = await observer.cursor();
  await setTutorLevel(page, 0.2);
  await observer.waitForEvent("output.activity", { after: acknowledged, scope, detail: { state: "active" } });
  await page.evaluate(
    text => (window as unknown as LocalSessionWindow).sendTranscript("session.output_transcript.delta", text),
    `Yes! ${WORDS[node.quantity - 1]} ${node.object}${node.quantity === 1 ? "" : "s"}.`,
  );
  // The answered group stays displayed while the acknowledgment is still playing.
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
  await expect(stage.locator("[data-counting-object]")).toHaveCount(0);
  await expectProgress(
    page,
    COUNTING_NODE_IDS.map(() => "done"),
  );
  await expect(page.getByRole("button", { name: "Play again", exact: true })).toBeEnabled();
  const report = await observer.report();
  expect(report?.runtime).toMatchObject({ phase: "complete", lessonComplete: true });
  const visited = report!.events
    .filter(event => event.type === "render.confirmed")
    .map(event => (event.detail as { identity: { nodeId: string | null } }).identity.nodeId);
  expect(visited).toEqual([...COUNTING_NODE_IDS, null]);
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
  await expect(page.getByRole("main")).not.toContainText(/complete|celebration/i);
  await expect(page.getByRole("img", { name: "2 ducks to count", exact: true })).toBeVisible();
  await expectProgress(page, ["done", "current", "upcoming", "upcoming", "upcoming", "upcoming"]);
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Play again", exact: true })).toHaveCount(0);
  expect((await observer.read())?.snapshot.runtime).toMatchObject({ phase: "stopped", lessonComplete: false });
});
