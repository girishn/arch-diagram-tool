import type { Bounds, DiagramSpec, DiagramZone, ZoneKind } from "./schema.ts";

export type ResolvedZone = {
  id: string;
  label: string;
  kind: ZoneKind;
  parent?: string;
  /** 0 for a top-level zone. */
  depth: number;
  bounds: Bounds;
};

const union = (a: Bounds | undefined, b: Bounds): Bounds =>
  a ? { c0: Math.min(a.c0, b.c0), r0: Math.min(a.r0, b.r0), c1: Math.max(a.c1, b.c1), r1: Math.max(a.r1, b.r1) } : b;

/**
 * Tight bounds of each zone: its explicit `bounds` if given, otherwise the cells of its members
 * plus the extents of its child zones. Zones with nothing to size from are left out.
 * Tolerates unknown ids and cycles; `validateSpec` reports those.
 */
export function zoneExtents(spec: Pick<DiagramSpec, "nodes" | "zones">): Map<string, Bounds> {
  const zones = spec.zones ?? [];
  const cell = new Map(spec.nodes.map((n) => [n.id, n.at]));
  const children = new Map<string, DiagramZone[]>();
  for (const z of zones) if (z.parent) children.set(z.parent, [...(children.get(z.parent) ?? []), z]);
  const out = new Map<string, Bounds>();
  const visiting = new Set<string>();
  const visit = (z: DiagramZone): Bounds | undefined => {
    if (out.has(z.id)) return out.get(z.id);
    if (visiting.has(z.id)) return undefined;
    visiting.add(z.id);
    let b: Bounds | undefined = z.bounds;
    if (!b) {
      for (const m of z.members ?? []) {
        const at = cell.get(m);
        if (at) b = union(b, { c0: at.col, r0: at.row, c1: at.col, r1: at.row });
      }
      for (const c of children.get(z.id) ?? []) {
        const cb = visit(c);
        if (cb) b = union(b, cb);
      }
    }
    visiting.delete(z.id);
    if (b) out.set(z.id, b);
    return b;
  };
  zones.forEach(visit);
  return out;
}

/**
 * Zones ready to draw: extents padded so each parent sits outside its children.
 * Padding is 0.42 cell for a leaf zone plus 0.09 per level of nesting below it. Explicit `bounds` are used as given.
 */
export function resolveZones(spec: Pick<DiagramSpec, "nodes" | "zones">): ResolvedZone[] {
  const zones = spec.zones ?? [];
  const byId = new Map(zones.map((z) => [z.id, z]));
  const extents = zoneExtents(spec);
  const chain = (z: DiagramZone): DiagramZone[] => {
    const out: DiagramZone[] = [];
    for (let p = z.parent ? byId.get(z.parent) : undefined; p && out.length < zones.length; p = p.parent ? byId.get(p.parent) : undefined)
      out.push(p);
    return out;
  };
  // height = longest run of descendants below a zone
  const height = new Map<string, number>();
  for (const z of zones)
    chain(z).forEach((anc, i) => height.set(anc.id, Math.max(height.get(anc.id) ?? 0, i + 1)));
  return zones.flatMap((z) => {
    const e = extents.get(z.id);
    if (!e) return [];
    const pad = z.bounds ? 0 : 0.42 + 0.09 * (height.get(z.id) ?? 0);
    return [
      {
        id: z.id,
        label: z.label,
        kind: z.kind ?? "group",
        parent: z.parent,
        depth: chain(z).length,
        bounds: { c0: e.c0 - pad, r0: e.r0 - pad, c1: e.c1 + pad, r1: e.r1 + pad },
      },
    ];
  });
}
