import { test, expect } from "@playwright/test";

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
  await expect(page.getByRole("button", { name: "Start lesson", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Export diagnostics", exact: true })).toBeDisabled();
  await expect(page.getByRole("status")).toHaveText("Ready");
  expect(lessonRequests).toEqual([]);
  expect(errors).toEqual([]);
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
