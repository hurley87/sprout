import { chromium } from "@playwright/test";
import { createLiveObserver } from "./observer.mjs";
import { recordLiveTraffic } from "./instrumentation.mjs";

/**
 * Opens the real live session with caller-provided browser arguments. The driver runs
 * after Start is clicked; collection runs after the existing settling delay.
 * Neither callback needs to describe child actions as fixed timestamps.
 */
export async function runLiveSession({ baseUrl, browserArgs, drive, collect }) {
  const browser = await chromium.launch({ args: browserArgs });
  try {
    const page = await (await browser.newContext({ permissions: ["microphone"] })).newPage();
    await page.addInitScript(recordLiveTraffic);
    await page.goto(`${baseUrl}/?debug=1`);
    const observer = createLiveObserver(page);
    await observer.checkpoint();
    await page.getByRole("button", { name: "Start counting together" }).click();
    await drive({ page, observer });
    await page.waitForTimeout(2000);
    return await collect({ page, browser });
  } finally {
    await browser.close();
  }
}
