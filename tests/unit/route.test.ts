import { describe, expect, it } from "vitest";
import { CARD_ABOVE, PAD, cardHalfWidth, computeLayout } from "../../src/layout.ts";
import { routeLinks } from "../../src/route.ts";
import { measure } from "../../src/measure.ts";
import { EXAMPLES } from "./examples.ts";
import type { DiagramSpec } from "../../src/index.ts";

const route = (spec: DiagramSpec) => {
  const layout = computeLayout(spec, false);
  return { layout, geos: routeLinks(spec, layout, spec.links.map(() => ({ twoWay: false, toOtherFloor: false }))) };
};

describe("routed arrows", () => {
  for (const { file, spec } of EXAMPLES) {
    it(`${file}: every segment is horizontal or vertical, and none runs through a card it does not connect`, () => {
      const { layout, geos } = route(spec);
      geos.forEach((g, i) => {
        if (!g) return;
        const l = spec.links[i]!;
        for (let k = 1; k < g.pts.length; k++) {
          const [a, b] = [g.pts[k - 1]!, g.pts[k]!];
          expect(Math.abs(a[0] - b[0]) < 0.01 || Math.abs(a[1] - b[1]) < 0.01, `${l.from}>${l.to} segment ${k}`).toBe(true);
        }
        for (const n of spec.nodes) {
          if (n.id === l.from || n.id === l.to) continue;
          const c = layout.xy(n.at.col, n.at.row);
          const hw = cardHalfWidth(n);
          for (let k = 1; k < g.pts.length; k++) {
            const [a, b] = [g.pts[k - 1]!, g.pts[k]!];
            const hit = Math.max(a[0], b[0]) > c[0] - hw && Math.min(a[0], b[0]) < c[0] + hw && Math.max(a[1], b[1]) > c[1] - CARD_ABOVE && Math.min(a[1], b[1]) < c[1] + PAD / 2;
            expect(hit, `${l.from}>${l.to} through ${n.id}`).toBe(false);
          }
        }
      });
    });
  }

  it("is deterministic", () => {
    const spec = EXAMPLES.find((e) => e.file === "ai-platform-sim")!.spec;
    expect(route(spec).geos.map((g) => g?.d)).toEqual(route(spec).geos.map((g) => g?.d));
  });

  it("gives arrows that use one side of a card their own spots along it", () => {
    const spec = EXAMPLES.find((e) => e.file === "ai-platform-sim")!.spec;
    const { geos } = route(spec);
    // arrows that arrive at the same card from the same side must not end on the same point
    const ends = new Map<string, string>();
    geos.forEach((g, i) => {
      if (!g) return;
      const last = g.pts[g.pts.length - 1]!;
      const key = `${spec.links[i]!.to}@${Math.round(last[0])},${Math.round(last[1])}`;
      expect(ends.has(key), `two arrows end at ${key}`).toBe(false);
      ends.set(key, spec.links[i]!.id ?? String(i));
    });
  });

  it("removes the arrow through a card that llm-gateway has when drawn straight", () => {
    const spec = EXAMPLES.find((e) => e.file === "llm-gateway")!.spec;
    expect(measure(spec, false, false).throughCards.length).toBeGreaterThan(0);
    const routed = measure(spec, false, true);
    expect(routed.throughCards).toEqual([]);
    expect(routed.overlappingCables()).toEqual([]);
  });

  it("draws no hops, and ends every arrow with a straight stretch long enough for its head", () => {
    for (const { file, spec } of EXAMPLES) {
      const { geos } = route(spec);
      geos.forEach((g, i) => {
        if (!g) return;
        expect(g.d, file).not.toMatch(/ A /);
        const [a, b] = [g.pts[g.pts.length - 2]!, g.pts[g.pts.length - 1]!];
        expect(Math.hypot(a[0] - b[0], a[1] - b[1]), `${file} ${spec.links[i]!.from}>${spec.links[i]!.to} last stretch`).toBeGreaterThanOrEqual(24);
      });
    }
  });

  it("ends an arrow at the pedestal's edge in the isometric views, close enough to touch it", () => {
    const spec = EXAMPLES.find((e) => e.file === "ai-platform-sim")!.spec;
    const layout = computeLayout(spec, false);
    const geos = routeLinks(spec, layout, spec.links.map(() => ({ twoWay: false, toOtherFloor: false })), undefined, undefined, "pedestal");
    geos.forEach((g, i) => {
      if (!g) return;
      const to = spec.nodes.find((n) => n.id === spec.links[i]!.to)!;
      const c = layout.xy(to.at.col, to.at.row);
      const end = g.pts[g.pts.length - 1]!;
      const half = to.icons.length > 1 ? 84 : 40;
      // within 2 px of the pedestal's outline: on one edge, within its extent
      const onEdge = (Math.abs(Math.abs(end[0] - c[0]) - half) <= 3 && Math.abs(end[1] - c[1]) <= 40 + 3) || (Math.abs(Math.abs(end[1] - c[1]) - 40) <= 3 && Math.abs(end[0] - c[0]) <= half + 3);
      expect(onEdge, `${spec.links[i]!.from}>${spec.links[i]!.to} ends ${Math.round(end[0] - c[0])},${Math.round(end[1] - c[1])} from its card`).toBe(true);
    });
  });
});
