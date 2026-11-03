import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectProblems } from "./helpers.ts";

const card = (page: Page, name: string) => page.locator(".adg-card").filter({ has: page.locator(".adg-name", { hasText: new RegExp(`^${name}$`) }) });
/** How many arrows are drawn and can be pointed at. */
const visibleArrows = (page: Page) => page.locator(".adg-edge:not(.hid)").count();
const allArrows = (page: Page) => page.locator(".adg-edge").count();

async function open(page: Page, query: string, view: "top" | "iso" = "top", example = "ai-platform-sim") {
  await page.goto(`/?example=${example}${query}`);
  await page.locator(".adg-plane").waitFor();
  await page.getByRole("button", { name: view === "top" ? "Top view" : "Isometric" }).click();
  await page.waitForTimeout(900);
}

test.describe("isolate selection", () => {
  test("off by default: selecting a card leaves every arrow in place", async ({ page }) => {
    await open(page, "");
    await card(page, "Router").click();
    expect(await visibleArrows(page)).toBe(await allArrows(page));
  });

  for (const view of ["top", "iso"] as const) {
    test(`${view}: a selected card keeps only its own arrows, and clearing it brings the rest back`, async ({ page }) => {
      const problems = collectProblems(page);
      await open(page, "&isolate=1", view);
      const all = await allArrows(page);
      await card(page, "Router").click();
      const kept = await visibleArrows(page);
      expect(kept).toBeGreaterThan(0);
      expect(kept).toBeLessThan(all / 2);
      await page.getByRole("button", { name: "Reset" }).click();
      expect(await visibleArrows(page)).toBe(all);
      expect(problems).toEqual([]);
    });
  }

  test("a selected container keeps the arrows in and out of it", async ({ page }) => {
    await open(page, "&isolate=1", "top", "confluent-streaming-platform");
    const all = await allArrows(page);
    await page.getByRole("button", { name: /^EKS cluster:/ }).click();
    const kept = await visibleArrows(page);
    expect(kept).toBeGreaterThan(5);
    expect(kept).toBeLessThan(all);
  });

  test("a selected arrow leaves only itself, and pointing at a card shows its arrows meanwhile", async ({ page }) => {
    await open(page, "&isolate=1");
    await page.locator(".adg-hit").first().click({ force: true });
    expect(await visibleArrows(page)).toBe(1);
    await card(page, "Router").hover();
    expect(await visibleArrows(page)).toBeGreaterThan(1);
  });
});

test.describe("hide minor arrows when zoomed out", () => {
  test("off by default: a large diagram shows every arrow at the fitted zoom", async ({ page }) => {
    await open(page, "", "top", "retail-omnichannel");
    expect(await visibleArrows(page)).toBe(await allArrows(page));
  });

  test("zoomed out only the traced path stays, and zooming in brings the rest back", async ({ page }) => {
    await open(page, "&declutter=1", "top", "retail-omnichannel");
    const all = await allArrows(page);
    const out = await visibleArrows(page);
    expect(out).toBeGreaterThan(0);
    expect(out).toBeLessThan(all);
    for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "Zoom in" }).click();
    await page.waitForTimeout(500);
    expect(await visibleArrows(page)).toBe(all);
  });

  test("a small diagram is not touched", async ({ page }) => {
    await open(page, "&declutter=1", "top", "simple-web-app");
    expect(await visibleArrows(page)).toBe(await allArrows(page));
  });
});
