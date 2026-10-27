import { expect, test } from "@playwright/test";

test("the landing page explains the game without sideways scrolling", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Someone in Block C runs with a crew." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "How a round goes" })).toBeVisible();
  for (const role of ["Neighbour", "Crew", "Boss", "Undercover", "Medic", "Influencer"]) {
    await expect(page.getByRole("heading", { level: 3, name: role })).toBeVisible();
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
  await page.screenshot({ path: `qa/screens/g0/home-${testInfo.project.name}.png`, fullPage: true });
});

test("an unknown page is a designed not-found", async ({ page }) => {
  await page.goto("/nowhere");
  await expect(page.getByRole("heading", { level: 1, name: "Nobody lives here." })).toBeVisible();
});

test("health check reports the database is up", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual({ ok: true, db: "up" });
});
