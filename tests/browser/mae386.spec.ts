import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { installLocalSession, type LocalSessionWindow } from "../helpers/local-voice-session";
import { installSyntheticMicrophone } from "../helpers/synthetic-microphone";
import type { LessonObservationWindow } from "../../lib/lesson-runtime/browser-observation";
import { MAE386_LESSON } from "../../lib/lesson-runtime/mae386-lesson";

const current = (page: Page) =>
  page.evaluate(() => (window as LessonObservationWindow).sproutLessonObservation?.read()?.snapshot);
async function waitNode(page: Page, nodeId: string) {
  await expect(page.locator(`[data-node-id="${nodeId}"]`)).toBeVisible();
  await expect.poll(async () => (await current(page))?.status).toBe("live");
  await expect.poll(async () => (await current(page))?.awaitingSteering).toBe(false);
  if (nodeId === "recap") return;
  // Each new node requires fresh locally observed playback, as a real spoken
  // question would provide. Silence from a previous node grants no authority.
  await page.evaluate(() => {
    (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0.15;
  });
  await expect.poll(async () => (await current(page))?.runtime?.outputActivity).toBe("active");
  await page.evaluate(() => {
    (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0;
  });
  await expect.poll(async () => (await current(page))?.runtime?.outputActivity).toBe("quiet");
}
async function downloadReport(page: Page) {
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download diagnostics", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^sprout-mae386-/);
  return JSON.parse(await readFile((await download.path())!, "utf8"));
}

test.afterEach(async ({ page }) => {
  if (page.isClosed()) return;
  await page.evaluate(`(async () => {
    for (const source of window.peers ?? []) {
      source.peer.close(); source.tone.stop(); source.destination.stream.getTracks().forEach(track => track.stop());
    }
    if (window.peerContext && window.peerContext.state !== "closed") await window.peerContext.close();
    await window.syntheticMicrophone?.dispose();
  })()`);
});

test("route opts into debug explicitly and stays readable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const flag of ["", "?debug=true", "?debug=1&debug=0"]) {
    await page.goto(`/demos/mae386${flag}`);
    await expect(page.getByRole("heading", { name: "MAE386 spoken practice" })).toBeVisible();
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "Question 1 of 8");
    await expect(page.getByRole("progressbar").locator(":scope > div")).toHaveCount(8);
    await expect(page.getByText("Session details", { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.goto("/demos/mae386?debug=1");
  await page.getByText("Session details", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Export session" })).toBeDisabled();
});

test("current Q10/Q5 parts stay grouped; support controls, Stop and late assessment preserve frozen claims", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const microphone = await installSyntheticMicrophone(page);
  await installLocalSession(page);
  let releaseAssessment!: () => void;
  const assessmentHeld = new Promise<void>(resolve => {
    releaseAssessment = resolve;
  });
  let assessmentStarted = false;
  await page.route("**/api/assess", async route => {
    assessmentStarted = true;
    await assessmentHeld;
    await route.fulfill({ status: 503, json: { error: "Fixture late assessment" } });
  });
  await page.goto("/demos/mae386?debug=1");
  await page.getByRole("button", { name: "Start practice" }).click();
  await waitNode(page, "q1");
  await expect(page.getByRole("status")).toHaveText("live");
  await expect(page.getByRole("button", { name: "Repeat question" })).toBeEnabled();
  await page.getByRole("button", { name: "Repeat question" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as LocalSessionWindow).steeringContents.at(-1)))
    .toContain("Repeat only the current prompt");
  await expect(page.getByRole("button", { name: "Help", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as LocalSessionWindow).steeringContents.at(-1)))
    .toContain("explicitly requested help");
  expect((await current(page))?.runtime?.conceptEvidence).toEqual({});
  // Ordinary UI skip follows the same gated authored transition as speech.
  for (const next of ["q6", "q8", "q10-1"]) {
    await expect(page.getByRole("button", { name: "Skip question", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Skip question", exact: true }).click();
    await waitNode(page, next);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [index, id] of ["q10-1", "q10-2", "q10-3"].entries()) {
    await waitNode(page, id);
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "Question 4 of 8");
    await expect(page.getByRole("region", { name: "Current question" })).toContainText(`Sentence ${index + 1} of 3`);
    await expect(page.locator("blockquote")).toHaveText(String(MAE386_LESSON.nodes[id].presentation.sourceText));
    await expect(page.getByRole("button", { name: "Skip this part" })).toBeEnabled();
    if (index === 2) await page.screenshot({ path: testInfo.outputPath("q10-original-mobile.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Skip this part" }).click();
  }
  await waitNode(page, "q5-a");
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "Question 5 of 8");
  await expect(page.locator("blockquote")).toHaveText(String(MAE386_LESSON.nodes["q5-a"].presentation.sourceText));
  await expect(page.getByRole("button", { name: "Skip this part" })).toBeEnabled();
  await page.getByRole("button", { name: "Skip this part" }).click();
  await waitNode(page, "q5-c");
  await expect(page.locator("blockquote")).toHaveText(String(MAE386_LESSON.nodes["q5-c"].presentation.sourceText));
  // A tutor question creates conversation context for the secondary assessment.
  await page.evaluate(() =>
    (window as unknown as LocalSessionWindow).sendTranscript(
      "session.output_transcript.delta",
      "Would you like to explain your reasoning?",
    ),
  );
  await expect.poll(async () => (await current(page))?.transcript).toContain("reasoning");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Session ended early" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Question outcomes" }).locator("h3")).toHaveCount(8);
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "4");
  await expect.poll(() => assessmentStarted).toBe(true);
  await expect
    .poll(async () => (await microphone.state()).trackStates.filter(track => track === "live").length)
    .toBe(1);
  const frozen = (await current(page))?.questionOutcomes;
  const before = await page.getByRole("region", { name: "Question outcomes" }).innerText();
  releaseAssessment();
  await expect.poll(async () => (await current(page))?.assessment?.status).toBe("unavailable");
  expect((await current(page))?.questionOutcomes).toEqual(frozen);
  expect(await page.getByRole("region", { name: "Question outcomes" }).innerText()).toBe(before);
  await page.screenshot({ path: testInfo.outputPath("early-stop-recap-mobile.png"), fullPage: true });
  const report = await downloadReport(page);
  expect(report.lesson.id).toBe("mae386");
  expect(report.questionOutcomes).toEqual(frozen);
  expect(report.questionRecap.label).toBe("Session ended early");
  expect(report.questionRecap.questions).toEqual(frozen?.questions);
  expect(JSON.stringify(report)).not.toMatch(/api_key|access_token|authorization|"sdp"/i);
  await page.getByRole("button", { name: "Start practice" }).click();
  await waitNode(page, "q1");
  await expect(page.getByRole("region", { name: "Question outcomes" })).toHaveCount(0);
  expect((await current(page))?.runtime?.runtimeId).not.toBe(frozen?.runtimeId);
});

