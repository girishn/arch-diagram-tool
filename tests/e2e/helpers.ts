import { readdirSync } from "node:fs";
import type { Page } from "@playwright/test";

/** Example names (file names without .json), straight from examples/. */
export const EXAMPLE_NAMES = readdirSync(new URL("../../examples/", import.meta.url))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

/** Open one example in the demo and wait until the plane has been drawn (it appears once the stage has been measured). */
export async function openExample(page: Page, example: string, view: "top" | "iso" = "top") {
  await page.goto(`/?example=${example}`);
  await page.locator(".adg-plane").waitFor();
  if (view === "top") await page.getByRole("button", { name: "Top view" }).click();
  // transitions run for up to 0.9 s; under reduced motion they are off
  await page.waitForTimeout(1000);
}

/** Console errors and uncaught page errors collected while a test runs. */
export function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console.error: ${m.text()}`);
  });
  return problems;
}

/** The plane's current zoom (the scale in its transform). */
export const scaleOf = (page: Page) =>
  page.locator(".adg-plane").evaluate((el) => parseFloat((el as HTMLElement).style.transform.match(/scale\(([\d.]+)/)![1]!));

/** The plane's pan (the translate at the start of its transform), in px. */
export const panOf = (page: Page) =>
  page.locator(".adg-plane").evaluate((el) => {
    // WebKit serialises a zero second value away: translate(-62px, 0px) comes back as translate(-62px)
    const m = (el as HTMLElement).style.transform.match(/translate\((-?[\d.]+)px(?:, (-?[\d.]+)px)?\)/)!;
    return [parseFloat(m[1]!), parseFloat(m[2] ?? "0")] as const;
  });

/** Switch lens. The toolbar shows buttons for up to four lenses and a dropdown beyond that. */
export async function chooseLens(page: Page, id: string) {
  // the lens dropdown is the one that has this lens as an option (the theme picker is a select too)
  const select = page.locator(`.adg-bar select:has(option[value="${id}"])`).first();
  const label = id[0]!.toUpperCase() + id.slice(1);
  if (await select.count()) await select.selectOption(id);
  else await page.getByRole("button", { name: label, exact: true }).click();
}

/** The plane's rotation about the vertical axis and its tilt, in degrees. */
export const anglesOf = (page: Page) =>
  page.locator(".adg-plane").evaluate((el) => {
    const t = (el as HTMLElement).style.transform;
    return { tilt: parseFloat(t.match(/rotateX\((-?[\d.]+)deg\)/)![1]!), turn: parseFloat(t.match(/rotateZ\((-?[\d.]+)deg\)/)![1]!) };
  });
