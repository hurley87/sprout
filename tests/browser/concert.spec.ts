import { expect, test } from "@playwright/test";

test("concert loads directly, reloads and exposes diagnostics on request", async ({ page }) => {
  await page.goto("/concert");
  await expect(page.getByRole("status")).toHaveText("Come help get the concert ready!");
  await expect(page.locator('[data-counting-object="microphone"]')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("status")).toHaveText("Come help get the concert ready!");
  await page.goto("/concert?debug=1");
  await expect(page.getByRole("complementary", { name: "Developer diagnostics" })).toBeVisible();
});
