import { expect, test } from "@playwright/test";
import { anglesOf } from "./helpers.ts";

test.use({ viewport: { width: 1400, height: 800 } });

async function open(page: import("@playwright/test").Page) {
  await page.goto("/?example=simple-web-app");
  await page.locator(".adg-plane").waitFor();
  await page.getByRole("button", { name: "Isometric", exact: true }).click();
  await page.waitForTimeout(1200);
}
const planeX = (page: import("@playwright/test").Page) => page.locator(".adg-plane").evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).e);

test.describe("dragging the isometric view", () => {
  test("a plain drag pans and does not rotate; shift-drag and right-drag rotate", async ({ page }) => {
    await open(page);
    const v = (await page.locator(".adg-view").boundingBox())!;
    const [cx, cy] = [v.x + v.width / 2, v.y + 20];
    for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Zoom in" }).click();
    await page.waitForTimeout(400);
    const a0 = await anglesOf(page);
    const x0 = await planeX(page);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy + 10, { steps: 6 });
    await page.mouse.up();
    expect((await anglesOf(page)).turn).toBe(a0.turn);
    await expect.poll(() => planeX(page)).toBeGreaterThan(x0 + 20);

    await page.keyboard.down("Shift");
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 100, cy, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up("Shift");
    const a1 = await anglesOf(page);
    expect(a1.turn).toBeGreaterThan(a0.turn + 20);

    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(cx - 100, cy, { steps: 6 });
    await page.mouse.up({ button: "right" });
    expect((await anglesOf(page)).turn).toBeLessThan(a1.turn - 20);
  });

  test("the hint says how to rotate", async ({ page }) => {
    await open(page);
    await expect(page.locator(".adg-hint")).toContainText(/shift-drag or right-drag to rotate/);
  });
});
