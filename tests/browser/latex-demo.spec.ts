import { expect, test } from "@playwright/test";

test("audits the issue fixture and edited work without a provider", async ({ page }) => {
  await page.goto("/demos/latex");
  await expect(page.getByText("First issue: line 2 — Not equivalent")).toBeVisible();
  await expect(page.getByText("Check the reciprocal's numerator: 12+30y vs 12x+30y")).toBeVisible();
  await page.getByLabel("LaTeX expressions").fill("x(x+1)\nx^2+x");
  await expect(page.getByText("All 1 steps verified")).toBeVisible();
  await expect(page.getByText("✓ Verified")).toBeVisible();
});
