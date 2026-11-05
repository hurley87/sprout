import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { readAlgebraLatex } from "../../lib/math-audit/latex";
import type { LessonObservationWindow } from "../../lib/lesson-runtime/browser-observation";
import { installLocalSession, type LocalSessionWindow } from "../helpers/local-voice-session";
import { installSyntheticMicrophone } from "../helpers/synthetic-microphone";

const current = (page: Page) =>
  page.evaluate(() => (window as LessonObservationWindow).sproutLessonObservation?.read()?.snapshot);

for (const width of [375, 1440]) {
  test(`difference quotient shows the original nested expression at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/demos/math-steps/difference-quotient");
    const problem = page.getByRole("region", { name: "Current problem" });
    await expect(problem).toContainText("Simplify the following expression, where h ≠ 0.");
    await expect(problem.locator(".katex-html .mfrac .mfrac").first()).toBeVisible();
    await expect(problem).toContainText("Required:");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("voice proposal, localized check, actions and microphone stop on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const microphone = await installSyntheticMicrophone(page);
  await installLocalSession(page);
  const parsed = readAlgebraLatex(String.raw`\frac{6xy-5y^2}{4x+10y}\cdot\frac{12+30y}{12x^2-10xy}`);
  if (!parsed.ok) throw new Error(parsed.reason);
  await page.route("**/api/math-scribe", route =>
    route.fulfill({
      json: {
        status: "ok",
        interpretations: [
          {
            intent: "propose",
            operation: { kind: "replace-line", expression: parsed.expression },
            source: "report",
            quote: "flip with twelve plus thirty y",
          },
        ],
      },
    }),
  );
  await page.goto("/demos/math-steps?debug=1");
  await expect(page.getByRole("region", { name: "Current problem" }).locator(".katex")).toBeVisible();
  await microphone.loadSpeech("answer-three");
  await page.getByRole("button", { name: "Start practice" }).click();
  await expect.poll(async () => (await current(page))?.status).toBe("live");
  await expect.poll(async () => (await current(page))?.awaitingSteering).toBe(false);
  await page.evaluate(() => {
    (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0.15;
  });
  await expect.poll(async () => (await current(page))?.runtime?.outputActivity).toBe("active");
  await page.evaluate(() => {
    (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0;
  });
  await expect.poll(async () => (await current(page))?.runtime?.outputActivity).toBe("quiet");
  const playback = await microphone.playSpeech("answer-three");
  await expect.poll(async () => (await current(page))?.runtime?.childSpeaking).toBe(true);
  await page.evaluate(() =>
    (window as unknown as LocalSessionWindow).sendTranscript(
      "session.input_transcript.delta",
      "flip with twelve plus thirty y",
    ),
  );
  await microphone.waitForPlayback(playback.id);
  const proposal = page.getByRole("region", { name: "Working" });
  await expect(proposal).toContainText("Not checked yet");
  await expect(page.getByLabel("Voice controls")).toContainText("flip with twelve plus thirty y");
  await expect(page.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(proposal).toContainText("Doesn't follow — look at the reciprocal numerator");
  await expect(proposal).not.toContainText("12x+30y");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(proposal).toContainText("Tap the mic and tell Sprout your first step");
  await page.getByText("Session details").click();
  await expect(page.getByText("Session metrics")).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export session" }).click();
  const download = await downloadEvent;
  const report = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(report.scribe.visits[0].metrics.checks["not-equivalent"]).toBe(1);
  expect(JSON.stringify(report)).toContain("flip with twelve plus thirty y");
  expect(JSON.stringify(report)).not.toMatch(/api_key|access_token|authorization|"sdp"/i);
  await page.getByRole("button", { name: "End session" }).click();
  await expect
    .poll(async () => (await microphone.state()).trackStates.filter(state => state === "live").length)
    .toBe(1);
  expect((await microphone.state()).trackStates).toContain("ended");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
