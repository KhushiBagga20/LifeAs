import { expect, test, type Page } from "@playwright/test";

async function finishDialogue(page: Page) {
  for (let beat = 0; beat < 5; beat++) {
    const reveal = page.getByRole("button", { name: "Show full line" });
    if (await reveal.isVisible()) await reveal.click();
    const next = page.getByRole("button", { name: "Continue", exact: true });
    if (!(await next.isVisible())) return;
    await next.click();
  }
}

test("walk through the studio and physically deliver your own poster", async ({ page }, testInfo) => {
  test.setTimeout(100_000);
  await page.goto("/play");
  await expect(page.getByText("Opening the studio.", { exact: true })).toBeHidden({ timeout: 30_000 });
  await expect(page.locator("canvas")).toBeVisible();
  await page.getByRole("button", { name: "Walk there", exact: true }).click();
  await page.getByRole("button", { name: "Take the brief", exact: true }).click({ timeout: 20_000 });
  await page.getByRole("button", { name: "Walk there", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Make the poster.", exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "03 Booking action" }).click();
  const size = page.getByRole("slider", { name: /Type size/ });
  await size.fill("16");
  await page.screenshot({ path: `qa/screens/world/editor-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: /Save draft & pick it up/ }).click();
  await page.getByRole("button", { name: "Walk there", exact: true }).click();
  await page.getByRole("button", { name: /Pin the poster/ }).click({ timeout: 20_000 });
  await finishDialogue(page);
  await page.getByRole("button", { name: /Let’s confirm East Hall before we print/ }).click();
  await expect(page.locator(".character-line-full")).toContainText("East Hall is confirmed");
  await finishDialogue(page);
  await page.getByRole("button", { name: /Can the volunteer give us fifteen more minutes/ }).click();
  await page.getByRole("button", { name: "Leave conversation" }).click();
  await page.getByRole("button", { name: "Walk there", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Make the poster.", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Move details text" })).toContainText("EAST HALL");
  await page.getByRole("button", { name: /Save draft & pick it up/ }).click();
  await page.getByRole("button", { name: "Walk there", exact: true }).click();
  await page.getByRole("button", { name: /Pin the poster/ }).click({ timeout: 20_000 });
  await page.getByRole("button", { name: "Keep working" }).click();
  await page.getByRole("button", { name: "Walk there", exact: true }).click();
  await page.getByRole("button", { name: /Inspect the paper path/ }).click({ timeout: 20_000 });
  await page.getByRole("button", { name: /Open service panel & clear jam/ }).click();
  await page.getByRole("button", { name: /print my poster/ }).click();
  await page.getByRole("button", { name: "Pick up proof" }).click({ timeout: 10_000 });
  await page.getByRole("button", { name: "Walk there", exact: true }).click();
  await page.getByRole("button", { name: /Hand over the poster/ }).click({ timeout: 20_000 });
  await finishDialogue(page);
  await expect(page.locator(".character-line-full")).toContainText("extra time");
  await page.getByRole("button", { name: /Take a breath. The handoff is done/ }).click();
  await expect(page.getByRole("heading", { name: "That’s a wrap" })).toBeVisible();
  await page.screenshot({ path: `qa/screens/world/delivered-${testInfo.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("conversations frame the speaker and return control to the studio", async ({ page }, testInfo) => {
  await page.route("**/api/world/agents", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { mode: "local" } });
    const { agent } = route.request().postDataJSON();
    return route.fulfill({ json: { agent, destination: "board", line: "The event name first. Then when and where. Finally, one clear way to book.", mode: "local", notice: null } });
  });
  await page.goto("/play");
  await expect(page.getByText("Opening the studio.", { exact: true })).toBeHidden({ timeout: 30_000 });
  await page.getByRole("button", { name: "Approach Maya, Creative director" }).click();
  await expect(page.getByRole("region", { name: "Conversation with Maya" })).toBeVisible({ timeout: 20_000 });
  await finishDialogue(page);
  await page.getByRole("button", { name: /What should stand out first/ }).click();
  await expect(page.locator(".character-line-full")).toContainText("The event name first.");
  await page.getByRole("button", { name: "Show full line" }).click();
  await expect(page.locator(".character-line-visible")).toContainText("Finally, one clear way to book.");
  await expect(page.locator("canvas")).toBeVisible();
  await page.screenshot({ path: `qa/screens/world/conversation-${testInfo.project.name}.png`, fullPage: true });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Leave conversation" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Walk there", exact: true })).toBeVisible();
});
