import { test, expect } from "@playwright/test";

for (const path of ["/", "/experiments/transcript-state-steering"]) {
  test(`${path} opens the transcript-state-steering lesson`, async ({ page }) => {
    const errors: string[] = [];
    const lessonRequests: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/live", route => {
      lessonRequests.push(route.request().url());
      return route.fulfill({ status: 502, json: { error: "Unexpected automatic session start" } });
    });
    await page.route("**/api/experiments/transcript-state-steering/classify", route => {
      lessonRequests.push(route.request().url());
      return route.fulfill({ json: { proposal: null } });
    });

    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "Transcript state steering experiment", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("img", { name: "1 duck to count", exact: true })).toHaveAttribute(
      "data-node-id",
      "count-1-duck",
    );
    await expect(page.getByRole("button", { name: "Start experiment", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Export diagnostics", exact: true })).toBeDisabled();
    await expect(page.getByRole("status")).toHaveText("Ready");
    expect(lessonRequests).toEqual([]);
    expect(errors).toEqual([]);
  });
}
