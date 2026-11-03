import type { DiagramSpec } from "./schema.ts";

/**
 * The spec as drawn with the "Tooling" toggle off: peripheral nodes, the links that touch them, and any zone left with
 * nothing to hold are removed, so the plane, zones, cables and zoom fit are all worked out from what remains.
 * A zone survives if it has a visible member or a surviving child zone; a zone sized only by explicit `bounds` always does.
 * Returns the same object when there is nothing to hide.
 */
export function withoutPeripherals(spec: DiagramSpec): DiagramSpec {
  const hide = new Set(spec.nodes.filter((n) => n.peripheral).map((n) => n.id));
  if (!hide.size) return spec;

  const zones = spec.zones ?? [];
  const kids = new Map<string, string[]>();
  for (const z of zones) if (z.parent) kids.set(z.parent, [...(kids.get(z.parent) ?? []), z.id]);
  const memo = new Map<string, boolean>();
  const survives = (id: string): boolean => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    memo.set(id, false); // guards against a parent cycle in an unvalidated spec
    const z = zones.find((q) => q.id === id);
    const isSizedByBoundsOnly = !z?.members?.length && !kids.get(id)?.length;
    const result = isSizedByBoundsOnly || !!z?.members?.some((m) => !hide.has(m)) || !!kids.get(id)?.some(survives);
    memo.set(id, result);
    return result;
  };

  const keep = (ids?: string[]) => ids?.filter((m) => !hide.has(m));
  return {
    ...spec,
    nodes: spec.nodes
      .filter((n) => !hide.has(n.id))
      .map((n) => (n.detail?.mentions ? { ...n, detail: { ...n.detail, mentions: keep(n.detail.mentions) } } : n)),
    links: spec.links
      .filter((l) => !hide.has(l.from) && !hide.has(l.to))
      .map((l) => (l.mentions ? { ...l, mentions: keep(l.mentions) } : l)),
    zones: zones.filter((z) => survives(z.id)).map((z) => (z.members ? { ...z, members: z.members.filter((m) => !hide.has(m)) } : z)),
    trace: spec.trace?.filter((t) => !hide.has(t.node)),
    prose: spec.prose?.map((b) => ({ ...b, mentions: keep(b.mentions) ?? [] })),
  };
}

/** The id of the card that stands for a collapsed container. */
export const collapsedId = (zoneId: string) => `zone:${zoneId}`;

/**
 * The spec as drawn with some containers collapsed: each collapsed container (with everything nested in it) becomes one card,
 * arrows that ran inside it disappear, and arrows to the same place merge into one that says how many it stands for. Rows and
 * columns the collapse emptied close up, so the diagram gets smaller, not just sparser. Nothing in the spec changes; this is a view.
 * A collapsed container inside another collapsed one is part of the outer one. Returns the same object when nothing collapses.
 */
