import type { DiagramSpec } from "../src/index.ts";

/**
 * A made-up spec of `n` components on a grid, for measuring render cost (`?bench=40` on the demo page, `npm run bench`).
 * Each row is a left-to-right chain and rows are joined at their first column, so there are no crossings and the trace
 * can walk any prefix. Every component carries a short explanation and two lens facts, as a real spec would.
 */
export function syntheticSpec(n: number): DiagramSpec {
  const cols = Math.max(2, Math.ceil(Math.sqrt(n * 1.6)));
  const id = (i: number) => `n${i}`;
  const nodes = Array.from({ length: n }, (_, i) => ({
    id: id(i),
    label: `Service ${i}`,
    sub: "Synthetic",
    at: { col: i % cols, row: Math.floor(i / cols) },
    icons: [["compute", "database", "queue", "cache", "function"][i % 5]!],
    detail: { role: `Does job ${i}.`, why: "Exists so the benchmark has something to draw." },
    lenses: {
      security: { badge: "Private", text: "Reachable only from inside.", level: "good" as const },
      cost: { badge: "Steady", text: "Flat monthly cost.", level: "info" as const },
    },
  }));
  const links: DiagramSpec["links"] = [];
  for (let i = 0; i < n; i++) {
    if (i % cols !== cols - 1 && i + 1 < n) links.push({ from: id(i), to: id(i + 1), label: `Call ${i}`, protocol: "HTTP", detail: "A synthetic call." });
    else if (i % cols === 0 && i + cols < n) links.push({ from: id(i), to: id(i + cols), label: `Down ${i}`, protocol: "HTTP", detail: "A synthetic call." });
  }
  for (let i = 0; i + cols < n; i += cols) if (!links.some((l) => l.from === id(i) && l.to === id(i + cols))) links.push({ from: id(i), to: id(i + cols), label: `Down ${i}`, protocol: "HTTP", detail: "A synthetic call." });
  return {
    version: 1,
    title: `Synthetic ${n}-component system`,
    lenses: [{ id: "security" }, { id: "cost" }],
    nodes,
    links,
    zones: [],
    trace: Array.from({ length: Math.min(n, cols) }, (_, i) => ({ node: id(i), label: `Step ${i + 1}` })),
  } as DiagramSpec;
}
