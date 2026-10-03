import { test, expect } from "@playwright/test";
import { recordLiveTraffic } from "../../scripts/live/instrumentation.mjs";
import { createLiveObserver } from "../../scripts/live/observer.mjs";

test("observer consumes instrumented DOM signals without a provider", async ({ page }) => {
  await page.goto("about:blank");
  await page.evaluate(recordLiveTraffic);
  const observer = createLiveObserver(page, { timeoutMs: 1000 });
  await page.setContent('<main data-scene="hello-duck"><button>End lesson</button></main>');
  await observer.waitForScene("hello-duck");
  const checkpoint = await observer.checkpoint();
  await page.evaluate(async () => {
    document.querySelector("main")!.setAttribute("data-scene", "duck-friends");
  });
  await expect(observer.waitForSceneAdvance({ after: checkpoint })).resolves.toMatchObject({
    from: "hello-duck",
    to: "duck-friends",
  });
  await page.locator("button").evaluate(button => button.remove());
  await expect(observer.waitForSessionEnd({ after: checkpoint })).resolves.toMatchObject({
    event: { dir: "ui", live: false },
  });
});