export function collapseZones(spec: DiagramSpec, ids: ReadonlySet<string>): DiagramSpec {
  const zones = spec.zones ?? [];
  if (!ids.size || !zones.length) return spec;
  const kids = new Map<string, string[]>();
  for (const z of zones) if (z.parent) kids.set(z.parent, [...(kids.get(z.parent) ?? []), z.id]);
  const inside = (id: string, seen = new Set<string>()): Set<string> => {
    const out = new Set<string>();
    if (seen.has(id)) return out;
    seen.add(id);
    for (const m of zones.find((z) => z.id === id)?.members ?? []) out.add(m);
    for (const k of kids.get(id) ?? []) for (const m of inside(k, seen)) out.add(m);
    return out;
  };
  const hasCollapsedAncestor = (z: (typeof zones)[number]) => {
    let up = z.parent;
    for (let guard = 0; up && guard < 20; guard++) {
      if (ids.has(up)) return true;
      up = zones.find((q) => q.id === up)?.parent;
    }
    return false;
  };
  const nodeById = new Map(spec.nodes.map((n) => [n.id, n]));
  const roots = zones.filter((z) => ids.has(z.id) && !hasCollapsedAncestor(z) && [...inside(z.id)].some((m) => nodeById.has(m)));
  if (!roots.length) return spec;

  const groupOf = new Map<string, string>();
  const gone = new Set<string>();
  const synthetic: DiagramSpec["nodes"] = [];
  for (const z of roots) {
    const members = [...inside(z.id)].map((m) => nodeById.get(m)).filter((n): n is NonNullable<typeof n> => !!n);
    const id = collapsedId(z.id);
    const cx = members.reduce((t, n) => t + n.at.col, 0) / members.length;
    const cy = members.reduce((t, n) => t + n.at.row, 0) / members.length;
    const at = members.reduce((best, n) => (Math.hypot(n.at.col - cx, n.at.row - cy) < Math.hypot(best.at.col - cx, best.at.row - cy) ? n : best)).at; // a cell the members held, so it is free
    const names = members.slice(0, 4).map((n) => n.label).join(", ");
    synthetic.push({
      id,
      label: z.label,
      sub: `${members.length} components`,
      at: { ...at },
      icons: ["container"],
      layer: members.find((n) => n.layer)?.layer,
      detail: {
        tag: `${z.kind ?? "group"}, collapsed`,
        role: `Stands for ${members.length} components: ${names}${members.length > 4 ? ` and ${members.length - 4} more` : ""}.`,
        why: "Collapsed to keep the diagram readable. Arrows to the same place are merged. Expand it to see the parts.",
      },
    });
    for (const m of members) groupOf.set(m.id, id);
    gone.add(z.id);
    const walk = (zid: string) => {
      for (const k of kids.get(zid) ?? []) {
        gone.add(k);
        walk(k);
      }
    };
    walk(z.id);
  }

  const map = (id: string) => groupOf.get(id) ?? id;
  const mapIds = (list?: string[]) => (list ? [...new Set(list.map(map))] : list);

  // arrows: those inside one collapsed container vanish; those between the same two ends merge
  const links: DiagramSpec["links"] = [];
  const merged = new Map<string, number>();
  const parts = new Map<string, typeof spec.links>();
  for (const l of spec.links) {
    const [from, to] = [map(l.from), map(l.to)];
    if (from === to && (groupOf.has(l.from) || groupOf.has(l.to))) continue;
    if (from === l.from && to === l.to) {
      links.push(l.mentions ? { ...l, mentions: mapIds(l.mentions) } : l);
      continue;
    }
    const key = `${from}>${to}`;
    const at = merged.get(key);
    if (at === undefined) {
      merged.set(key, links.length);
      parts.set(key, [l]);
      links.push({ ...l, from, to, via: undefined, labelAt: undefined, mentions: mapIds(l.mentions) });
    } else parts.get(key)!.push(l);
  }
  for (const [key, at] of merged) {
    const group = parts.get(key)!;
    if (group.length < 2) continue;
    const first = group[0]!;
    links[at] = {
      from: map(first.from),
      to: map(first.to),
      label: `${group.length} connections`,
      detail: `Merged: ${group.map((l) => l.label).join("; ")}.`,
      plane: group.every((l) => l.plane === first.plane) ? first.plane : undefined,
      pattern: group.every((l) => l.pattern === first.pattern) ? first.pattern : undefined,
      interaction: group.every((l) => l.interaction === first.interaction) ? first.interaction : undefined,
      traffic: group.every((l) => l.traffic === first.traffic) ? first.traffic : undefined,
      twoWay: group.every((l) => l.twoWay) || undefined,
      offPath: group.every((l) => l.offPath) || undefined,
    };
  }

  // containers: the collapsed ones and what they held are gone; the one around a collapsed container now holds its card
  const newZones = zones
    .filter((z) => !gone.has(z.id))
    .map((z) => {
      const added = roots.filter((r) => r.parent === z.id).map((r) => collapsedId(r.id));
      return z.members || added.length ? { ...z, members: [...(z.members ?? []).filter((m) => !groupOf.has(m)), ...added] } : z;
    });

  const nodes = [...spec.nodes.filter((n) => !groupOf.has(n.id)).map((n) => (n.detail?.mentions ? { ...n, detail: { ...n.detail, mentions: mapIds(n.detail.mentions) } } : n)), ...synthetic];

  // rows and columns the collapse emptied close up (values that held a card before and hold none now)
  const closing = (pick: (c: { col: number; row: number }) => number) => {
    const before = new Set(spec.nodes.map((n) => pick(n.at)));
    const after = new Set(nodes.map((n) => pick(n.at)));
    const dropped = [...before].filter((v) => !after.has(v)).sort((a, b) => a - b);
    return (v: number) => v - dropped.filter((d) => d < v).length;
  };
  const [shiftCol, shiftRow] = [closing((c) => c.col), closing((c) => c.row)];
  const shifted = nodes.map((n) => ({ ...n, at: { col: shiftCol(n.at.col), row: shiftRow(n.at.row) } }));
  const shiftPt = (p: [number, number]): [number, number] => [shiftCol(p[0]), shiftRow(p[1])];

  const trace: DiagramSpec["trace"] = [];
  for (const t of spec.trace ?? []) {
    const node = map(t.node);
    if (trace[trace.length - 1]?.node !== node) trace.push({ ...t, node });
  }

  return {
    ...spec,
    nodes: shifted,
    links: links.map((l) => ({ ...l, via: l.via?.map(shiftPt), labelAt: l.labelAt ? shiftPt(l.labelAt) : undefined })),
    zones: newZones.map((z) => (z.bounds ? { ...z, bounds: { c0: shiftCol(z.bounds.c0), c1: shiftCol(z.bounds.c1), r0: shiftRow(z.bounds.r0), r1: shiftRow(z.bounds.r1) } } : z)),
    trace: spec.trace ? trace : undefined,
    prose: spec.prose?.map((b) => ({ ...b, mentions: mapIds(b.mentions) ?? [] })),
  };
}

/**
 * Ready-made collapse sets, coarsest first: level 1 collapses the outermost containers (each becomes one card), and each further level
 * opens one more tier, down to the last level, where every innermost container is a card. A container that is a leaf shallower than the
 * level collapses too, so no tier is left half open. Only containers holding two or more components count.
 */
export function collapseLevels(spec: DiagramSpec): ReadonlySet<string>[] {
  const zones = spec.zones ?? [];
  const ids = new Set(spec.nodes.map((n) => n.id));
  const kids = new Map<string, string[]>();
  for (const z of zones) if (z.parent) kids.set(z.parent, [...(kids.get(z.parent) ?? []), z.id]);
  const size = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    return (zones.find((z) => z.id === id)?.members ?? []).filter((m) => ids.has(m)).length + (kids.get(id) ?? []).reduce((t, k) => t + size(k, seen), 0);
  };
  const depth = (id: string): number => {
    let d = 0;
    for (let up = zones.find((z) => z.id === id)?.parent; up && d < 20; up = zones.find((z) => z.id === up)?.parent) d++;
    return d;
  };
  const eligible = zones.filter((z) => size(z.id) >= 2);
  if (!eligible.length) return [];
  const n = Math.max(...eligible.map((z) => depth(z.id))) + 1;
  return Array.from({ length: n }, (_, i) => new Set(eligible.filter((z) => depth(z.id) === i || (depth(z.id) < i && !(kids.get(z.id) ?? []).some((k) => size(k) >= 2))).map((z) => z.id)));
}
