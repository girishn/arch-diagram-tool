import { describe, expect, it } from "vitest";
import { resolveZones, validateSpec, withoutPeripherals, zoneExtents } from "../../src/index.ts";
import type { DiagramSpec } from "../../src/index.ts";
import { EXAMPLES } from "./examples.ts";

const contains = (outer: { c0: number; r0: number; c1: number; r1: number }, inner: typeof outer) =>
  outer.c0 <= inner.c0 && outer.r0 <= inner.r0 && outer.c1 >= inner.c1 && outer.r1 >= inner.r1;

describe("zones", () => {
  for (const { file, spec } of EXAMPLES) {
    it(`${file}: every zone contains its members and its child zones, with room to spare`, () => {
      const zones = resolveZones(spec);
      const byId = new Map(zones.map((z) => [z.id, z]));
      for (const z of spec.zones ?? []) {
        const r = byId.get(z.id)!;
        for (const m of z.members ?? []) {
          const n = spec.nodes.find((q) => q.id === m)!;
          expect(r.bounds.c0).toBeLessThan(n.at.col);
          expect(r.bounds.c1).toBeGreaterThan(n.at.col);
          expect(r.bounds.r0).toBeLessThan(n.at.row);
          expect(r.bounds.r1).toBeGreaterThan(n.at.row);
        }
        if (z.parent) {
          const p = byId.get(z.parent)!;
          expect(contains(p.bounds, r.bounds), `${z.parent} contains ${z.id}`).toBe(true);
          expect(p.bounds.c0).toBeLessThan(r.bounds.c0); // strictly bigger, so the edges never coincide
        }
      }
    });
  }

  it("tolerates a parent cycle and unknown ids without throwing", () => {
    const spec = structuredClone(EXAMPLES.find((e) => e.file === "simple-web-app")!.spec);
    spec.zones![0]!.parent = spec.zones![2]!.id;
    spec.zones![2]!.parent = spec.zones![0]!.id;
    spec.zones![1]!.members!.push("ghost");
    expect(() => resolveZones(spec)).not.toThrow();
    expect(() => zoneExtents(spec)).not.toThrow();
  });
});

describe("withoutPeripherals (the view with Tooling off)", () => {
  it("returns the same object when nothing is peripheral", () => {
    const spec = EXAMPLES.find((e) => e.file === "simple-web-app")!.spec;
    expect(withoutPeripherals(spec)).toBe(spec);
  });

  for (const { file, spec } of EXAMPLES.filter((e) => e.spec.nodes.some((n) => n.peripheral))) {
    describe(file, () => {
      const view = withoutPeripherals(spec);
      const ids = new Set(view.nodes.map((n) => n.id));

      it("removes the peripheral nodes and keeps the rest", () => {
        expect(view.nodes.some((n) => n.peripheral)).toBe(false);
        expect(view.nodes.length).toBe(spec.nodes.filter((n) => !n.peripheral).length);
      });

      it("leaves nothing pointing at a removed node", () => {
        expect(view.links.filter((l) => !ids.has(l.from) || !ids.has(l.to))).toEqual([]);
        expect((view.zones ?? []).flatMap((z) => z.members ?? []).filter((m) => !ids.has(m))).toEqual([]);
        expect((view.trace ?? []).filter((t) => !ids.has(t.node))).toEqual([]);
      });

      it("is itself a valid spec", () => {
        expect(validateSpec(view).filter((i) => i.severity === "error")).toEqual([]);
      });

      it("drops zones left empty and keeps the others", () => {
        const kept = new Set((view.zones ?? []).map((z) => z.id));
        for (const z of spec.zones ?? []) {
          const holdsCore = (z.members ?? []).some((m) => ids.has(m)) || (spec.zones ?? []).some((c) => c.parent === z.id && kept.has(c.id));
          expect(kept.has(z.id), z.id).toBe(holdsCore);
        }
      });

      it("is idempotent and does not mutate the original", () => {
        const before = JSON.stringify(spec);
        expect(withoutPeripherals(view)).toBe(view);
        expect(JSON.stringify(spec)).toBe(before);
      });
    });
  }

  it("keeps a zone that has only explicit bounds", () => {
    const spec: DiagramSpec = {
      version: 1,
      title: "t",
      nodes: [
        { id: "a", label: "A", at: { col: 0, row: 0 }, icons: ["compute"] },
        { id: "t", label: "T", at: { col: 1, row: 0 }, icons: ["compute"], peripheral: true },
      ],
      links: [{ from: "a", to: "t", label: "x" }],
      zones: [{ id: "box", label: "Box", bounds: { c0: 0, r0: 0, c1: 1, r1: 1 } }],
    };
    expect(withoutPeripherals(spec).zones?.map((z) => z.id)).toEqual(["box"]);
  });
});
