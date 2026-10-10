import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, expect } from "@playwright/test";
import { RecapPresentation } from "../../components/catching-unicorns/recap-presentation";
import {
  ASSESSMENT_VERSION,
  assessmentQuestions,
  normalizeAssessment,
} from "../../lib/lesson-runtime/conversation-assessment";
import { buildSessionSummary } from "../../lib/lesson-runtime/session-summary";
import { createLessonRuntime } from "../../lib/lesson-runtime/lesson-runtime-reducer";
import { CATCHING_UNICORNS_LESSON } from "../../lib/lesson-runtime/catching-unicorns-lesson";

// Presentation-only fixtures use the real recap markup and app styles; no voice/provider claim.
for (const status of ["pending", "unavailable", "idle"] as const) {
  test(`empty recap with ${status} review is readable at desktop and mobile widths`, async ({ page }, testInfo) => {
    const state = createLessonRuntime("empty-recap", { lesson: CATCHING_UNICORNS_LESSON });
    const summary = buildSessionSummary(state, { version: ASSESSMENT_VERSION, status, results: {} });
    const html = renderToStaticMarkup(createElement(RecapPresentation, { state, summary }));
    await page.goto("/demos/catching-unicorns");
    await page.locator('[data-node-id="engram"]').evaluate((element, markup) => {
      element.innerHTML = markup;
    }, html);
    const recap = page.locator('[data-scene="recap"]');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(recap.getByRole("heading", { name: "What you explained well" })).toBeVisible();
      await expect(recap).toContainText("too little of your explanation");
      await expect(recap).toContainText(summary.notice);
      await expect(recap.locator("blockquote")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`recap-${status}-${width}.png`), fullPage: true });
    }
    const disclosure = recap.locator("summary");
    await disclosure.focus();
    await page.keyboard.press("Enter");
    await expect(recap.locator("details")).toHaveAttribute("open", "");
    await expect(recap.getByRole("heading", { name: "Engram · unobserved" })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(recap.locator("details")).not.toHaveAttribute("open", "");
  });
}

test("grounded review-only recap keeps multiple learner quotations separate in the disclosure", async ({
  page,
}, testInfo) => {
  const state = createLessonRuntime("review-recap", { lesson: CATCHING_UNICORNS_LESSON });
  const secondQuote =
    "Words written on a page can keep information outside my brain. I can return to the record later and read it again. If I write down what I want to remember about an event, the words are on the page even when I am thinking about something else. Remembering the event is something happening in my mind, while reading the note means looking at information I recorded outside it. The note and my memory can refer to the same event, but they are kept in different places.";
  const snapshot = {
    runtimeId: state.runtimeId,
    generation: 1,
    visits: [
      {
        nodeId: "exogram",
        visitId: 2,
        transcript: `Tutor: What is an exogram?\nChild: Information stored outside the brain.\nTutor: Give an example.\nChild: ${secondQuote}`,
      },
    ],
  };
  const assessment = normalizeAssessment(
    {
      version: ASSESSMENT_VERSION,
      answers: Object.fromEntries(
        Object.entries(assessmentQuestions(CATCHING_UNICORNS_LESSON, snapshot)).map(([key, question]) => {
          const slot = /:evidence_(\d)$/.exec(key);
          const label = key.includes(":exogram-non-biological:")
            ? slot
              ? (["visit_2_message_1", "visit_2_message_3"][Number(slot[1])] ?? "none")
              : key.endsWith(":understanding")
                ? "demonstrated"
                : "unclear"
            : slot
              ? "none"
              : key.endsWith(":understanding")
                ? "not_yet"
                : "unclear";
          return [
            key,
            {
              type: "choice",
              choice: label,
              confidence: 1,
              probabilities: Object.fromEntries(Object.keys(question.criteria).map(id => [id, id === label ? 1 : 0])),
            },
          ];
        }),
      ),
    },
    CATCHING_UNICORNS_LESSON,
    snapshot,
  )!;
  const summary = buildSessionSummary(state, assessment, snapshot);
  const html = renderToStaticMarkup(createElement(RecapPresentation, { state, summary }));
  await page.goto("/demos/catching-unicorns");
  await page.locator('[data-node-id="engram"]').evaluate((element, markup) => {
    element.innerHTML = markup;
  }, html);
  const recap = page.locator('[data-scene="recap"]');
  await expect(recap.getByRole("heading", { name: "What you explained well" })).toBeVisible();
  await recap.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(recap.locator("blockquote")).toHaveCount(2);
  await expect(recap.locator("blockquote").nth(0)).toHaveText("“Information stored outside the brain.”");
  await expect(recap.locator("blockquote").nth(1)).toHaveText(`“${secondQuote}”`);
  await expect(recap).toContainText("review-only");
  await expect(recap).toContainText("message 3");
  await expect(recap).toContainText("You described an exogram as a memory representation kept outside the brain.");
  await expect(recap).toContainText("We cannot tell how much help you had.");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const open of [true, false]) {
      if (((await recap.locator("details").getAttribute("open")) !== null) !== open) {
        await recap.locator("summary").focus();
        await page.keyboard.press("Enter");
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`recap-multi-quote-${width}-${open ? "open" : "closed"}.png`),
        fullPage: true,
      });
      if (open) {
        await recap.getByRole("heading", { name: "Exogram · recorded", exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`recap-quotes-${width}.png`) });
      }
    }
  }
});
