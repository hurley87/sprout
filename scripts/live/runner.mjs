import { chromium } from "@playwright/test";
import { createLiveObserver } from "./observer.mjs";
import { recordLiveTraffic } from "./instrumentation.mjs";

/**
 * Opens the real live session with caller-provided browser arguments. The driver runs
 * after Start is clicked; collection runs after the existing settling delay.
 * setupPage runs before navigation and may return an async cleanup callback.
 * Neither callback needs to describe child actions as fixed timestamps.
 */
export async function runLiveSession({ baseUrl, browserArgs, setupPage, drive, collect, onFailure = undefined }) {
  const browser = await chromium.launch({ args: browserArgs });
  let cleanup;
  let page;
  let failed = false;
  try {
    page = await (await browser.newContext({ permissions: ["microphone"] })).newPage();
    await page.addInitScript(recordLiveTraffic);
    cleanup = await setupPage?.(page);
    await page.goto(`${baseUrl}/?debug=1`);
    const observer = createLiveObserver(page);
    await observer.checkpoint();
    await page.getByRole("button", { name: "Start counting together" }).click();
    await drive({ page, observer });
    await page.waitForTimeout(2000);
    return await collect({ page, browser });
  } catch (error) {
    failed = true;
    if (page) await onFailure?.({ page, browser, error }).catch(() => {});
    throw error;
  } finally {
    try {
      await cleanup?.();
    } catch (error) {
      // Preserve the original navigation/driver failure if page cleanup also fails.
      if (!failed) {
        failed = true;
        throw error;
      }
    } finally {
      try {
        await browser.close();
      } catch (error) {
        if (!failed) throw error;
      }
    }
  }
}
