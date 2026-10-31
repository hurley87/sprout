import { expect, test } from "@playwright/test";

test("Halloween direct load, refresh, diagnostics and garden remain available", async ({ page }) => {
  await page.goto("/halloween");
  await expect(page.getByRole("status")).toHaveText("Come count Halloween friends with Sprout!");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  await expect(page.locator('[data-counting-object="helper"]')).toHaveCount(1);
  await expect(page.locator("[data-progress]")).toHaveCount(7);
  await expect(page.locator("[data-artwork-state]")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("status")).toHaveText("Come count Halloween friends with Sprout!");
  await page.goto("/halloween?debug=1");
  await expect(page.getByRole("complementary", { name: "Developer diagnostics" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("Come count with Sprout!");
  await expect(page.locator('[data-counting-object="duck"]')).toHaveCount(1);
});
