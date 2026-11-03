import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectProblems } from "./helpers.ts";

const LAYERS = ["Golden path", "Control plane", "Runtime", "Tenants"]; // top to bottom, as the spec lists them
const card = (page: Page, name: string) => page.locator(".adg-card").filter({ has: page.locator(".adg-name", { hasText: new RegExp(`^${name}$`) }) });

async function open(page: Page, mode: "off" | "floors", view: "top" | "iso") {
  await page.goto(`/?example=ai-platform-sim&layers=${mode}`);
  await page.locator(".adg-plane").waitFor();
  await page.getByRole("button", { name: view === "top" ? "Top view" : "Isometric" }).click();
  await page.waitForTimeout(1000);
}

/** How many saturated pixels the diagram paints: the coloured icons. A card hidden behind a floor does not count. */
async function icons(page: Page): Promise<number> {
  const png = await page.locator(".adg-view").screenshot();
  const probe = await page.context().newPage();
  const n = await probe.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let k = 0;
    for (let i = 0; i < d.length; i += 8) {
      const mx = Math.max(d[i]!, d[i + 1]!, d[i + 2]!);
      const mn = Math.min(d[i]!, d[i + 1]!, d[i + 2]!);
      if (mx > 110 && (mx - mn) / mx > 0.45) k++;
    }
    return k;
  }, "data:image/png;base64," + png.toString("base64"));
  await probe.close();
  return n;
}

test.describe("layers", () => {
  test("floors: one floor per layer, labelled, with no errors", async ({ page }) => {
    const problems = collectProblems(page);
    await open(page, "floors", "iso");
    await expect(page.locator(".adg-floor")).toHaveCount(LAYERS.length);
    // the floors are drawn lowest first, so a higher floor paints over a lower one
    await expect(page.locator(".adg-floor .adg-band-label")).toHaveText([...LAYERS].reverse().map((l) => new RegExp(l, "i")));
    expect(problems).toEqual([]);
  });

  test("floors: the floors are at different heights", async ({ page }) => {
    await open(page, "floors", "iso");
    const tops = await page.locator(".adg-floor").evaluateAll((els) => els.map((e) => new DOMMatrix(getComputedStyle(e).transform).f));
    expect(new Set(tops.map((t) => Math.round(t))).size).toBe(LAYERS.length); // each floor sits at its own height
    expect(tops).toEqual([...tops].sort((a, b) => b - a)); // drawn lowest first: each next floor is higher, so its offset is more negative
  });

  test("floors: cards are painted, not hidden behind the floors", async ({ page }) => {
    await open(page, "off", "iso");
    const flat = await icons(page);
    await open(page, "floors", "iso");
    const stacked = await icons(page);
    expect(flat).toBeGreaterThan(1000);
    expect(stacked).toBeGreaterThan(flat * 0.5);
  });

  test("floors: arrows between floors are drawn, and a card is still clickable", async ({ page }) => {
    await open(page, "floors", "iso");
    await expect(page.locator(".adg-cross .adg-edge-base")).not.toHaveCount(0);
    await card(page, "Router").click();
    await expect(page.locator(".adg-info h3")).toHaveText("Router");
  });

  test("floors fall back to bands in the top view", async ({ page }) => {
    await open(page, "floors", "top");
    await expect(page.locator(".adg-floor")).toHaveCount(0);
    await expect(page.locator(".adg-band-label")).toHaveText(LAYERS.map((l) => new RegExp(l, "i")));
  });

  test("off: neither bands nor floors", async ({ page }) => {
    await open(page, "off", "iso");
    await expect(page.locator(".adg-band, .adg-floor")).toHaveCount(0);
  });

  test("a card's name says which layer and plane it is in", async ({ page }) => {
    await open(page, "floors", "top");
    await expect(page.getByRole("button", { name: /Router.*layer Runtime.*data plane/i })).toBeVisible();
  });

  test("the Planes lens marks every card that has a plane, and says which", async ({ page }) => {
    await open(page, "floors", "top");
    await page.getByRole("combobox", { name: "Lens" }).selectOption({ label: "Planes" });
    await expect(card(page, "Router").locator(".adg-badge")).toContainText("Data plane");
    await expect(card(page, "Team registry").locator(".adg-badge")).toContainText("Control plane");
    await card(page, "Team applications").click(); // a tenant's own app is neither
    await expect(page.locator(".adg-info")).toContainText(/No planes note/i);
  });
});
