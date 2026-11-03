import { describe, expect, it } from "vitest";
import { computeLayout, zoneRects } from "../../src/layout.ts";
import { EXAMPLES } from "./examples.ts";
import { measureLayout } from "../../src/measure.ts";

// Zone labels that are known to find no clear spot (backlog: zone label follow-ups). Anything new here is a regression.
const KNOWN_UNCLEAR: Record<string, string[]> = { "platform-tooling:portrait": ["asg"] };

// Crossings and bends may only go down. When a layout change lowers one, lower the number here so the gain is kept; never raise it.
// (Measured 2026-10-30. The hospital example crosses four pairs of off-path links; the renderer fades those cables until they are pointed at.)
/** Per example: the most crossings, bends, arrows through a card they do not connect, and arrows sharing a stretch of line that it may have. Only ever lower these. */
const BASELINE: Record<string, { crossings: number; bends: number; through?: number; shared?: number }> = {
  "ai-platform-sim": { crossings: 2, bends: 1 },
  "llm-gateway": { crossings: 0, bends: 0, through: 1, shared: 1 },
  "hospital-event-backbone": { crossings: 4, bends: 0 },
  "load-balanced-egress": { crossings: 0, bends: 0 },
  "platform-stack": { crossings: 0, bends: 0 },
  "platform-tooling": { crossings: 0, bends: 1 },
  "simple-web-app": { crossings: 0, bends: 1 },
};

describe("crossings and bends never get worse", () => {
  for (const { file, spec } of EXAMPLES) {
    for (const portrait of [false, true]) {
      it(`${file} (${portrait ? "portrait" : "landscape"})`, () => {
        const m = measureLayout(spec, portrait);
        const base = BASELINE[file] ?? { crossings: 0, bends: 0 };
        expect(m.crossings.map(([x, y]) => `${x.from}>${x.to} x ${y.from}>${y.to}`).length).toBeLessThanOrEqual(base.crossings);
        expect(m.totalBends).toBeLessThanOrEqual(base.bends);
        expect(m.throughCards.map((t) => `${t.link.from}>${t.link.to} through ${t.node.id}`).length, "arrows through a card").toBeLessThanOrEqual(base.through ?? 0);
        expect(m.overlappingCables().length, "arrows sharing a line").toBeLessThanOrEqual(base.shared ?? 0);
      });
    }
  }

  it("finds an arrow that runs through a card, and two arrows on one line", () => {
    const node = (id: string, col: number, row: number) => ({ id, label: id, icons: ["unknown"], at: { col, row } });
    // a, b, c in a row: a>c passes straight through b, and lies on top of a>b
    const spec = { nodes: [node("a", 0, 0), node("b", 1, 0), node("c", 2, 0)], links: [{ from: "a", to: "c", label: "long" }, { from: "a", to: "b", label: "short" }] };
    const m = measureLayout(spec as never, false);
    expect(m.throughCards.map((t) => `${t.link.label}:${t.node.id}`)).toEqual(["long:b"]);
    expect(m.overlappingCables()).toHaveLength(1);
    const apart = measureLayout({ ...spec, nodes: [node("a", 0, 0), node("b", 1, 1), node("c", 2, 0)] } as never, false);
    expect(apart.throughCards).toHaveLength(0);
    expect(apart.overlappingCables()).toHaveLength(0);
  });

  it("counts a plain X as one crossing, and ignores cables that share a component", () => {
    const node = (id: string, col: number, row: number) => ({ id, label: id, icons: ["unknown"], at: { col, row } });
    const x = measureLayout({ nodes: [node("a", 0, 0), node("b", 1, 1), node("c", 1, 0), node("d", 0, 1)], links: [{ from: "a", to: "b", label: "1" }, { from: "c", to: "d", label: "2" }] } as never, false);
    expect(x.crossings).toHaveLength(1);
    const fan = measureLayout({ nodes: [node("a", 0, 0), node("b", 1, 0), node("c", 1, 1)], links: [{ from: "a", to: "b", label: "1" }, { from: "a", to: "c", label: "2" }] } as never, false);
    expect(fan.crossings).toHaveLength(0);
  });
});

