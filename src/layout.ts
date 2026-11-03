import type { DiagramLink, DiagramNode, DiagramSpec, ZoneKind } from "./schema.ts";
import { resolveLink } from "./resolve.ts";
import { resolveZones } from "./zones.ts";

/** Pure geometry: grid cells to plane pixels, cable paths, label placement and routing. No DOM, no React. */

export type XY = [number, number];

export const TILE = 72; // icon size in the plane
export const PAD = TILE + 34; // pedestal under each component
export const CARD_ABOVE = 120; // how far a card's name plate and sub-label reach above its anchor

export type Layout = {
  portrait: boolean;
  /** Plane size in pixels. */
  W: number;
  H: number;
  /** Grid cell (fractions allowed) to plane pixels. */
  xy: (c: number, r: number) => XY;
};

/** How wide an arrow's label chip is, from its text (mono 10px caps plus padding; an IN/OUT tag adds a little). */
export const chipWidth = (l: Pick<DiagramLink, "label" | "traffic">) =>
  l.label.length * 6.8 + 22 + (l.traffic === "ingress" || l.traffic === "egress" ? 22 : 0);

// A cable between two cards side by side runs from pad edge to pad edge; this is what the trimming takes off it.
const SIDE_BY_SIDE_TRIM = PAD + 12;
// The cable must stay visible this far beyond each end of its chip, so the arrowhead and flow dashes show.
const CABLE_BEYOND_CHIP = 24;

/**
 * The plane covers every node, waypoint and zone, with a margin on all sides.
 * Landscape flows left to right; portrait (phones) flows top to bottom.
 *
 * Spacing across the screen is not fixed: two cards side by side get a gap wide enough that their arrow's label chip
 * sits on the cable with the arrowhead and flow still showing either side. Every other gap keeps the base spacing.
 */
export function computeLayout(spec: Pick<DiagramSpec, "nodes" | "links" | "zones">, portrait: boolean): Layout {
  const cw = portrait ? 170 : 216;
  const ch = portrait ? 262 : 270; // rows leave room for a label between two cards, with cable showing either side
  const padC = 0.78; // margin around nodes, in grid units (columns always run along the flow)
  const padR = 0.8;
  const zonePad = 0.45; // margin around the outermost zone, enough for the pixel growth in zoneRects

  let c0 = Infinity;
  let c1 = -Infinity;
  let r0 = Infinity;
  let r1 = -Infinity;
  const grow = (c: number, r: number, pc: number, pr: number) => {
    c0 = Math.min(c0, c - pc);
    c1 = Math.max(c1, c + pc);
    r0 = Math.min(r0, r - pr);
    r1 = Math.max(r1, r + pr);
  };
  for (const n of spec.nodes) grow(n.at.col, n.at.row, padC, padR);
  for (const l of spec.links) {
    for (const [c, r] of l.via ?? []) grow(c, r, 0.4, 0.4);
    if (l.labelAt) grow(l.labelAt[0], l.labelAt[1], 0.4, 0.4);
  }
  for (const z of resolveZones(spec)) {
    c0 = Math.min(c0, z.bounds.c0 - zonePad);
    c1 = Math.max(c1, z.bounds.c1 + zonePad);
    r0 = Math.min(r0, z.bounds.r0 - zonePad);
    r1 = Math.max(r1, z.bounds.r1 + zonePad);
  }
  if (!Number.isFinite(c0)) [c0, c1, r0, r1] = [0, 1, 0, 1];

  // Which grid index runs left to right on screen: columns in landscape, rows in portrait.
  const across = (n: { at: { col: number; row: number } }) => (portrait ? n.at.row : n.at.col);
  const along = (n: { at: { col: number; row: number } }) => (portrait ? n.at.col : n.at.row);
  const need = new Map<number, number>(); // gap between index k and k+1 -> spacing it needs, in pixels
  // Two cards side by side need room for their text: the name plate and the sub-label under it, whichever is wider.
  const textHalf = (n: DiagramNode) => Math.max(n.label.length * 7.4 + 20, (n.sub?.length ?? 0) * 7.6) / 2;
  for (const a of spec.nodes) {
    for (const b of spec.nodes) {
      if (a === b || along(a) !== along(b) || across(b) - across(a) !== 1) continue;
      need.set(across(a), Math.max(need.get(across(a)) ?? 0, textHalf(a) + textHalf(b) + 28));
    }
  }
  for (const l of spec.links) {
    if (l.via?.length || l.labelAt) continue; // a routed or hand-placed label is not on a straight cable
    const a = spec.nodes.find((n) => n.id === l.from);
    const b = spec.nodes.find((n) => n.id === l.to);
    if (!a || !b || along(a) !== along(b) || Math.abs(across(a) - across(b)) !== 1) continue;
    const k = Math.min(across(a), across(b));
    need.set(k, Math.max(need.get(k) ?? 0, chipWidth(l) + 2 * CABLE_BEYOND_CHIP + SIDE_BY_SIDE_TRIM + (resolveLink(l).twoWay ? 10 : 0)));
  }
  const spacing = (k: number) => Math.max(cw, need.get(k) ?? 0);
  const lo = portrait ? r0 : c0;
  const hi = portrait ? r1 : c1;
  const first = Math.floor(lo) - 1;
  const last = Math.ceil(hi) + 1;
  const offset = new Map<number, number>([[first, 0]]);
  for (let k = first; k < last; k++) offset.set(k + 1, offset.get(k)! + spacing(k));
  /** A position on the left-to-right axis, in grid units, to pixels; fractions interpolate inside their gap. */
  const x = (v: number) => {
    const k = Math.floor(v);
    if (k < first) return offset.get(first)! + (v - first) * cw;
    if (k >= last) return offset.get(last)! + (v - last) * cw;
    return offset.get(k)! + (v - k) * spacing(k);
  };
  const W = x(hi) - x(lo);
  const H = portrait ? (c1 - c0) * ch : (r1 - r0) * ch;
  const xy = (c: number, r: number): XY => (portrait ? [x(r) - x(r0), (c - c0) * ch] : [x(c) - x(c0), (r - r0) * ch]);
  return { portrait, W, H, xy };
}

