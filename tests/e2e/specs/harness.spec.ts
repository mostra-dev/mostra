import { expect, test } from "@playwright/test";

// Proves the harness: each engine launches and renders. Product suites replace this as they land.
test("the browser engine renders a page", async ({ page }) => {
  await page.setContent("<main><h1>Mostra</h1></main>");
  await expect(page.getByRole("heading", { name: "Mostra" })).toBeVisible();
});
