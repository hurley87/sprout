import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { installLocalSession, type LocalSessionWindow } from "../helpers/local-voice-session";
import { installSyntheticMicrophone } from "../helpers/synthetic-microphone";
import type { LessonObservationWindow } from "../../lib/lesson-runtime/browser-observation";
import {
  parseMathInterpretationOutput,
  type MathInterpretationInput,
} from "../../lib/calculus/math-interpretation-contract";
import { getCalculusReviewKey } from "../../lib/calculus/problems";

const chainDictation =
  "my derivative is thirty x times open parenthesis three x squared plus one close parenthesis to the fourth power";
const current = (page: Page) =>
  page.evaluate(() => (window as LessonObservationWindow).sproutLessonObservation?.read()?.snapshot);
async function ready(page: Page, id: string) {
  await expect(page.locator(`[data-node-id="${id}"]`)).toBeVisible();
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
}
async function setup(page: Page) {
  const microphone = await installSyntheticMicrophone(page);
  await installLocalSession(page);
  await page.route("**/api/math-action", async route => {
    const input: MathInterpretationInput = route.request().postDataJSON();
    const turn = input.learnerTurns.at(-1)!;
    const sources = [{ turnId: turn.id, quote: turn.text }];
    const expression = turn.text.includes("wrong derivative is seven")
      ? { op: "number", value: 7 }
      : (input.identity.problemId === "cubic-minus-linear" && turn.text.includes("three x squared minus four")) ||
          (input.identity.problemId === "composite-fifth" && turn.text === chainDictation)
        ? getCalculusReviewKey(input.identity.problemId).finalForms[0]
        : null;
    const action = turn.text.includes("strategy")
      ? { kind: "strategy", method: "power", sources }
      : turn.text.includes("missing")
        ? { kind: "clarify", reason: "missing-operand", sources }
        : turn.text.includes("undo")
          ? { kind: "undo", targetStepId: input.latestUndoableStepId, sources }
          : expression
            ? turn.text.includes("replace")
              ? { kind: "replace", targetStepId: input.board[0].id, expression, sources }
              : { kind: "append", expression, sources }
            : { kind: "clarify", reason: "ambiguous", sources };
    await route.fulfill({ json: parseMathInterpretationOutput({ actions: [action] }, input) });
  });
  await page.goto("/demos/calculus?debug=1");
  await microphone.loadSpeech("answer-three");
  await page.getByRole("button", { name: "Start practice" }).click();
  await ready(page, "cubic-minus-linear");
  const say = async (text: string) => {
    const playback = await microphone.playSpeech("answer-three");
    await expect.poll(async () => (await current(page))?.runtime?.childSpeaking).toBe(true);
    await page.evaluate(
      text => (window as unknown as LocalSessionWindow).sendTranscript("session.input_transcript.delta", text),
      text,
    );
    await microphone.waitForPlayback(playback.id);
    await expect.poll(async () => (await current(page))?.runtime?.childSpeaking).toBe(false);
  };
  const pending = async () => {
    await expect(page.getByRole("heading", { name: "Proposed actions — awaiting your confirmation" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm displayed actions" })).toBeEnabled();
  };
  return { microphone, say, pending };
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

test("initial prompt, strict debug opt-in and narrow layout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const flag of ["", "?debug=true", "?debug=1&debug=0"]) {
    await page.goto(`/demos/calculus${flag}`);
    await expect(page.getByRole("heading", { name: "Calculus practice", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Current problem" })).toContainText("x^3 - 4x");
    await expect(page.getByText("Session details", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Proposed actions — awaiting your confirmation")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("mocked voice: visible wrong step, spoken confirmation, replace/undo fallback, help and all prompts", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const { microphone, say, pending } = await setup(page);
  await say("repeat");
  await expect
    .poll(() => page.evaluate(() => (window as unknown as LocalSessionWindow).steeringContents.at(-1)))
    .toContain("Repeat only the current prompt");
  await ready(page, "cubic-minus-linear");
  await say("help");
  await expect
    .poll(async () => (await current(page))?.math?.current?.sourceEvents.some(e => e.kind === "hint"))
    .toBe(true);
  await ready(page, "cubic-minus-linear");
  await say("My wrong derivative is seven.");
  await pending();
  expect((await current(page))?.math?.current?.steps).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath("calculus-desktop-proposal.png"), fullPage: true });
  await say("confirm differentiation");
  await expect.poll(async () => (await current(page))?.math?.current?.steps.length).toBe(1);
  await expect(page.getByRole("region", { name: "Mathematical work" })).toContainText("Incorrect");
  await say("replace that with three x squared minus four");
  await pending();
  await page.getByRole("combobox").selectOption("differentiate");
  await page.evaluate(() => {
    (window as unknown as LocalSessionWindow).currentPeer.level.gain.value = 0.15;
  });
  await expect.poll(async () => (await current(page))?.runtime?.outputActivity).toBe("active");
  await page.getByRole("button", { name: "Confirm displayed actions" }).click();
  await expect.poll(async () => (await current(page))?.math?.current?.identity.baseBoardRevision).toBe(2);
  expect((await current(page))?.runtime?.outputActivity).toBe("active");
  await expect(page.getByRole("region", { name: "Mathematical work" })).toContainText("Correction replaces");
  await ready(page, "cubic-minus-linear");
  await say("undo the last edit");
  await pending();
  await say("confirm without checking");
  await expect.poll(async () => (await current(page))?.math?.current?.identity.baseBoardRevision).toBe(3);
  await ready(page, "cubic-minus-linear");
  await expect(page.getByRole("button", { name: "Help", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await expect
    .poll(async () => (await current(page))?.math?.current?.sourceEvents.some(e => e.kind === "hint"))
    .toBe(true);
  await ready(page, "cubic-minus-linear");
  await page.getByRole("button", { name: "Skip problem" }).click();
  await ready(page, "quadratic-sine");
  await expect(page.getByRole("region", { name: "Current problem" })).toContainText("x^2 sin(x)");
  await say("My strategy is the power rule");
  await pending();
  await say("confirm without checking");
  expect((await current(page))?.math?.current?.steps).toHaveLength(0);
  await say("missing operand three x to the");
  await pending();
  await page.getByRole("button", { name: "Confirm displayed actions" }).click();
  expect((await current(page))?.math?.current?.steps).toHaveLength(0);
  await expect(page.getByRole("region", { name: "Mathematical work" })).toContainText(
    "Part of the expression is missing",
  );
  await ready(page, "quadratic-sine");
  await say("next");
  await ready(page, "composite-fifth");
  await expect(page.getByRole("region", { name: "Current problem" })).toContainText("(3x^2 + 1)^5");
  await say(chainDictation);
  await pending();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("calculus-narrow-proposal.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await say("stop");
  await expect.poll(async () => (await current(page))?.status).toBe("ended");
  expect((await current(page))?.math?.pending).toBeNull();
  await expect.poll(async () => (await microphone.state()).trackStates.filter(t => t === "live").length).toBe(1);
});

for (const exit of ["hide", "unmount"] as const)
  test(`releases microphone tracks on ${exit}`, async ({ page }) => {
    const { microphone } = await setup(page);
    if (exit === "hide")
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
    else await page.getByRole("link", { name: "Back to home" }).click();
    if (exit === "hide") {
      await expect.poll(async () => (await current(page))?.status).toBe("ended");
      await expect.poll(async () => (await microphone.state()).trackStates.filter(t => t === "live").length).toBe(1);
    } else {
      await expect(page).toHaveURL("/");
      await expect.poll(async () => (await microphone.state()).trackStates.filter(t => t === "live").length).toBe(1);
    }
  });

test("spoken problem navigation, natural completion and stopped labels stay distinct", async ({ page }) => {
  const { microphone, say } = await setup(page);
  await say('she said "next"');
  await expect(page.getByRole("region", { name: "Current problem" })).toContainText("Problem 1 of 3");
  await ready(page, "cubic-minus-linear");
  await say("skip this problem");
  await ready(page, "quadratic-sine");
  await say("next problem");
  await ready(page, "composite-fifth");
  await say("next");
  await ready(page, "recap");
  const recap = (await current(page))!.recapText!;
  await page.evaluate(
    text => (window as unknown as LocalSessionWindow).sendTranscript("session.output_transcript.delta", text),
    recap,
  );
  await expect.poll(async () => (await current(page))?.status).toBe("ended");
  await expect(page.getByText("Practice finished.", { exact: true })).toBeVisible();
  await expect(page.getByText("Session stopped. Your recorded work is retained.", { exact: true })).toHaveCount(0);
  await expect.poll(async () => (await microphone.state()).trackStates.filter(t => t === "live").length).toBe(1);
});

test("late mocked extraction after Stop cannot create pending work", async ({ page }) => {
  const { say } = await setup(page);
  await page.unroute("**/api/math-action");
  let release!: () => void;
  let requested = false;
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route("**/api/math-action", async route => {
    const input: MathInterpretationInput = route.request().postDataJSON();
    const turn = input.learnerTurns.at(-1)!;
    requested = true;
    await held;
    await route
      .fulfill({
        json: parseMathInterpretationOutput(
          {
            actions: [
              {
                kind: "append",
                expression: { op: "number", value: 7 },
                sources: [{ turnId: turn.id, quote: turn.text }],
              },
            ],
          },
          input,
        ),
      })
      .catch(() => {});
  });
  await say("my derivative is seven");
  await expect.poll(() => requested).toBe(true);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  release();
  await expect.poll(async () => (await current(page))?.math?.disposition).toBe("idle");
  expect((await current(page))?.math?.current?.steps).toHaveLength(0);
  await expect(page.getByRole("heading", { name: "Proposed actions — awaiting your confirmation" })).toHaveCount(0);
});

test("debug export retains spoken confirmation identity, operation and transcript provenance", async ({ page }) => {
  const { say, pending } = await setup(page);
  await say("my derivative is three x squared minus four");
  await pending();
  const proposal = (await current(page))!.math!.pending!;
  await say("confirm differentiation");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByText("Session details", { exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export session", exact: true }).click();
  const download = await downloading;
  const report = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(download.suggestedFilename()).toMatch(/^sprout-calculus-/);
  expect(report.mathConfirmations[0]).toMatchObject({
    id: proposal.id,
    boardRevision: proposal.boardRevision,
    text: "confirm differentiation",
    operations: ["differentiate"],
  });
  expect(report.mathConfirmations[0].fragments[0]).toMatchObject({
    event: { speaker: "child", delta: "confirm differentiation" },
  });
  expect(report.math.current.steps).toHaveLength(1);
  expect(JSON.stringify(report)).not.toMatch(/api_key|access_token|authorization|"sdp"/i);
  await page.goto("/demos/calculus");
  await expect(page.getByText("Session details", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export session" })).toHaveCount(0);
});
