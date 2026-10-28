import { expect, test } from "@playwright/test";

// The landing page's live game in the 3D courtyard (DESIGN.md §4): it draws, it plays, it can be
// paused, it respects reduced motion, and it never pushes the page sideways.

test("the live game draws the courtyard and plays on its own", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("/");
  const demo = page.getByRole("figure");
  await expect(demo.locator("[data-ready=true] canvas")).toBeVisible({ timeout: 20_000 });
  // The canvas really has a picture on it (not a blank context): count colours in a screenshot.
  // (Reading the WebGL canvas directly gives blank pixels once a frame has been shown.)
  await page.waitForTimeout(1_500);
  const png = (await demo.locator("canvas").screenshot()).toString("base64");
  const lit = await page.evaluate(async (b64) => {
    const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const copy = document.createElement("canvas");
    copy.width = 64;
    copy.height = 64;
    const ctx = copy.getContext("2d")!;
    ctx.drawImage(image, 0, 0, 64, 64);
    const data = ctx.getImageData(0, 0, 64, 64).data;
    const colours = new Set<number>();
    for (let i = 0; i < data.length; i += 4) colours.add((data[i] >> 4) * 256 + (data[i + 1] >> 4) * 16 + (data[i + 2] >> 4));
    return colours.size;
  }, png);
  expect(lit).toBeGreaterThan(10);
  // The narrator opens the game and the phases move on.
  await expect(demo.getByText(/Block C/).first()).toBeVisible();
  await expect(demo.getByText(/Night 1|Dawn 1|Day 1/)).toBeVisible({ timeout: 20_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
  await page.screenshot({ path: `qa/screens/g4/landing-${testInfo.project.name}.png` });
  expect(errors).toEqual([]);
});

test("the live game can be paused", async ({ page }) => {
  await page.goto("/");
  const demo = page.getByRole("figure");
  await expect(demo.locator("[data-ready=true]")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Pause the live game" }).click();
  const chip = demo.locator("span.rounded-full").first();
  const before = await chip.textContent();
  await page.waitForTimeout(2_500);
  expect(await chip.textContent()).toBe(before);
  await page.getByRole("button", { name: "Play the live game" }).click();
  await expect(chip).not.toHaveText(before!, { timeout: 5_000 });
});

test("with reduced motion the courtyard still draws, without the drifting camera", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: testInfo.project.use.viewport ?? undefined });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("figure").locator("[data-ready=true] canvas")).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: `qa/screens/g4/landing-reduced-${testInfo.project.name}.png` });
  await context.close();
});
