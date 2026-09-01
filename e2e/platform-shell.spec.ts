import { expect, test } from "@playwright/test";

test("platform shell renders", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Investigation Intelligence Platform" }),
  ).toBeVisible();
});

for (const product of ["SHADOW", "ECHO", "SPECTRA"] as const) {
  test(`${product} foundation route renders`, async ({ page }) => {
    await page.goto(`/${product.toLowerCase()}`);
    await expect(page.getByRole("heading", { name: product })).toBeVisible();
  });
}
