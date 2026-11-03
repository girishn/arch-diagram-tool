import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectProblems } from "./helpers.ts";

test.use({ viewport: { width: 1400, height: 800 } });

async function open(page: Page, query = "", example = "platform-stack") {
  await page.goto(`/?example=${example}${query}`);
  await page.locator(".adg-plane").waitFor();
  await page.waitForTimeout(900);
}
/** Sends one wheel event over the diagram and says whether the diagram took it (the page would not scroll). */
const wheel = (page: Page, deltaY: number, opts: { altKey?: boolean } = {}) =>
  page.locator(".adg-view").evaluate((el, o) => {
    const r = el.getBoundingClientRect();
    const e = new WheelEvent("wheel", { deltaY: o.deltaY, altKey: !!o.altKey, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    return e.defaultPrevented;
  }, { deltaY, ...opts });
const scaleOf = (page: Page) => page.locator(".adg-plane").evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);

test.describe("the wheel over the diagram", () => {
  test("a plain wheel up zooms in and is taken by the diagram", async ({ page }) => {
    await open(page);
    const z0 = await scaleOf(page);
    expect(await wheel(page, -100)).toBe(true);
    await expect.poll(() => scaleOf(page)).toBeGreaterThan(z0 * 1.05);
  });

  test("at the fitted size a wheel down is left to the page, and so is Alt + wheel", async ({ page }) => {
    await open(page);
    expect(await wheel(page, 100)).toBe(false);
    expect(await wheel(page, -100, { altKey: true })).toBe(false);
  });

  test("zoomed in, a wheel down zooms back out until the fitted size, then the page gets it", async ({ page }) => {
    await open(page);
    const z0 = await scaleOf(page);
    for (let i = 0; i < 4; i++) await wheel(page, -100);
    await expect.poll(() => scaleOf(page)).toBeGreaterThan(z0 * 1.3);
    expect(await wheel(page, 100)).toBe(true);
    for (let i = 0; i < 40; i++) await wheel(page, 100);
    await expect.poll(async () => (await scaleOf(page)) / z0).toBeCloseTo(1, 1);
    expect(await wheel(page, 100)).toBe(false);
  });

  test("the page still scrolls: with the wheel over the diagram at its fitted size, over the heading, and with Alt held", async ({ page }) => {
    await open(page);
    const view = (await page.locator(".adg-view").boundingBox())!;
    expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)).toBe(true); // there is something to scroll
    await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.move(200, 40);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  });

  test("the library default is unchanged: ?wheel=ctrl leaves a plain wheel to the page", async ({ page }) => {
    await open(page, "&wheel=ctrl");
    expect(await wheel(page, -100)).toBe(false);
  });

  test("the hint says what the wheel does", async ({ page }) => {
    await open(page);
    await expect(page.locator(".adg-hint")).toContainText(/scroll or pinch to zoom/);
    await page.goto("/?example=platform-stack&wheel=ctrl");
    await expect(page.locator(".adg-hint")).toContainText(/ctrl \+ wheel/);
  });
});

test.describe("first view of a tall floors stack", () => {
  test.use({ viewport: { width: 1700, height: 950 } });
  test("fills the stage's width, and the part past its height can be panned to", async ({ page }) => {
    const problems = collectProblems(page);
    await open(page, "", "retail-omnichannel");
    await page.getByRole("button", { name: "Isometric" }).click();
    await page.waitForTimeout(1300);
    const view = (await page.locator(".adg-view").boundingBox())!;
    const floors = await page.locator(".adg-floor .adg-band").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).flatMap((r) => [r.left, r.right]));
    const span = Math.max(...floors) - Math.min(...floors);
    expect(span / view.width).toBeGreaterThan(0.85);
    expect(span / view.width).toBeLessThan(1);
    expect(await page.locator(".adg-hint").textContent()).toMatch(/Drag to pan/); // the part past the stage's height can be panned to
    expect(problems).toEqual([]);
  });
});

test("selecting a card eases its plate and its pad together (the titles layer uses the same transition as the card)", async ({ page }) => {
  await open(page, "", "ai-platform-sim");
  await page.getByRole("button", { name: "Isometric" }).click();
  await page.waitForTimeout(1200);
  const [ghost, card] = await page.evaluate(() => [
    getComputedStyle(document.querySelector(".adg-ghost .adg-name")!).transitionDuration,
    getComputedStyle(document.querySelector(".adg-card .adg-name")!).transitionDuration,
  ]);
  expect(ghost).toBe(card);
  expect(ghost).not.toBe("0s");
});

test("turning the floors view moves the floors and cards together, then settles with no sliding left", async ({ page }) => {
  await open(page, "", "ai-platform-sim");
  await page.getByRole("button", { name: "Isometric" }).click();
  await page.waitForTimeout(1200);
  const floorMatrix = () => page.locator(".adg-floor").first().evaluate((el) => getComputedStyle(el).transform);
  const before = await floorMatrix();
  await page.getByRole("button", { name: "Rotate left" }).click();
  await expect(page.locator(".adg-plane")).toHaveClass(/\bnt\b/); // eased by script, with the CSS slide off while it turns
  await expect.poll(floorMatrix).not.toBe(before);
  await expect(page.locator(".adg-plane")).not.toHaveClass(/\bnt\b/); // the turn has ended
  const settled = await floorMatrix();
  await page.waitForTimeout(500);
  expect(await floorMatrix()).toBe(settled);
});
