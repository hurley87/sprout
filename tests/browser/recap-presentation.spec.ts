import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, expect } from "@playwright/test";
import { RecapPresentation } from "../../components/catching-unicorns/recap-presentation";
import { ASSESSMENT_VERSION } from "../../lib/lesson-runtime/conversation-assessment";
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
      await expect(recap).toContainText("not enough attributable evidence");
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
