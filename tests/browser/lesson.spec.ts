import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { installLessonObserver } from "../helpers/lesson-observer";
import { installLocalSession, type LocalSessionWindow } from "../helpers/local-voice-session";
import { installSyntheticMicrophone } from "../helpers/synthetic-microphone";

test("/ opens the Sprout lesson", async ({ page }) => {
  const errors: string[] = [];
  const lessonRequests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/live", route => {
    lessonRequests.push(route.request().url());
    return route.fulfill({ status: 502, json: { error: "Unexpected automatic session start" } });
  });
  await page.route("**/api/classify", route => {
    lessonRequests.push(route.request().url());
    return route.fulfill({ json: { proposal: null } });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sprout", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "1 duck to count", exact: true })).toHaveAttribute(
    "data-node-id",
    "count-1-duck",
  );
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  await expect(page.getByRole("main").getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("status")).toHaveText("Come count with Sprout!");
  await expect(page.getByRole("complementary", { name: "Developer diagnostics" })).toHaveCount(0);
  await expect(page.getByText(/Progression gate|Current visit transcript|Diagnostics|Phase:|Visit:/)).toHaveCount(0);
  expect(lessonRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("only debug=1 exposes gates, transcript, raw events and full diagnostic download", async ({ page }) => {
  for (const query of ["?debug=0", "?debug=true", "?debug=1&debug=0"]) {
    await page.goto(`/${query}`);
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
    await expect(page.getByRole("complementary")).toHaveCount(0);
  }
  const observer = await installLessonObserver(page);
  await page.route("**/api/live", route => route.fulfill({ status: 502, json: { error: "Offline test" } }));
  await page.goto("/?debug=1");
  const diagnostics = page.getByRole("complementary", { name: "Developer diagnostics" });
  await expect(diagnostics.getByRole("heading", { name: "Progression gate" })).toBeVisible();
  await expect(diagnostics.getByRole("heading", { name: "Current visit transcript" })).toBeVisible();
  await expect(diagnostics.getByText("Phase: not started", { exact: false })).toBeVisible();
  await expect(diagnostics.getByRole("button", { name: "Export diagnostics" })).toBeDisabled();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("try Play again");
  await expect(diagnostics.locator("summary").filter({ hasText: "render.confirmed" })).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await diagnostics.getByRole("button", { name: "Export diagnostics" }).click();
  const download = await downloaded;
  const report = await observer.report();
  expect(download.suggestedFilename()).toBe(`sprout-lesson-${report!.runtimeId}.json`);
  expect(JSON.parse(await readFile((await download.path())!, "utf8"))).toEqual(report);
});

test("startup failure offers recovery without exposing technical errors to the child", async ({ page }) => {
  await page.route("**/api/live", route => route.fulfill({ status: 502, json: { error: "Offline test" } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Ask a grown-up to check the microphone and connection",
  );
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  await expect(page.getByText(/GPT-Live|Export diagnostics|Progression gate|Current visit transcript/)).toHaveCount(0);
  await expect(page.getByRole("main")).not.toContainText(/complete|listening/i);
});

test("Stop during startup ends gently and ignores a late connection failure", async ({ page }) => {
  const observer = await installLessonObserver(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route("**/api/live", async route => {
    await held;
    await route.fulfill({ status: 502, json: { error: "Late failure" } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Getting ready to play…");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  release();
  await expect(page.getByRole("status")).toContainText("We’ve stopped for now");
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("main")).not.toContainText(/complete|listening/i);
  expect((await observer.read())?.snapshot.runtime?.phase).toBe("stopped");
});

test("live child view keeps one scene, hides transcript and supports parent Stop", async ({ page }) => {
  await installSyntheticMicrophone(page);
  await installLocalSession(page);
  const observer = await installLessonObserver(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await observer.read())?.snapshot.status).toBe("live");
  await page.evaluate(() =>
    (window as unknown as LocalSessionWindow).sendTranscript(
      "session.output_transcript.delta",
      "How many ducks do you see?",
    ),
  );
  await expect.poll(async () => (await observer.read())?.snapshot.transcript).toContain("How many ducks");
  await expect(page.getByRole("main").getByRole("img")).toHaveCount(1);
  await expect(page.getByText("How many ducks do you see?", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("complementary")).toHaveCount(0);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("We’ve stopped for now");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  expect((await observer.read())?.snapshot.runtime?.phase).toBe("stopped");
  expect(await page.evaluate(() => (window as unknown as LocalSessionWindow).appPeerCloseCount)).toBeGreaterThan(0);
});

// Removed entry points must not remain aliases or redirects.
test("removed experiment entry points return 404", async ({ request }) => {
  expect((await request.get("/experiments/transcript-state-steering")).status()).toBe(404);
  expect(
    (
      await request.post("/api/experiments/transcript-state-steering/classify", {
        data: { nodeId: "count-1-duck", transcriptRevision: 1, transcript: "Child: One" },
      })
    ).status(),
  ).toBe(404);
});
