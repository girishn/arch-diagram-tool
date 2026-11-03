import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeLayout, validateSpec, withoutPeripherals } from "../../src/index.ts";
import type { DiagramSpec } from "../../src/index.ts";
import { measureLayout } from "../../src/measure.ts";

// Random but valid specs: distinct grid cells, links between distinct existing nodes, no waypoints (so every link is a plain straight or
// L-shaped cable), a few nodes marked peripheral. The properties are layout invariants that must hold for any such spec.

const label = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{2,24}$/);

const spec = fc
  .uniqueArray(fc.tuple(fc.integer({ min: 0, max: 5 }), fc.integer({ min: 0, max: 3 })), { minLength: 2, maxLength: 8, selector: ([c, r]) => `${c},${r}` })
  .chain((cells) =>
    fc.record({
      cells: fc.constant(cells),
      labels: fc.array(label, { minLength: cells.length, maxLength: cells.length }),
      peripheral: fc.array(fc.boolean(), { minLength: cells.length, maxLength: cells.length }),
      pairs: fc.array(fc.tuple(fc.nat(cells.length - 1), fc.nat(cells.length - 1)), { maxLength: 10 }),
      linkLabels: fc.array(label, { minLength: 10, maxLength: 10 }),
    }),
  )
  .map(({ cells, labels, peripheral, pairs, linkLabels }): DiagramSpec => {
    const seen = new Set<string>();
    return {
      version: 1,
      title: "Generated",
      nodes: cells.map(([col, row], i) => ({
        id: `n${i}`,
        label: labels[i]!,
        at: { col, row },
        icons: ["compute"],
        detail: { role: "r", why: "w" },
        // node 0 stays core so something is always left when tooling is hidden
        ...(i > 0 && peripheral[i] ? { peripheral: true } : {}),
      })),
      links: pairs.flatMap(([a, b], i) => {
        const key = `${a}>${b}`;
        if (a === b || seen.has(key)) return [];
        seen.add(key);
        return [{ from: `n${a}`, to: `n${b}`, label: linkLabels[i]!, detail: "d" }];
      }),
    };
  });

const runs = { numRuns: 150 };

describe("layout invariants over random specs", () => {
  it("the generator only makes specs the validator accepts", () => {
    fc.assert(
      fc.property(spec, (s) => validateSpec(s).every((i) => i.severity !== "error")),
      runs,
    );
  });

  it("is deterministic, and keeps every node inside the plane", () => {
    fc.assert(
      fc.property(spec, fc.boolean(), (s, portrait) => {
        const a = computeLayout(s, portrait);
        const b = computeLayout(s, portrait);
        expect([a.W, a.H]).toEqual([b.W, b.H]);
        for (const n of s.nodes) {
          const p = a.xy(n.at.col, n.at.row);
          expect(p).toEqual(b.xy(n.at.col, n.at.row));
          expect(p[0]).toBeGreaterThan(0);
          expect(p[0]).toBeLessThan(a.W);
          expect(p[1]).toBeGreaterThan(0);
          expect(p[1]).toBeLessThan(a.H);
        }
      }),
      runs,
    );
  });

  it("never leaves a side-by-side cable hidden behind its chip", () => {
    fc.assert(
      fc.property(spec, fc.boolean(), (s, portrait) => {
        const m = measureLayout(s, portrait);
        const at = (id: string) => s.nodes.find((n) => n.id === id)!.at;
        for (const x of m.links) {
          const a = at(x.link.from);
          const b = at(x.link.to);
          const sideBySide = portrait ? a.col === b.col && Math.abs(a.row - b.row) === 1 : a.row === b.row && Math.abs(a.col - b.col) === 1;
          // 48 is the margin the spacing is built to leave (24 either side of the chip); allow a pixel of float noise.
          if (sideBySide) expect(x.visible).toBeGreaterThanOrEqual(47);
        }
      }),
      runs,
    );
  });

  it("keeps cards side by side at least the base spacing apart", () => {
    fc.assert(
      fc.property(spec, fc.boolean(), (s, portrait) => {
        const l = computeLayout(s, portrait);
        const base = portrait ? 170 : 216;
        for (const a of s.nodes)
          for (const b of s.nodes) {
            const [ia, ib, ja, jb] = portrait ? [a.at.row, b.at.row, a.at.col, b.at.col] : [a.at.col, b.at.col, a.at.row, b.at.row];
            if (ja === jb && ib - ia === 1) expect(l.xy(b.at.col, b.at.row)[0] - l.xy(a.at.col, a.at.row)[0]).toBeGreaterThanOrEqual(base - 0.001);
          }
      }),
      runs,
    );
  });
});

describe("the Tooling-off view over random specs", () => {
  it("is a valid, self-consistent spec and is idempotent", () => {
    fc.assert(
      fc.property(spec, (s) => {
        const view = withoutPeripherals(s);
        const ids = new Set(view.nodes.map((n) => n.id));
        expect(view.nodes.length).toBeGreaterThan(0);
        expect(view.nodes.some((n) => n.peripheral)).toBe(false);
        expect(view.links.every((l) => ids.has(l.from) && ids.has(l.to))).toBe(true);
        expect(validateSpec(view).filter((i) => i.severity === "error")).toEqual([]);
        expect(withoutPeripherals(view)).toBe(view);
      }),
      runs,
    );
  });
});
