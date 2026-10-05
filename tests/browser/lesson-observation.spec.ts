import { test, expect } from "@playwright/test";
import { installLessonObserver } from "../helpers/lesson-observer";
import type { LessonObservationWindow } from "../../lib/lesson-runtime/browser-observation";

test("ordinary lesson pages expose no observation bridge", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Start lesson", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as LessonObservationWindow).sproutLessonObservation)).toBeUndefined();
});

test("opt-in observes actual React render, terminal failure, report, and restart without providers", async ({
  page,
}) => {
  const observer = await installLessonObserver(page);
  let requests = 0;
  await page.route("**/api/live", route => {
    requests++;
    return route.fulfill({ status: 502, json: { error: "Provider-free observation test" } });
  });
  await page.route("**/api/classify", () => {
    throw new Error("Unexpected classifier call");
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Start lesson", exact: true })).toBeEnabled();
  await expect.poll(() => observer.read()).toBeNull();
  await page.getByRole("button", { name: "Start lesson", exact: true }).click();
  await expect.poll(async () => (await observer.read())?.snapshot.status).toBe("ended");
  const first = (await observer.read())!;
  const scope = { runtimeId: first.cursor.runtimeId, visitId: 1, nodeId: "count-1-duck" };
  const rendered = await observer.waitForEvent("render.confirmed", {
    after: { runtimeId: first.cursor.runtimeId, offset: 0 },
    scope,
    detail: { initial: true },
  });
  expect(rendered.event.detail).toMatchObject({ identity: { nodeId: "count-1-duck", sceneId: "hello-duck" } });
  const ended = await observer.waitForEvent("lesson.ended", { after: rendered.cursor, scope });
  expect(ended.event.detail).toMatchObject({ reason: "failure" });
  expect((await observer.report())?.events).toEqual(first.events);
  await expect(page.getByRole("img", { name: "1 duck to count", exact: true })).toHaveAttribute(
    "data-render-token",
    first.snapshot.display.token,
  );
  expect(await page.evaluate(() => Object.keys((window as LessonObservationWindow).sproutLessonObservation!))).toEqual([
    "read",
    "report",
  ]);
  await page.getByRole("button", { name: "Start lesson", exact: true }).click();
  await expect.poll(async () => (await observer.read())?.cursor.runtimeId).not.toBe(first.cursor.runtimeId);
  await expect(observer.read(first.cursor)).rejects.toThrow(/cursor/);
  await expect.poll(async () => (await observer.read())?.snapshot.status).toBe("ended");
  expect(requests).toBe(2);
  await page.goto("/missing-observer-page");
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  expect(await page.evaluate(() => (window as LessonObservationWindow).sproutLessonObservation)).toBeUndefined();
});