for (const { file, spec } of EXAMPLES) {
  for (const portrait of [false, true]) {
    const name = `${file} (${portrait ? "portrait" : "landscape"})`;

    describe(name, () => {
      const m = measureLayout(spec, portrait);

      it("hides no cable behind its label chip", () => {
        // Under 40 px of a short cable showing means the chip is covering the line, arrowhead and flow.
        expect(m.coveredCables(40).map((x) => `${x.link.from}>${x.link.to} "${x.link.label}" ${Math.round(x.visible)}px`)).toEqual([]);
      });

      it("has no overlapping label chips", () => {
        expect(m.overlappingChips.map(([a, b]) => `"${a.label}" x "${b.label}"`)).toEqual([]);
      });

      it("finds a clear spot for every zone label except the known ones", () => {
        expect(m.unclearZoneLabels).toEqual(KNOWN_UNCLEAR[`${file}:${portrait ? "portrait" : "landscape"}`] ?? []);
      });

      it("keeps every node and zone inside the plane", () => {
        const { layout } = m;
        for (const n of spec.nodes) {
          const [x, y] = layout.xy(n.at.col, n.at.row);
          expect(x).toBeGreaterThan(0);
          expect(x).toBeLessThan(layout.W);
          expect(y).toBeGreaterThan(0);
          expect(y).toBeLessThan(layout.H);
        }
        for (const z of zoneRects(spec, layout)) {
          expect(z.left, `${z.id} left`).toBeGreaterThanOrEqual(-1);
          expect(z.top, `${z.id} top`).toBeGreaterThanOrEqual(-1);
          expect(z.left + z.width, `${z.id} right`).toBeLessThanOrEqual(layout.W + 1);
          expect(z.top + z.height, `${z.id} bottom`).toBeLessThanOrEqual(layout.H + 1);
        }
      });

      it("is deterministic", () => {
        const again = measureLayout(spec, portrait);
        expect(again.links.map((l) => l.box)).toEqual(m.links.map((l) => l.box));
        expect([again.layout.W, again.layout.H]).toEqual([m.layout.W, m.layout.H]);
      });
    });
  }
}

describe("spacing", () => {
  it("never packs side-by-side cards closer than the base spacing", () => {
    for (const { spec } of EXAMPLES) {
      for (const portrait of [false, true]) {
        const layout = computeLayout(spec, portrait);
        const base = portrait ? 170 : 216;
        for (const a of spec.nodes)
          for (const b of spec.nodes) {
            const [ia, ib] = portrait ? [a.at.row, b.at.row] : [a.at.col, b.at.col];
            const [ja, jb] = portrait ? [a.at.col, b.at.col] : [a.at.row, b.at.row];
            if (ja !== jb || ib - ia !== 1) continue;
            expect(layout.xy(b.at.col, b.at.row)[0] - layout.xy(a.at.col, a.at.row)[0]).toBeGreaterThanOrEqual(base - 0.001);
          }
      }
    }
  });

  it("widens a gap for a long label, and only that gap", () => {
    const spec = structuredClone(EXAMPLES.find((e) => e.file === "simple-web-app")!.spec);
    const gap = (s: typeof spec, from: string, to: string) => {
      const l = computeLayout(s, false);
      const [a, b] = [from, to].map((id) => s.nodes.find((n) => n.id === id)!);
      return l.xy(b!.at.col, b!.at.row)[0] - l.xy(a!.at.col, a!.at.row)[0];
    };
    const before = { apiFn: gap(spec, "api", "fn"), fnDb: gap(spec, "fn", "db") };
    spec.links.find((l) => l.from === "api" && l.to === "fn")!.label = "A deliberately very long arrow label here";
    expect(gap(spec, "api", "fn")).toBeGreaterThan(before.apiFn + 100);
    expect(gap(spec, "fn", "db")).toBe(before.fnDb);
  });
});
