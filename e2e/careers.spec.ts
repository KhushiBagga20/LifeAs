import { expect, test, type Page } from "@playwright/test";

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
}

test("search from the home page and open a career", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("What job do you want to try?").fill("nurse");
  await page.getByRole("button", { name: "Search" }).click();

  await expect(page).toHaveURL(/\/careers\?q=nurse/);
  const results = page.getByRole("list").filter({ has: page.getByRole("link", { name: /Matched/ }) });
  await expect(results.getByRole("heading", { level: 3 }).first()).toHaveText("Registered Nurses");
  await expectNoSidewaysScroll(page);
  await page.screenshot({ path: `qa/screens/m1/search-${testInfo.project.name}.png`, fullPage: true });

  await results.getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Registered Nurses" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What this job is made of" })).toBeVisible();
  for (const kind of ["Hands-on", "Thinking", "Creating", "Helping", "Leading", "Organising"]) {
    await expect(page.getByLabel(new RegExp(`^${kind}: \\d+%`))).toBeVisible();
  }
  // Next.js keeps the previous page mounted but hidden, so text checks only count visible text.
  await expect(page.getByText("O*NET® is a trademark of USDOL/ETA.").filter({ visible: true })).toBeVisible();
  await expectNoSidewaysScroll(page);
  await page.screenshot({ path: `qa/screens/m1/career-${testInfo.project.name}.png`, fullPage: true });
});

test("featured careers link to their pages", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Electrician/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Electricians" })).toBeVisible();
  await expect(page.getByRole("article").getByText("Mostly Hands-on")).toBeVisible();
});

test("a search with no matches suggests what to try", async ({ page }) => {
  await page.goto("/careers?q=youtuber");
  await expect(page.getByRole("heading", { name: "No careers match “youtuber”" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Registered nurse/ })).toBeVisible();
});

test("an unknown career code shows not found", async ({ page }) => {
  await page.goto("/careers/99-9999.00");
  await expect(page.getByRole("heading", { level: 1, name: "There’s no page here." })).toBeVisible();
});

test("the about page credits the data source", async ({ page }) => {
  await page.goto("/about");
  await expect(page.getByRole("heading", { name: "Where the job data comes from" })).toBeVisible();
  await expect(page.getByRole("link", { name: "CC BY 4.0" })).toHaveAttribute(
    "href",
    "https://creativecommons.org/licenses/by/4.0/",
  );
});

test("the search API returns ranked careers", async ({ request }) => {
  const response = await request.get("/api/careers/search?q=electrician");
  const body = await response.json();
  expect(body.results[0]).toMatchObject({ code: "47-2111.00", title: "Electricians" });
});
