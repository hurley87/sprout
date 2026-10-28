import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { installLocalSession, type LocalSessionWindow } from "../helpers/local-voice-session";
import { installSyntheticMicrophone } from "../helpers/synthetic-microphone";
import type { LessonObservationWindow } from "../../lib/lesson-runtime/browser-observation";
import type { MathExpression as E } from "../../lib/calculus/math-expression";
import type { WorkExtraction, WorkExtractionInput } from "../../lib/calculus/work-extraction";

const x: E = { op: "variable", name: "x" };
const n = (value: number): E => ({ op: "number", value });
const pow = (base: E, exponent: number): E => ({ op: "power", base, exponent });
const mul = (...args: E[]): E => ({ op: "multiply", args });
const add = (...args: E[]): E => ({ op: "add", args });
const sin: E = { op: "sin", argument: x };
const cos: E = { op: "cos", argument: x };
const inner = add(mul(n(3), pow(x, 2)), n(1));
type Item = { stepId: string; expression?: E; method?: string } | { final: E };
// Stand-in for the model: each phrase the learner says maps to one step or the final answer.
const PHRASES: Record<string, [string, Item][]> = {
  "cubic-minus-linear": [
    ["three x cubed", { stepId: "d-cubic", expression: mul(n(3), pow(x, 3)) }],
    ["three x squared", { stepId: "d-cubic", expression: mul(n(3), pow(x, 2)) }],
    ["four x becomes four", { stepId: "d-linear", expression: n(4) }],
    ["final answer three x squared minus four", { final: { op: "subtract", left: mul(n(3), pow(x, 2)), right: n(4) } }],
  ],
  "quadratic-sine": [
    ["product rule", { stepId: "method", method: "product" }],
    ["x squared gives two x", { stepId: "d-square", expression: mul(n(2), x) }],
    ["sine gives cosine", { stepId: "d-sine", expression: cos }],
    ["final answer two x sine x plus x squared cosine x", { final: add(mul(n(2), x, sin), mul(pow(x, 2), cos)) }],
  ],
  "composite-fifth": [
    ["product rule", { stepId: "method", method: "product" }],
    ["chain rule", { stepId: "method", method: "chain" }],
    ["outside gives five times the inside to the fourth", { stepId: "d-outer", expression: mul(n(5), pow(inner, 4)) }],
    ["inside gives six x", { stepId: "d-inner", expression: mul(n(6), x) }],
    ["final answer thirty x times the inside to the fourth", { final: mul(n(30), x, pow(inner, 4)) }],
  ],
};
const WRONG = new Set(["three x cubed", "product rule"]);
const SOLUTIONS: Record<string, string[]> = Object.fromEntries(
  Object.entries(PHRASES).map(([id, phrases]) => [
    id,
    phrases.map(([phrase]) => phrase).filter(phrase => !WRONG.has(phrase) || id === "quadratic-sine"),
  ]),
);
function extract(input: WorkExtractionInput): WorkExtraction {
  const extraction: { steps: WorkExtraction["steps"][number][]; final: WorkExtraction["final"] } = {
    steps: [],
    final: null,
  };
  for (const turn of input.learnerTurns)
    for (const [phrase, item] of PHRASES[input.problemId])
      if (turn.text.includes(phrase) && !(phrase === "three x squared" && turn.text.includes("final answer"))) {
        if ("final" in item) extraction.final = { expression: item.final, quote: phrase };
        else
          extraction.steps.push({
            stepId: item.stepId,
            expression: item.expression ?? null,
            method: (item.method ?? null) as never,
            quote: phrase,
          });
      }
  return { ...extraction, unclear: null };
}

const current = (page: Page) =>
  page.evaluate(() => (window as LessonObservationWindow).sproutLessonObservation?.read()?.snapshot);
const steering = (page: Page) =>
  page.evaluate(() => (window as unknown as LocalSessionWindow).steeringContents.at(-1) ?? "");