test("natural recap renders all eight frozen questions and speaks the same snapshot", async ({ page }) => {
  test.setTimeout(90_000);
  await installSyntheticMicrophone(page);
  await installLocalSession(page);
  await page.goto("/demos/mae386");
  await page.getByRole("button", { name: "Start practice" }).click();
  for (const id of ["q1", "q6", "q8", "q10-1", "q5-a", "q12", "q14", "q15"]) {
    await waitNode(page, id);
    const skip = page.getByRole("button", {
      name: id.includes("-") ? "Skip whole question" : "Skip question",
      exact: true,
    });
    await expect(skip).toBeEnabled();
    await skip.click();
  }
  await waitNode(page, "recap");
  await expect(page.getByRole("heading", { name: "Practice recap", exact: true })).toBeVisible();
  const snapshot = await current(page);
  expect(snapshot?.questionOutcomes?.questions).toHaveLength(8);
  expect(snapshot?.questionOutcomes?.questions.every(q => q.outcome === "skipped")).toBe(true);
  const spoken = snapshot!.questionRecap!.spoken;
  const appends = await page.evaluate(() => (window as unknown as LocalSessionWindow).steeringContents);
  expect(appends.at(-1)).toContain(JSON.stringify(spoken));
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "8");
  await page.evaluate(text => {
    const browser = window as unknown as LocalSessionWindow;
    browser.currentPeer.level.gain.value = 0.15;
    browser.sendTranscript("session.output_transcript.delta", text);
  }, spoken);
  await expect.poll(async () => (await current(page))?.runtime?.outputActivity).toBe("active");
  await page.evaluate(() => {
    (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0;
  });
  await expect(page.getByRole("status")).toHaveText("Session complete");
  await expect(page.getByRole("button", { name: "Restart practice" })).toBeEnabled();
  const report = await downloadReport(page);
  expect(report.questionOutcomes).toEqual(snapshot?.questionOutcomes);
  expect(report.questionRecap.label).toBe("Practice recap");
  await expect(page.getByRole("region", { name: "Question outcomes" }).locator("h3")).toHaveCount(8);
});

for (const request of ["help", "repeat"] as const) {
  test(`spoken Stop releases actual browser media while ${request} acknowledgment is withheld`, async ({ page }) => {
    const microphone = await installSyntheticMicrophone(page);
    await installLocalSession(page);
    await page.goto("/demos/mae386");
    await microphone.loadSpeech("answer-three");
    await page.getByRole("button", { name: "Start practice" }).click();
    await waitNode(page, "q1");
    const button = page.getByRole("button", { name: request === "help" ? "Help" : "Repeat question", exact: true });
    await expect(button).toBeEnabled();
    await page.evaluate(() => {
      (window as unknown as LocalSessionWindow).holdSupportAck = true;
    });
    await button.click();
    await expect.poll(async () => (await current(page))?.awaitingSteering).toBe(true);
    await page.evaluate(() => {
      (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0.15;
    });
    const playback = await microphone.playSpeech("answer-three");
    await expect.poll(async () => (await current(page))?.runtime?.childSpeaking).toBe(true);
    await page.evaluate(() => {
      const browser = window as unknown as LocalSessionWindow;
      browser.sendTranscript("session.input_transcript.delta", "St");
      browser.sendTranscript("session.input_transcript.delta", "op.");
    });
    await microphone.waitForPlayback(playback.id);
    await expect(page.getByRole("heading", { name: "Session ended early", exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as unknown as LocalSessionWindow).appPeerCloseCount)).toBe(1);
    await expect
      .poll(async () => (await microphone.state()).trackStates.filter(state => state === "live").length)
      .toBe(1);
    expect((await current(page))?.error).toBeNull();
    expect((await current(page))?.questionOutcomes?.questions).toHaveLength(8);
  });
}
