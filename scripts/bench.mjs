// Render-cost bench: `npm run bench` (builds the demo, serves it, drives Chromium over synthetic systems of 10 to 200 components).
// Numbers depend on the machine, so compare runs on the same one. Prints a table; exits 0 always (it measures, it does not gate).
import { chromium } from "@playwright/test";
import { spawn, execSync } from "node:child_process";

const PORT = 5191;
const SIZES = (process.argv[2] ?? "10,40,100,200").split(",").map(Number);
execSync("npx vite build", { stdio: "ignore" });
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore", shell: true });
const base = `http://localhost:${PORT}/`;
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(base)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const browser = await chromium.launch();
const rows = [];
for (const n of SIZES) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    window.__long = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long += e.duration; }).observe({ entryTypes: ["longtask"] });
  });
  const t0 = Date.now();
  await page.goto(`${base}?bench=${n}`);
  await page.locator(".adg-card").first().waitFor({ state: "attached" });
  await page.waitForFunction((k) => document.querySelectorAll(".adg-card").length >= k, n);
  const mount = Date.now() - t0;
  await page.waitForTimeout(500);

  // hover: time from the pointer arriving on a card to the next painted frame
  const cards = page.locator(".adg-card");
  const hover = [];
  for (let i = 0; i < 8; i++) {
    const box = await cards.nth(Math.floor((i * n) / 8)).boundingBox();
    if (!box) continue;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
    hover.push(await page.evaluate(() => new Promise((res) => { const s = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => res(performance.now() - s))); })));
  }

  // view switch: click, then wait two frames
  const sw = [];
  for (const name of ["Top view", "Isometric", "Top view", "Isometric"]) {
    const t = await page.evaluate(() => performance.now());
    await page.getByRole("button", { name, exact: true }).click();
    sw.push(await page.evaluate((s) => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(performance.now() - s)))), t));
    await page.waitForTimeout(900);
  }

  // frame pacing while the trace plays
  await page.evaluate(() => { window.__long = 0; });
  await page.getByRole("button", { name: "Start the trace" }).click();
  await page.getByRole("button", { name: /^Play/ }).click().catch(() => {});
  const fps = await page.evaluate(() => new Promise((res) => {
    let frames = 0; const s = performance.now();
    const tick = (t) => { frames++; if (t - s < 2000) requestAnimationFrame(tick); else res((frames * 1000) / (t - s)); };
    requestAnimationFrame(tick);
  }));
  const long = await page.evaluate(() => window.__long);
  const dom = await page.evaluate(() => document.querySelectorAll("*").length);
  rows.push({ components: n, "DOM nodes": dom, "mount ms": mount, "hover ms (median)": Math.round(median(hover)), "view switch ms (median)": Math.round(median(sw)), "trace fps": Math.round(fps), "long-task ms": Math.round(long) });
  await page.close();
}
console.table(rows);
await browser.close();
server.kill();
try { execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: "ignore" }); } catch {}
process.exit(0);
