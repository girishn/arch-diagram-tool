import { describe, expect, it } from "vitest";
import { THEMES } from "../../src/index.ts";
import { renderToSvg } from "../../src/renderSvg.tsx";
import { EXAMPLES } from "./examples.ts";

// A cheap well-formedness check: every tag opened is closed, in order. Enough to catch an unescaped label or a forgotten close tag.
function wellFormed(xml: string): boolean {
  const stack: string[] = [];
  for (const m of xml.matchAll(/<(\/?)([A-Za-z][\w:-]*)\b[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (m[1]) {
      if (stack.pop() !== m[2]) return false;
    } else stack.push(m[2]!);
  }
  return stack.length === 0;
}

describe("renderToSvg", () => {
  for (const { file, spec } of EXAMPLES)
    it(`${file}: a self-contained SVG with every component and arrow label`, () => {
      const svg = renderToSvg(spec);
      expect(svg.startsWith("<svg ")).toBe(true);
      expect(wellFormed(svg)).toBe(true);
      expect(svg).not.toMatch(/var\(--|color-mix|<script|<style|javascript:/);
      expect(svg).toContain(`<title>`);
      for (const n of spec.nodes) expect(svg, n.id).toContain(`>${n.label.replace(/&/g, "&amp;")}</text>`);
      for (const l of spec.links) expect(svg, l.label).toContain(l.label.toUpperCase().replace(/&/g, "&amp;"));
    });

  it("escapes text from the spec", () => {
    const svg = renderToSvg({ version: 1, title: 'A "<b>" & co', nodes: [{ id: "a", label: "<img onerror=x>", at: { col: 0, row: 0 }, icons: ["unknown"] }], links: [] } as never);
    expect(svg).not.toContain("<img");
    expect(svg).not.toContain("<b>");
    expect(wellFormed(svg)).toBe(true);
  });

  it("draws in every theme with literal colours and can leave off-path labels out", () => {
    const spec = EXAMPLES.find((e) => e.file === "platform-tooling")!.spec;
    for (const t of THEMES) expect(renderToSvg(spec, { theme: t.id })).toContain(t.vars.bg!);
    expect(renderToSvg(spec, { allLabels: false })).not.toContain("SCRAPES /METRICS");
    expect(renderToSvg(spec)).toContain("SCRAPES /METRICS");
  });
});
