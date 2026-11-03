import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { collapseLevels, collapseZones, collapsedId, computeLayout, routeLinks, validateSpec } from "../../src/core.ts";
import { EXAMPLES } from "./examples.ts";
import type { DiagramSpec } from "../../src/index.ts";

const stress = readdirSync(new URL("../../examples/stress/", import.meta.url))
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({ file: `stress/${f.replace(/\.json$/, "")}`, spec: JSON.parse(readFileSync(new URL(`../../examples/stress/${f}`, import.meta.url), "utf8")) as DiagramSpec }));
const ALL = [...EXAMPLES, ...stress];
const leafZones = (spec: DiagramSpec) => (spec.zones ?? []).filter((z) => !(spec.zones ?? []).some((q) => q.parent === z.id) && (z.members?.length ?? 0) >= 2).map((z) => z.id);

describe("collapsing containers", () => {
  it("returns the same spec when nothing is collapsed", () => {
    const spec = EXAMPLES[0]!.spec;
    expect(collapseZones(spec, new Set())).toBe(spec);
    expect(collapseZones(spec, new Set(["nope"]))).toBe(spec);
  });

  for (const { file, spec } of ALL) {
    const ids = leafZones(spec);
    if (!ids.length) continue;
    it(`${file}: collapsing every leaf container gives a valid, smaller spec that still routes`, () => {
      const out = collapseZones(spec, new Set(ids));
      const errors = validateSpec(out).filter((i) => i.severity === "error");
      expect(errors, JSON.stringify(errors.slice(0, 3))).toEqual([]);
      expect(out.nodes.length).toBeLessThan(spec.nodes.length);
      expect(out.links.length).toBeLessThanOrEqual(spec.links.length);
      for (const id of ids) expect(out.nodes.some((n) => n.id === collapsedId(id))).toBe(true);
      const layout = computeLayout(out, false);
      const geos = routeLinks(out, layout, out.links.map(() => ({ twoWay: false, toOtherFloor: false })));
      expect(geos.filter((g) => !g).length).toBe(0);
    });
  }

  it("merges parallel arrows and drops the ones inside, and closes the emptied rows", () => {
    const spec = ALL.find((e) => e.file === "stress/retail-omnichannel")!.spec;
    const ids = leafZones(spec);
    const out = collapseZones(spec, new Set(ids));
    expect(out.links.some((l) => /connections$/.test(l.label))).toBe(true);
    const rows = (s: DiagramSpec) => new Set(s.nodes.map((n) => n.at.row)).size;
    expect(rows(out)).toBeLessThanOrEqual(rows(spec));
    // the trace never repeats a card back to back
    const t = out.trace ?? [];
    t.forEach((s, i) => expect(s.node === t[i - 1]?.node).toBe(false));
  });

  it("offers levels, coarsest first, that never leave a tier half open", () => {
    for (const { file, spec } of ALL) {
      const levels = collapseLevels(spec);
      if (!levels.length) continue;
      const counts = levels.map((l) => collapseZones(spec, l).nodes.length);
      counts.forEach((c, i) => { if (i) expect(c, `${file} level ${i + 1} has at least as many cards as level ${i}`).toBeGreaterThanOrEqual(counts[i - 1]!); });
      for (const l of levels) expect(validateSpec(collapseZones(spec, l)).filter((x) => x.severity === "error")).toEqual([]);
    }
    const nested = ALL.find((e) => e.file === "stress/hybrid-landing-zone")!.spec;
    const sizes = collapseLevels(nested).map((l) => collapseZones(nested, l).nodes.length);
    expect(sizes.length).toBeGreaterThanOrEqual(2);
    expect(sizes[0]!).toBeLessThan(sizes[sizes.length - 1]!);
  });
});
