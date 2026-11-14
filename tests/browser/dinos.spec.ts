import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { DINO_CAR_CRUNCH_LESSON, DINO_CAR_CRUNCH_NODE_IDS } from "../../lib/lesson-runtime/dino-car-crunch-lesson";
import { classifierProposal } from "../helpers/runtime-classifier";
import { installLessonObserver, type LessonObserver } from "../helpers/lesson-observer";
import { installLocalSession, type LocalSessionWindow } from "../helpers/local-voice-session";
import { installSyntheticMicrophone } from "../helpers/synthetic-microphone";

type Microphone = Awaited<ReturnType<typeof installSyntheticMicrophone>>;
type Outcome = "correct" | "incorrect" | "unclear";

async function setup(page: Page, verdict: (transcript: string) => Outcome = () => "correct") {
  const microphone = await installSyntheticMicrophone(page);
  await installLocalSession(page);
  const observer = await installLessonObserver(page);
  await page.route("**/api/classify", route =>
    route.fulfill({
      json: {
        proposal: classifierProposal(route.request().postDataJSON(), {
          answerOutcome: verdict(String(route.request().postDataJSON()?.transcript ?? "")),
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
  await effectsSettled(page, observer);
  return page.locator(`[data-scene-id][data-node-id="${nodeId}"]`);
}

/** Arrival sounds open a mic-safe window that ignores the microphone. Like a child waiting for the tutor,
 * wait for any open effect window to close before speaking. The stage asks for the arrival sound within a
 * frame of the scene becoming active, so a short pause first lets that request land. */
async function effectsSettled(page: Page, observer: LessonObserver) {
  await page.waitForTimeout(200);
  await expect
    .poll(async () => {
      const events = (await observer.read())?.events ?? [];
      const last = events.filter(event => event.type === "effect.started" || event.type === "effect.ended").at(-1);
      return last?.type !== "effect.started";
    })
    .toBe(true);
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
    outcome === "correct" ? `Yes, ${text} cars!` : "Let's try again.",
  );
  if (outcome === "correct") {
    const stage = page.locator(`[data-node-id="${nodeId}"][data-scene-id]`);
    await expect(stage).toHaveAttribute("data-chomp", "idle");
  }
  await page.evaluate(() => {
    (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0;
  });
  await observer.waitForEvent("output.activity", { after: acknowledged, scope, detail: { state: "quiet" } });
  if (outcome === "correct") {
    const stage = page.locator(`[data-node-id="${nodeId}"][data-scene-id]`);
    await expect(stage).toHaveAttribute("data-chomp", "eating");
    await expect(stage.locator('[data-car][data-eaten="true"]')).toHaveCount(
      Number(DINO_CAR_CRUNCH_LESSON.nodes[nodeId].presentation.answer),
    );
  }
}

const counts = [
  { cars: 7, trucks: 0, loose: 3, arriving: 4 },
  { cars: 23, trucks: 2, loose: 3, arriving: 0 },
  { cars: 42, trucks: 4, loose: 2, arriving: 0 },
  { cars: 56, trucks: 5, loose: 6, arriving: 0 },
  { cars: 35, trucks: 3, loose: 5, arriving: 0 },
  { cars: 29, trucks: 2, loose: 9, arriving: 0 },
];

async function correct(page: Page, observer: LessonObserver, microphone: Microphone, nodeId: string) {
  await answer(page, observer, microphone, nodeId, String(DINO_CAR_CRUNCH_LESSON.nodes[nodeId].presentation.answer));
}

async function reach(page: Page, observer: LessonObserver, microphone: Microphone, index: number) {
  for (const nodeId of DINO_CAR_CRUNCH_NODE_IDS.slice(0, index)) {
    await scene(page, observer, nodeId);
    await correct(page, observer, microphone, nodeId);
  }
  return scene(page, observer, DINO_CAR_CRUNCH_NODE_IDS[index]);
}

test("full playthrough and replay", async ({ page }) => {
  test.setTimeout(180_000);
  const { microphone, observer } = await setup(page);
  await page.goto("/dinos");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  for (const [index, nodeId] of DINO_CAR_CRUNCH_NODE_IDS.entries()) {
    const stage = await scene(page, observer, nodeId);
    const expected = counts[index];
    await expect(stage).toHaveAttribute("data-rex", "hungry");
    await expect(stage.locator("[data-car]")).toHaveCount(expected.cars);
    await expect(stage.locator("[data-truck]")).toHaveCount(expected.trucks);
    for (const truck of await stage.locator("[data-truck]").all())
      await expect(truck.locator('[data-car][data-in="truck"]')).toHaveCount(10);
    await expect(stage.locator('[data-car][data-in="loose"]')).toHaveCount(expected.loose);
    await expect(stage.locator('[data-car][data-in="arriving"]')).toHaveCount(expected.arriving);
    await correct(page, observer, microphone, nodeId);
  }
  await expect(page.getByText("Rex is full! Thanks for counting the cars.")).toBeVisible();
  const finale = page.locator('[data-scene-id][data-node-id="complete"]');
  await expect(finale).toHaveAttribute("data-rex", "full");
  await expect(finale.locator("[data-car]")).toHaveCount(0);
  // Completing the lesson stops the session (closing the mic), so the finale sound plays without a window.
  await expect(finale).toHaveAttribute("data-finale-sound", "played");
  const events = (await observer.read())!.events;
  const starts = events.filter(event => event.type === "effect.started");
  expect(events.filter(event => event.type === "effect.overlapped_tutor")).toHaveLength(0);
  for (const [index, nodeId] of DINO_CAR_CRUNCH_NODE_IDS.entries()) {
    expect(
      starts.filter(
        event =>
          event.nodeId === nodeId &&
          (event.detail as { name: string }).name === (index === 0 ? "horn" : "truck-rumble"),
      ),
    ).toHaveLength(1);
    const crunch = events.findIndex(
      event =>
        event.nodeId === nodeId &&
        event.type === "effect.started" &&
        (event.detail as { name: string }).name === "crunch",
    );
    expect(
      starts.filter(event => event.nodeId === nodeId && (event.detail as { name: string }).name === "crunch"),
    ).toHaveLength(1);
    const acceptance = events.findIndex(
      event =>
        event.nodeId === nodeId &&
        event.type === "runtime.changed" &&
        (event.detail as { before: { answerAccepted: boolean }; after: { answerAccepted: boolean } }).before
          .answerAccepted === false &&
        (event.detail as { after: { answerAccepted: boolean } }).after.answerAccepted === true,
    );
    expect(acceptance).toBeGreaterThanOrEqual(0);
    expect(crunch).toBeGreaterThan(acceptance);
  }
  await page.getByRole("button", { name: "Play again", exact: true }).click();
  await expect((await scene(page, observer, "warm-up")).locator("[data-eaten]")).toHaveCount(0);
});

test("full-level microphone speech during crunch is ignored and input resumes", async ({ page }) => {
  const { microphone, observer } = await setup(page);
  await page.goto("/dinos");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await scene(page, observer, "warm-up");
  await correct(page, observer, microphone, "warm-up");
  const tracks = await page.evaluate(() =>
    (window as unknown as LocalSessionWindow).appSenders.map(sender => ({
      kind: sender.track?.kind,
      enabled: sender.track?.enabled,
    })),
  );
  expect(tracks.filter(track => track.kind === "audio")).not.toHaveLength(0);
  expect(tracks.filter(track => track.kind === "audio").every(track => !track.enabled)).toBe(true);
  // The page's own sound does not loop back into the mic in a headless browser, so play full-level speech into
  // the microphone during the window as the worst case. The provider cannot hear it: its input tracks are off.
  const playback = await microphone.playSpeech("counting");
  expect(await microphone.waitForPlayback(playback.id)).toBe("ended");
  await scene(page, observer, "twenty-three");
  const events = (await observer.read())!.events;
  const start = events.findIndex(
    event => event.type === "effect.started" && (event.detail as { name: string }).name === "crunch",
  );
  const end = events.findIndex(
    (event, index) =>
      index > start && event.type === "effect.ended" && (event.detail as { name: string }).name === "crunch",
  );
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const during = events.slice(start + 1, end);
  expect(during.some(event => event.type === "microphone.ignored_effect")).toBe(true);
  expect(during.filter(event => ["child.candidate.started", "child.turn.started"].includes(event.type))).toHaveLength(
    0,
  );
  expect(
    await page.evaluate(() =>
      (window as unknown as LocalSessionWindow).appSenders
        .filter(sender => sender.track?.kind === "audio")
        .every(sender => sender.track!.enabled),
    ),
  ).toBe(true);
  await correct(page, observer, microphone, "twenty-three");
  await scene(page, observer, "forty-two");
});

test("direct load, reload, identity and diagnostics", async ({ page }) => {
  const { observer } = await setup(page);
  await page.goto("/dinos?debug=1");
  await expect(page).toHaveTitle("Dino Car Crunch");
  await page.reload();
  const request = page.waitForRequest(request => request.url().endsWith("/api/live") && request.method() === "POST");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const liveRequest = await request;
  expect(liveRequest.postDataJSON().lessonId).toBe("dino-car-crunch");
  await (await liveRequest.response())!.finished();
  await scene(page, observer, "warm-up");
  const download = page.waitForEvent("download");
  await page
    .getByRole("complementary", { name: "Developer diagnostics" })
    .getByRole("button", { name: "Export diagnostics" })
    .click();
  const report = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  expect(report.lessonId ?? report.runtime?.lessonId).toBe("dino-car-crunch");
});

test("wrong and unclear answers never eat cars", async ({ page }) => {
  test.setTimeout(180_000);
  // Judge by what the child actually said most recently, like the real classifier. A shared mutable verdict
  // races with background re-checks (e.g. after a help request) and could accept "I need help" as correct.
  const latest = (transcript: string, words: readonly string[]) =>
    Math.max(...words.map(word => transcript.lastIndexOf(word)));
  const { microphone, observer } = await setup(page, transcript => {
    const right = latest(transcript, ["56", "fifty-six"]);
    const wrong = latest(transcript, ["eleven"]);
    const help = latest(transcript, ["I need help"]);
    if (right < 0 && wrong < 0 && help < 0) return "correct";
    return right > Math.max(wrong, help) ? "correct" : wrong > help ? "incorrect" : "unclear";
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dinos");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const stage = await reach(page, observer, microphone, 3);
  for (const [text, outcome] of [
    ["eleven", "incorrect"],
    ["I need help", "unclear"],
  ] as const) {
    await answer(page, observer, microphone, "fifty-six", text, outcome);
    await expect(stage).toHaveAttribute("data-rex", "hungry");
    await expect(stage.locator("[data-eaten]")).toHaveCount(0);
    await scene(page, observer, "fifty-six");
    expect(
      (await observer.read())!.events.filter(
        event =>
          event.nodeId === "fifty-six" &&
          event.type === "effect.started" &&
          (event.detail as { name: string }).name === "crunch",
      ),
    ).toHaveLength(0);
  }
  await correct(page, observer, microphone, "fifty-six");
  await scene(page, observer, "thirty-five");
});

test("phone layout without overlap", async ({ page }) => {
  test.setTimeout(180_000);
  const { microphone, observer } = await setup(page);
  await page.goto("/dinos");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  for (const index of [3, 5]) {
    if (index === 3) await reach(page, observer, microphone, index);
    else
      for (const nodeId of DINO_CAR_CRUNCH_NODE_IDS.slice(3, 5)) {
        await scene(page, observer, nodeId);
        await correct(page, observer, microphone, nodeId);
      }
    const stage = await scene(page, observer, DINO_CAR_CRUNCH_NODE_IDS[index]);
    await stage.evaluate(element =>
      Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)),
    );
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      const geometry = await stage.evaluate(element => {
        const rect = (el: Element) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width };
        };
        const loose = element.querySelector('[data-in="loose"]')!.parentElement!;
        return {
          stage: rect(element),
          items: [
            element.querySelector('img[data-shown="true"]')!,
            ...element.querySelectorAll("[data-truck]"),
            loose,
          ].map(rect),
          cars: [...loose.querySelectorAll("[data-car]")].map(rect),
          overlays: [...document.querySelectorAll("button"), ...document.querySelectorAll('[role="status"]')]
            .map(el => (el.getAttribute("role") === "status" ? el.parentElement! : el))
            .filter(el => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            })
            .map(rect),
        };
      });
      const intersects = (a: typeof geometry.stage, b: typeof geometry.stage) =>
        a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
      for (const [i, item] of geometry.items.entries()) {
        expect(item.x).toBeGreaterThanOrEqual(geometry.stage.x);
        expect(item.y).toBeGreaterThanOrEqual(geometry.stage.y);
        expect(item.right).toBeLessThanOrEqual(geometry.stage.right);
        expect(item.bottom).toBeLessThanOrEqual(geometry.stage.bottom);
        for (const other of geometry.items.slice(i + 1)) expect(intersects(item, other)).toBe(false);
        for (const overlay of geometry.overlays) expect(intersects(item, overlay)).toBe(false);
      }
      for (const car of geometry.cars) expect(car.width).toBeGreaterThanOrEqual(24);
    }
  }
});

test("Stop and Play again from every scene", async ({ page }) => {
  test.setTimeout(300_000);
  const { microphone, observer } = await setup(page);
  await page.goto("/dinos");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  for (const [index] of DINO_CAR_CRUNCH_NODE_IDS.entries()) {
    await reach(page, observer, microphone, index);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await page.getByRole("button", { name: "Play", exact: true }).click();
    const stage = await scene(page, observer, "warm-up");
    await expect(stage.locator("[data-eaten]")).toHaveCount(0);
  }
});