/**
 * A card's outline in the flat view, as two boxes around its anchor: the icon frame, and above it the name plate and sub-label. The plate's width is
 * estimated from its text (the layout has no browser to measure with), so it is a little generous.
 */
function cardBoxes(n: DiagramNode, c: XY): Box[] {
  const k = Math.max(1, n.icons.length);
  const half = (k * TILE + (k - 1) * 8 + 16) / 2;
  const frameHalf = (TILE + 16) / 2;
  const plate = Math.max(n.label.length * 8.6 + 22, (n.sub?.length ?? 0) * 7.6) / 2;
  return [
    { l: c[0] - half, r: c[0] + half, t: c[1] - frameHalf, b: c[1] + frameHalf },
    { l: c[0] - plate, r: c[0] + plate, t: c[1] - CARD_ABOVE, b: c[1] - frameHalf },
  ];
}

/** Where the segment a to b is inside the box grown by `gap`, as the parameter range [in, out] along a to b (it may lie outside 0 to 1), or null if it never is. */
function slab(a: XY, b: XY, box: Box, gap: number): [number, number] | null {
  let lo = -Infinity;
  let hi = Infinity;
  for (const [p, q, min, max] of [[a[0], b[0], box.l - gap, box.r + gap], [a[1], b[1], box.t - gap, box.b + gap]] as const) {
    const d = q - p;
    if (Math.abs(d) < 1e-9) {
      if (p < min || p > max) return null;
    } else {
      const [t0, t1] = d > 0 ? [(min - p) / d, (max - p) / d] : [(max - p) / d, (min - p) / d];
      lo = Math.max(lo, t0);
      hi = Math.min(hi, t1);
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

/**
 * Where a cable meets a card's outline at its start (leaving `from`) and at its end (arriving at `to`), `gap` px short of the outline.
 * An end is left out when the cable never reaches the outline or would come out too short, so the caller keeps its plain trim there.
 */
function clipEnds(pts: XY[], from: DiagramNode, to: DiagramNode, head: number, gap = 6): { start?: XY; end?: XY } {
  const n = pts.length;
  const [s0, s1, e0, e1] = [pts[0]!, pts[1]!, pts[n - 2]!, pts[n - 1]!];
  const out = cardBoxes(from, s0).map((b) => slab(s0, s1, b, gap + head)).filter((r): r is [number, number] => r !== null);
  const into = cardBoxes(to, e1).map((b) => slab(e0, e1, b, gap)).filter((r): r is [number, number] => r !== null);
  const tStart = out.length ? Math.max(...out.map((r) => r[1])) : NaN;
  const tEnd = into.length ? Math.min(...into.map((r) => r[0])) : NaN;
  const res: { start?: XY; end?: XY } = {};
  if (tStart > 0 && tStart < 1) res.start = [s0[0] + (s1[0] - s0[0]) * tStart, s0[1] + (s1[1] - s0[1]) * tStart];
  if (tEnd > 0 && tEnd < 1) res.end = [e0[0] + (e1[0] - e0[0]) * tEnd, e0[1] + (e1[1] - e0[1]) * tEnd];
  return res;
}

/** Shorten both ends of a polyline so the cable stops at the card edge. */
export function trim(points: XY[], start: number, end: number): XY[] {
  const p = points.map((q) => [...q] as XY);
  const cut = (a: XY, b: XY, d: number): XY => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [a[0] + ((b[0] - a[0]) / len) * d, a[1] + ((b[1] - a[1]) / len) * d];
  };
  p[0] = cut(p[0]!, p[1]!, start);
  p[p.length - 1] = cut(p[p.length - 1]!, p[p.length - 2]!, end);
  return p;
}

/** Polyline with softly rounded corners. */
export function roundedPath(pts: XY[], r = 16): string {
  let d = `M ${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1]!;
    const [cx, cy] = pts[i]!;
    const [nx, ny] = pts[i + 1]!;
    const l1 = Math.hypot(cx - px, cy - py) || 1;
    const l2 = Math.hypot(nx - cx, ny - cy) || 1;
    const rr = Math.min(r, l1 / 2, l2 / 2);
    d += ` L ${cx + ((px - cx) / l1) * rr} ${cy + ((py - cy) / l1) * rr}`;
    d += ` Q ${cx} ${cy} ${cx + ((nx - cx) / l2) * rr} ${cy + ((ny - cy) / l2) * rr}`;
  }
  const last = pts[pts.length - 1]!;
  return `${d} L ${last[0]} ${last[1]}`;
}

/** Point at fraction `t` (0..1) of the polyline's length. */
export function pointAt(pts: XY[], t: number): XY {
  const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]));
  let rest = seg.reduce((s, n) => s + n, 0) * t;
  for (let i = 0; i < seg.length; i++) {
    if (rest <= seg[i]!) {
      const k = seg[i]! ? rest / seg[i]! : 0;
      return [pts[i]![0] + (pts[i + 1]![0] - pts[i]![0]) * k, pts[i]![1] + (pts[i + 1]![1] - pts[i]![1]) * k];
    }
    rest -= seg[i]!;
  }
  return pts[pts.length - 1]!;
}

export const polyMid = (pts: XY[]): XY => pointAt(pts, 0.5);

const FOOT_HALF_W = 76;
const FOOT_UP = CARD_ABOVE + 20;
const FOOT_DOWN = PAD / 2 + 12;

/** Whether a label centred at `p` would sit on top of a card (name plate, icon frame or pedestal). */
export const hitsNode = (p: XY, nodes: XY[]): boolean =>
  nodes.some(([x, y]) => Math.abs(p[0] - x) <= FOOT_HALF_W && p[1] >= y - FOOT_UP && p[1] <= y + FOOT_DOWN);

const CHIP_H = 24; // a chip's minimum height: WCAG 2.5.8 asks for 24 px targets
/** The box a label chip of width `w` takes up when centred on `p`, with a little air around it. */
export const chipBox = (p: XY, w: number): Box => ({ l: p[0] - w / 2 - 4, r: p[0] + w / 2 + 4, t: p[1] - CHIP_H / 2 - 2, b: p[1] + CHIP_H / 2 + 2 });
const boxesOverlap = (a: Box, b: Box) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

/**
 * The label position nearest the middle of the cable that covers no card and, when `chip` is given, none of the
 * chips already placed (`taken`). If every spot touches one, cards alone are avoided; failing that, the middle.
 */
export function pickLabel(pts: XY[], nodes: XY[], chip?: { w: number; taken: Box[] }): XY {
  const candidates: XY[] = [pointAt(pts, 0.5)];
  for (let k = 1; k <= 30; k++) candidates.push(pointAt(pts, 0.5 - k * 0.015), pointAt(pts, 0.5 + k * 0.015));
  const freeOfChips = (p: XY) => !chip || !chip.taken.some((t) => boxesOverlap(chipBox(p, chip.w), t));
  return candidates.find((p) => !hitsNode(p, nodes) && freeOfChips(p)) ?? candidates.find((p) => !hitsNode(p, nodes)) ?? polyMid(pts);
}

export type LinkGeometry = {
  /** The cable's corner points, trimmed to the card edges (the path `d` rounds these corners). */
  pts: XY[];
  /** Cable path, trimmed to the card edges. */
  d: string;
  /** Where the label chip sits. */
  mid: XY;
};

/** Cable path and label position for one link. Both ends are trimmed; a two-way cable gets the arrowhead margin on both. */
export function linkGeometry(spec: Pick<DiagramSpec, "nodes">, l: DiagramLink, layout: Layout, twoWay: boolean, taken?: Box[], clip = false): LinkGeometry | null {
  const a = spec.nodes.find((n) => n.id === l.from);
  const b = spec.nodes.find((n) => n.id === l.to);
  if (!a || !b) return null;
  const pts: XY[] = [layout.xy(a.at.col, a.at.row), ...(l.via ?? []).map(([c, r]) => layout.xy(c, r)), layout.xy(b.at.col, b.at.row)];
  // A cable that leaves a card upward, or arrives from above, would run through its name plate; stop it above the plate instead.
  const startUp = pts[1]![1] < pts[0]![1] - 1;
  const endDown = pts[pts.length - 1]![1] > pts[pts.length - 2]![1] + 1;
  const head = twoWay ? 10 : 0;
  const trimmed = trim(pts, startUp ? CARD_ABOVE : PAD / 2 + 2 + head, endDown ? CARD_ABOVE + 8 : PAD / 2 + 10);
  // In the flat view (`clip`), a cable that leaves or arrives over a card's top used to stop a fixed distance along the line, which at an angle lands beside the
  // name plate, not on it. Those two ends stop where the line meets the plate (or icon frame) instead; every other end is as before.
  if (clip) {
    const c = clipEnds(pts, a, b, head);
    // only an end that floats clear of its card is moved; one that already reaches the outline is left exactly as it was
    const floats = (p: XY, node: DiagramNode) => cardBoxes(node, layout.xy(node.at.col, node.at.row)).every((box) => Math.max(box.l - p[0], p[0] - box.r, box.t - p[1], p[1] - box.b) > 12);
    const far = (p: XY, q: XY) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (startUp && c.start && floats(trimmed[0]!, a) && far(c.start, trimmed[trimmed.length - 1]!) > 12) trimmed[0] = c.start;
    if (endDown && c.end && floats(trimmed[trimmed.length - 1]!, b) && far(c.end, trimmed[0]!) > 12) trimmed[trimmed.length - 1] = c.end;
  }

  const nodes = spec.nodes.map((n) => layout.xy(n.at.col, n.at.row));
  const w = chipWidth(l);
  const mid = l.labelAt ? layout.xy(l.labelAt[0], l.labelAt[1]) : pickLabel(pts, nodes, taken && { w, taken });
  taken?.push(chipBox(mid, w));
  return { d: roundedPath(trimmed), mid, pts: trimmed };
}

export type Hop = { i: number; forward: boolean };

/** Shortest hop sequence along the link graph (either direction), so the trace pulse follows real connections. */
export function findRoute(links: Pick<DiagramLink, "from" | "to">[], from: string | null, to: string | null): Hop[] {
  if (!from || !to || from === to) return [];
  const prev = new Map<string, { id: string; i: number; forward: boolean }>();
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    links.forEach((l, i) => {
      const next = l.from === cur ? l.to : l.to === cur ? l.from : null;
      if (!next || seen.has(next)) return;
      seen.add(next);
      prev.set(next, { id: cur, i, forward: l.from === cur });
      queue.push(next);
    });
  }
  const hops: Hop[] = [];
  let at = to;
  while (at !== from) {
    const step = prev.get(at);
    if (!step) return [];
    hops.unshift({ i: step.i, forward: step.forward });
    at = step.id;
  }
  return hops;
}

export type ZoneRect = {
  id: string;
  label: string;
  kind: ZoneKind;
  depth: number;
  left: number;
  top: number;
  width: number;
  height: number;
  /** Where the label sits, relative to the zone's own top-left corner. */
  labelLeft: number;
  labelTop: number;
  /** False when no position along the zone's top or bottom edge cleared everything (the label still sits at the least bad one). */
  isLabelClear: boolean;
};

export type Box = { l: number; t: number; r: number; b: number };

/** What a zone label has to stay clear of besides cards and zones: the cables and their label chips. */
export type LabelObstacles = { pts: XY[]; mid: XY; label: string }[];

const LABEL_H = 24;
const LABEL_INSET = 8;
const labelWidth = (text: string) => text.length * 7.4 + 12;
const FOLD_ROOM = 32; // the collapse button that sits after a container's label
const overlaps = (a: Box, b: Box) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
const inside = (p: XY, r: Box) => p[0] > r.l && p[0] < r.r && p[1] > r.t && p[1] < r.b;
/** Whether a polyline passes through a box, sampled every few pixels. */
const crosses = (pts: XY[], r: Box) => {
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!;
    const [bx, by] = pts[i]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 6));
    for (let k = 0; k <= steps; k++) if (inside([ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps], r)) return true;
  }
  return false;
};

const ZONE_GAP = 14; // between a zone edge and the cards inside it
const ZONE_NEST_GAP = 38; // between a parent edge and a child edge, so their labels never collide

/** Rough half-width of a card: the wider of its icon row and its name plate. */
export const cardHalfWidth = (n: DiagramNode) => {
  const icons = n.icons.length * TILE + (n.icons.length - 1) * 8 + 14;
  const plate = n.label.length * 8.6 + 22;
  return Math.max(icons, plate) / 2;
};

/**
 * Zone rectangles in plane pixels. Starts from the cell-based bounds of `resolveZones`, then grows each zone to
 * hold the cards of its members and each parent to hold its children with a clear gap. This is what the renderer draws.
 */
export function zoneRects(spec: Pick<DiagramSpec, "nodes" | "zones">, layout: Layout, cables: LabelObstacles = []): ZoneRect[] {
  const zones = resolveZones(spec);
  const byId = new Map(spec.nodes.map((n) => [n.id, n]));
  const box = new Map<string, { l: number; t: number; r: number; b: number }>();
  for (const z of zones) {
    const [x0, y0] = layout.xy(z.bounds.c0, z.bounds.r0);
    const [x1, y1] = layout.xy(z.bounds.c1, z.bounds.r1);
    box.set(z.id, { l: Math.min(x0, x1), t: Math.min(y0, y1), r: Math.max(x0, x1), b: Math.max(y0, y1) });
  }
  for (const z of spec.zones ?? []) {
    const bx = box.get(z.id);
    if (!bx) continue;
    for (const m of z.members ?? []) {
      const n = byId.get(m);
      if (!n) continue;
      const [cx, cy] = layout.xy(n.at.col, n.at.row);
      const hw = cardHalfWidth(n) + ZONE_GAP;
      bx.l = Math.min(bx.l, cx - hw);
      bx.r = Math.max(bx.r, cx + hw);
      bx.t = Math.min(bx.t, cy - 112);
      bx.b = Math.max(bx.b, cy + 60);
    }
  }
  for (const z of [...zones].sort((a, b) => b.depth - a.depth)) {
    const child = box.get(z.id);
    const parent = z.parent ? box.get(z.parent) : undefined;
    if (!child || !parent) continue;
    parent.l = Math.min(parent.l, child.l - ZONE_NEST_GAP);
    parent.t = Math.min(parent.t, child.t - ZONE_NEST_GAP);
    parent.r = Math.max(parent.r, child.r + ZONE_NEST_GAP);
    parent.b = Math.max(parent.b, child.b + ZONE_NEST_GAP);
  }

  // Labels: outer zones first. Each label tries spots along its zone's bottom edge, then its top edge, and takes the
  // first one that overlaps no card, no cable or cable label, no other zone's edge area and no label already placed.
  const cards: Box[] = spec.nodes.map((n) => {
    const [cx, cy] = layout.xy(n.at.col, n.at.row);
    const hw = cardHalfWidth(n) + 4;
    return { l: cx - hw, r: cx + hw, t: cy - 112, b: cy + 60 };
  });
  const chips: Box[] = cables.map((c) => {
    const w = c.label.length * 6.4 + 22;
    return { l: c.mid[0] - w / 2, r: c.mid[0] + w / 2, t: c.mid[1] - 10, b: c.mid[1] + 12 };
  });
  const ancestorsOf = (id: string) => {
    const out = new Set<string>();
    for (let p = zones.find((z) => z.id === id)?.parent; p && !out.has(p); p = zones.find((z) => z.id === p)?.parent) out.add(p);
    return out;
  };
  const placed: Box[] = [];
  const labels = new Map<string, { x: number; y: number; isClear: boolean }>();
  for (const z of [...zones].sort((a, b) => a.depth - b.depth)) {
    const bx = box.get(z.id)!;
    const w = labelWidth(z.label) + FOLD_ROOM;
    const ancestors = ancestorsOf(z.id);
    const others: Box[] = zones.filter((o) => o.id !== z.id && !ancestors.has(o.id)).map((o) => box.get(o.id)!);
    const score = (r: Box) => {
      let n = 0;
      for (const c of cards) if (overlaps(r, c)) n += 3;
      for (const c of chips) if (overlaps(r, c)) n += 3;
      for (const p of placed) if (overlaps(r, p)) n += 3;
      for (const o of others) if (overlaps(r, o)) n += 2;
      for (const c of cables) if (crosses(c.pts, r)) n += 2;
      return n;
    };
    // Inside the zone first (bottom edge, then top edge). A zone too small to hold its label clear of everything
    // falls back to just outside its bottom or top edge, where the label may overhang the zone's width.
    const fits: number[] = [];
    for (let x = bx.l + LABEL_INSET; x + w <= bx.r - LABEL_INSET; x += 16) fits.push(x);
    const overhang: number[] = [];
    for (let x = bx.l + LABEL_INSET; x <= bx.r - 24; x += 16) overhang.push(x);
    const spots: [number, number[]][] = [
      [bx.b - LABEL_INSET - LABEL_H, fits.length ? fits : [bx.l + LABEL_INSET]],
      [bx.t + LABEL_INSET, fits.length ? fits : [bx.l + LABEL_INSET]],
      [bx.b + 4, overhang],
      [bx.t - LABEL_H - 4, overhang],
    ];
    let best = { x: spots[0]![1][0]!, y: spots[0]![0], n: Infinity };
    search: for (const [y, xs] of spots) {
      for (const x of xs) {
        const n = score({ l: x, r: x + w, t: y, b: y + LABEL_H });
        if (n < best.n) best = { x, y, n };
        if (n === 0) break search;
      }
    }
    placed.push({ l: best.x, r: best.x + w, t: best.y, b: best.y + LABEL_H });
    labels.set(z.id, { x: best.x - bx.l, y: best.y - bx.t, isClear: best.n === 0 });
  }

  return zones.map((z) => {
    const bx = box.get(z.id)!;
    const lab = labels.get(z.id)!;
    return {
      id: z.id,
      label: z.label,
      kind: z.kind,
      depth: z.depth,
      left: bx.l,
      top: bx.t,
      width: bx.r - bx.l,
      height: bx.b - bx.t,
      labelLeft: lab.x,
      labelTop: lab.y,
      isLabelClear: lab.isClear,
    };
  });
}
