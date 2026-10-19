import { expect, test } from "@playwright/test";

test("home page explains the product without sideways scrolling", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Live a week in a job before you choose it." }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);

  await page.screenshot({
    path: `qa/screens/m0/home-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test("health check reports the database is up", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual({ ok: true, db: "up" });
});
