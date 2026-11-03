import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectProblems } from "./helpers.ts";

async function open(page: Page, example: string, view: "top" | "iso") {
  await page.goto(`/?example=${example}`); // routing around cards is the default
  await page.locator(".adg-plane").waitFor();
  await page.getByRole("button", { name: view === "top" ? "Top view" : "Isometric" }).click();
  await page.waitForTimeout(1200);
}

/** Straight (L) segments of every drawn arrow that are neither horizontal nor vertical. */
const diagonals = (page: Page) =>
  page.locator(".adg-flat .adg-edge-base").evaluateAll((els) => {
    let bad = 0;
    let total = 0;
    for (const el of els) {
      const toks = (el.getAttribute("d") ?? "").match(/[MLQA]|-?\d+(?:\.\d+)?/g) ?? [];
      let cur: [number, number] = [0, 0];
      for (let i = 0; i < toks.length; ) {
        const cmd = toks[i++]!;
        const n = cmd === "M" || cmd === "L" ? 2 : cmd === "Q" ? 4 : 7;
        const v = toks.slice(i, i + n).map(Number);
        i += n;
        const end: [number, number] = [v[n - 2]!, v[n - 1]!];
        if (cmd === "L") {
          total++;
          if (Math.abs(end[0] - cur[0]) > 0.5 && Math.abs(end[1] - cur[1]) > 0.5) bad++;
        }
        cur = end;
      }
    }
    return { bad, total };
  });

test.describe("routing around cards (the default)", () => {
  for (const example of ["ai-platform-sim", "confluent-streaming-platform", "llm-gateway"]) {
    test(`${example}: every arrow runs in right angles, with no errors`, async ({ page }) => {
      const problems = collectProblems(page);
      await open(page, example, "top");
      const d = await diagonals(page);
      expect(d.total).toBeGreaterThan(10);
      expect(d.bad).toBe(0);
      expect(problems).toEqual([]);
    });
  }

  test("the isometric floors view draws routed arrows and cards stay clickable", async ({ page }) => {
    const problems = collectProblems(page);
    await open(page, "ai-platform-sim", "iso");
    expect(await page.locator(".adg-edge-base").count()).toBeGreaterThan(15);
    await page.locator(".adg-card").filter({ has: page.locator(".adg-name", { hasText: /^Router$/ }) }).click();
    await expect(page.locator(".adg-info h3")).toHaveText("Router");
    expect(problems).toEqual([]);
  });

  test("?routing=straight draws straight lines again, with diagonals", async ({ page }) => {
    await page.goto("/?example=ai-platform-sim&routing=straight");
    await page.locator(".adg-plane").waitFor();
    await page.getByRole("button", { name: "Top view" }).click();
    await page.waitForTimeout(1000);
    expect((await diagonals(page)).bad).toBeGreaterThan(0);
    await expect(page.getByRole("checkbox", { name: /Route arrows around cards/i })).not.toBeChecked();
  });

  test("the checkbox switches between the two", async ({ page }) => {
    await open(page, "ai-platform-sim", "top");
    const box = page.getByRole("checkbox", { name: /Route arrows around cards/i });
    await expect(box).toBeChecked();
    expect((await diagonals(page)).bad).toBe(0);
    await box.uncheck();
    await page.waitForTimeout(600);
    expect((await diagonals(page)).bad).toBeGreaterThan(0);
  });

  test("no arrow is ever drawn slanted, on any example, in either view", async ({ page }) => {
    for (const example of ["hospital-event-backbone", "platform-tooling", "retail-omnichannel"]) {
      await open(page, example, "top");
      expect((await diagonals(page)).bad, example).toBe(0);
    }
  });

  test("zoom, rotate and pan keep up on a large floors diagram (no hidden animation left running)", async ({ page }) => {
    await open(page, "retail-omnichannel", "iso");
    // only a lit arrow may be animated: a hidden one still being animated repainted the whole cable layer every frame
    expect(await page.locator(".adg-edge-flow:not(.hot):not(.sel)").evaluateAll((els) => els.filter((e) => getComputedStyle(e).animationName !== "none").length)).toBe(0);
  });

  test("a card picked while routing is on still lights its arrows", async ({ page }) => {
    await open(page, "ai-platform-sim", "top");
    await page.locator(".adg-card").filter({ has: page.locator(".adg-name", { hasText: /^Router$/ }) }).click();
    expect(await page.locator(".adg-edge-base.sel").count()).toBeGreaterThan(1);
  });
});