const statusOf = (page: Page, step: string) =>
  page.getByRole("region", { name: "Your work" }).locator(`[data-step="${step}"]`);
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
  await page.route("**/api/calculus-work", async route => {
    await route.fulfill({ json: { status: "ok", extraction: extract(route.request().postDataJSON()) } });
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
  return { microphone, say };
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
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("mocked voice: step checks, targeted feedback, required work and automatic next problem", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const { microphone, say } = await setup(page);
  await say("repeat");
  await expect.poll(() => steering(page)).toContain("Repeat only the current prompt");
  await ready(page, "cubic-minus-linear");
  await say("help");
  await expect.poll(async () => (await current(page))?.math?.visits[0].help).toBe(1);
  await ready(page, "cubic-minus-linear");
  // A wrong step is marked and the tutor is pointed at it, without its answer.
  await say("for x cubed I get three x cubed");
  await expect(statusOf(page, "d-cubic")).toHaveAttribute("data-status", "incorrect");
  await expect.poll(() => steering(page)).toContain('step "Derivative of x³"');
  expect(await steering(page)).toContain("Do not give the correct expression");
  await page.screenshot({ path: testInfo.outputPath("calculus-desktop-incorrect.png"), fullPage: true });
  await ready(page, "cubic-minus-linear");
  await say("sorry, three x squared");
  await expect(statusOf(page, "d-cubic")).toHaveAttribute("data-status", "correct");
  await ready(page, "cubic-minus-linear");
  // A correct final answer alone does not finish the problem.
  await say("so my final answer three x squared minus four");
  await expect(statusOf(page, "final")).toHaveAttribute("data-status", "correct");
  await expect.poll(() => steering(page)).toContain('have not yet shown: "Derivative of the 4x term"');
  await ready(page, "cubic-minus-linear");
  expect((await current(page))?.runtime?.nodeId).toBe("cubic-minus-linear");
  await say("four x becomes four");
  await expect(page.getByText("Every step checks out.")).toBeVisible();
  await ready(page, "quadratic-sine");
  await expect(page.getByRole("region", { name: "Current problem" })).toContainText("x^2 sin(x)");
  await expect(statusOf(page, "method")).toHaveAttribute("data-status", "missing");
  await page.getByRole("button", { name: "Skip problem" }).click();
  await ready(page, "composite-fifth");
  await say("I'd use the product rule here");
  await expect(statusOf(page, "method")).toHaveAttribute("data-status", "incorrect");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("calculus-narrow-work.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await ready(page, "composite-fifth");
  await say("stop");
  await expect.poll(async () => (await current(page))?.status).toBe("ended");
  expect((await current(page))?.math?.visits.map(visit => visit.outcome)).toEqual(["completed", "skipped", "stopped"]);
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
  await expect(page.getByText("Session stopped. Your work so far is shown above.", { exact: true })).toHaveCount(0);
  await expect.poll(async () => (await microphone.state()).trackStates.filter(t => t === "live").length).toBe(1);
});

test("a check that returns after Stop cannot change the work", async ({ page }) => {
  const { say } = await setup(page);
  await page.unroute("**/api/calculus-work");
  let release!: () => void;
  let requested = false;
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route("**/api/calculus-work", async route => {
    requested = true;
    await held;
    await route
      .fulfill({ json: { status: "ok", extraction: extract(route.request().postDataJSON()) } })
      .catch(() => {});
  });
  await say("three x squared");
  await expect.poll(() => requested).toBe(true);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  release();
  await expect.poll(async () => (await current(page))?.math?.checking).toBe(false);
  expect((await current(page))?.math?.visits[0].work.steps[0].status).toBe("missing");
});

test("synthetic local WebRTC: all three problems worked aloud, exported with every check", async ({ page }) => {
  test.setTimeout(180_000);
  const { say } = await setup(page);
  const problems = ["cubic-minus-linear", "quadratic-sine", "composite-fifth"];
  for (const id of problems) {
    await ready(page, id);
    for (const phrase of SOLUTIONS[id]) {
      await say(phrase);
      await expect.poll(async () => (await current(page))?.math?.checking).toBe(false);
      if (phrase !== SOLUTIONS[id].at(-1)) await ready(page, id);
    }
  }
  await ready(page, "recap");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByText("Session details", { exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export session", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^sprout-calculus-/);
  const report = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(report.math.visits.map((visit: { outcome: string }) => visit.outcome)).toEqual([
    "completed",
    "completed",
    "completed",
  ]);
  for (const [index, visit] of report.math.visits.entries()) {
    expect(visit.problemId).toBe(problems[index]);
    expect(visit.checks.length).toBe(SOLUTIONS[problems[index]].length);
    expect(visit.checks.at(-1).outcome).toBe("complete");
  }
  expect(JSON.stringify(report)).not.toMatch(/api_key|access_token|authorization|"sdp"/i);
  await page.goto("/demos/calculus");
  await expect(page.getByText("Session details", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export session" })).toHaveCount(0);
});
