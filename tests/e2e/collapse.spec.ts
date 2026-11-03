import { expect, test } from "@playwright/test";
import { collectProblems, openExample } from "./helpers.ts";

test.use({ viewport: { width: 1400, height: 800 } });

const cards = (page: import("@playwright/test").Page) => page.locator(".adg-card").count();

test.describe("collapsing containers", () => {
  test("the Detail choice collapses by level, and All components brings every card back", async ({ page }) => {
    const problems = collectProblems(page);
    await openExample(page, "iot-connected-fleet");
    const before = await cards(page);
    const detail = page.getByRole("combobox", { name: "Detail" });
    const options = await detail.locator("option").allTextContents();
    await detail.selectOption({ index: options.length - 1 }); // the innermost level
    await expect.poll(() => cards(page)).toBeLessThan(before);
    await expect(page.locator(".adg-card", { hasText: "components" }).first()).toBeVisible();
    await detail.selectOption("open");
    await expect.poll(() => cards(page)).toBe(before);
    expect(problems).toEqual([]);
  });

  test("a container's own button collapses it; selecting the card offers Expand, which opens it again", async ({ page }) => {
    await openExample(page, "platform-stack");
    const before = await cards(page);
    const fold = page.getByRole("button", { name: /^Collapse .* into one card$/ }).first();
    await fold.click();
    await expect.poll(() => cards(page)).toBeLessThan(before);
    await page.locator(".adg-card", { hasText: "components" }).first().click();
    await expect(page.locator(".adg-info")).toContainText("Collapsed");
    await page.locator(".adg-info").getByRole("button", { name: /^Expand / }).click();
    await expect.poll(() => cards(page)).toBe(before);
  });

  test("coarser levels leave fewer cards than finer ones", async ({ page }) => {
    await openExample(page, "hybrid-landing-zone");
    const detail = page.getByRole("combobox", { name: "Detail" });
    const n = (await detail.locator("option").count()) - 1; // levels, without "All components"
    expect(n).toBeGreaterThanOrEqual(2);
    await detail.selectOption(String(n));
    await expect.poll(() => cards(page)).toBeGreaterThan(0);
    const fine = await cards(page);
    await detail.selectOption("1");
    await expect.poll(() => cards(page)).toBeLessThan(fine);
  });

  test("the fold button is at least 24 px square and reachable by keyboard", async ({ page }) => {
    await openExample(page, "platform-stack");
    const fold = page.getByRole("button", { name: /^Collapse .* into one card$/ }).first();
    const box = (await fold.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(23.5);
    expect(box.height).toBeGreaterThanOrEqual(23.5);
    await fold.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".adg-card", { hasText: "components" }).first()).toBeVisible();
  });

  test("a collapsed diagram draws in both views without errors, and its arrows are all right-angled", async ({ page }) => {
    const problems = collectProblems(page);
    await openExample(page, "retail-omnichannel");
    await page.getByRole("combobox", { name: "Detail" }).selectOption("1");
    for (const view of ["Top view", "Isometric"]) {
      await page.getByRole("button", { name: view }).click();
      await page.waitForTimeout(1200);
      // every drawn arrow is a path of horizontal and vertical runs (rounded corners are arcs, never straight diagonals)
      const slanted = await page.locator(".adg-edge").evaluateAll((els) =>
        els.filter((e) => {
          const nums = ((e.getAttribute("d") ?? "").match(/[ML]\s*-?[\d.]+[ ,]-?[\d.]+/g) ?? []).map((m) => m.replace(/[ML]\s*/, "").split(/[ ,]/).map(Number));
          return nums.some((p, i) => i > 0 && Math.abs(p[0]! - nums[i - 1]![0]!) > 0.5 && Math.abs(p[1]! - nums[i - 1]![1]!) > 0.5);
        }).length,
      );
      expect(slanted, `${view}: slanted arrows`).toBe(0);
    }
    expect(problems).toEqual([]);
  });
});
