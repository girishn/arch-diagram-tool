import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { THEMES } from "../../src/themes.ts";
import { EXAMPLE_NAMES, chooseLens, openExample } from "./helpers.ts";

// axe-core finds only part of the problems (Deque's own study: issues flagged for 16 of 50 WCAG 2.1 AA criteria), so this is the floor, not the proof.
// The keyboard, reduced-motion and forced-colours tests in diagram.spec.ts cover what axe cannot.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

// Rules axe reports today, each with the backlog item that fixes it. The test fails on anything NOT listed here (a regression),
// and on an entry that no longer fires anywhere (so the list cannot go stale).
export const KNOWN_VIOLATIONS: Record<string, string> = {};

async function scan(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).include(".adx").withTags(TAGS).analyze();
  return results.violations.map((v) => ({ id: v.id, count: v.nodes.length, sample: v.nodes[0]?.target.join(" ") ?? "" }));
}

const fired = new Set<string>();

test.describe("axe in every theme", () => {
  for (const theme of THEMES) {
    test(`${theme.id}: no new violations`, async ({ page }) => {
      await page.addInitScript((id) => localStorage.setItem("adg-demo-theme", id), theme.id);
      await openExample(page, "simple-web-app");
      const applied = await page.locator(".adg").first().evaluate((el) => getComputedStyle(el).getPropertyValue("--adg-bg").trim());
      expect(applied).toBe(theme.vars.bg);

      const found = await scan(page);
      found.forEach((v) => fired.add(v.id));
      expect(found.filter((v) => !(v.id in KNOWN_VIOLATIONS)).map((v) => `${v.id}: ${v.count} nodes, e.g. ${v.sample}`)).toEqual([]);
    });
  }
});

test.describe("axe on the states a visitor reaches", () => {
  test("with a lens on, a node selected and a connection selected", async ({ page }) => {
    await openExample(page, "platform-tooling");
    await chooseLens(page, "security");
    await page.locator(".adg-card").first().click();
    await page.locator(".adg-chip").first().click();
    await page.mouse.move(2, 2); // a resting pointer would dim the unrelated cards, which is its own known issue (below)
    const found = await scan(page);
    expect(found.filter((v) => !(v.id in KNOWN_VIOLATIONS)).map((v) => `${v.id}: ${v.count} nodes, e.g. ${v.sample}`)).toEqual([]);
  });

  for (const theme of THEMES) {
    test(`${theme.id}: with the trace callout open`, async ({ page }) => {
      await page.addInitScript((id) => localStorage.setItem("adg-demo-theme", id), theme.id);
      await openExample(page, "simple-web-app");
      await page.getByRole("button", { name: "Start the trace" }).click();
      await page.getByRole("button", { name: /Next/ }).click();
      await page.mouse.move(2, 2);
      await page.waitForTimeout(1000);
      const found = await scan(page);
      expect(found.filter((v) => !(v.id in KNOWN_VIOLATIONS)).map((v) => `${v.id}: ${v.count} nodes, e.g. ${v.sample}`)).toEqual([]);
    });
  }

  test("with the whole trace path shown", async ({ page }) => {
    await openExample(page, "platform-tooling");
    await page.getByRole("button", { name: "Show the path" }).click();
    await page.mouse.move(2, 2);
    const found = await scan(page);
    expect(found.filter((v) => !(v.id in KNOWN_VIOLATIONS)).map((v) => `${v.id}: ${v.count} nodes, e.g. ${v.sample}`)).toEqual([]);
  });

  test("in the isometric view", async ({ page }) => {
    await openExample(page, "simple-web-app", "iso");
    const found = await scan(page);
    expect(found.filter((v) => !(v.id in KNOWN_VIOLATIONS)).map((v) => `${v.id}: ${v.count} nodes, e.g. ${v.sample}`)).toEqual([]);
  });
});

test.describe("reflow at 320 px (WCAG 1.4.10)", () => {
  test.use({ viewport: { width: 320, height: 800 } });

  for (const name of EXAMPLE_NAMES) {
    test(`${name} does not scroll sideways`, async ({ page }) => {
      await openExample(page, name);
      const { scrollWidth, innerWidth, wide } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        // what sticks out, so a failure says where (fonts differ between machines)
        wide: [...document.querySelectorAll("body *")].filter((e) => !e.closest(".adg-view") && e.getBoundingClientRect().right > window.innerWidth + 0.5).slice(0, 8).map((e) => `${e.tagName}.${(e as HTMLElement).className} right=${Math.round(e.getBoundingClientRect().right)}`),
      }));
      expect(scrollWidth, wide.join("; ")).toBeLessThanOrEqual(innerWidth);
      await expect(page.locator(".adg-bar")).toBeVisible();
      await expect(page.locator(".adg-info")).toBeVisible();
    });
  }
});

// Hover dimming used to fade whole cards to 28% opacity, which took their text under 4.5:1 (WCAG 1.4.3). It now fades the picture and plate
// and keeps the words at full contrast; this is the regression test for that.
test("dimmed cards still meet text contrast", async ({ page }) => {
  await openExample(page, "simple-web-app");
  await page.locator(".adg-card", { hasText: "Browser" }).hover(); // dims the scaled Function card, whose small badge is what used to fail
  await expect(page.locator(".adg-card.dim").first()).toBeVisible();
  const results = await new AxeBuilder({ page }).include(".adg-card.dim").withRules(["color-contrast"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});
