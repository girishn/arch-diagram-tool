import { CARD_ABOVE, PAD, TILE, cardHalfWidth, chipWidth, pickLabel, chipBox, roundedPath, trim } from "./layout.ts";
import type { Box, Layout, LinkGeometry, XY } from "./layout.ts";
import type { DiagramLink, DiagramNode, DiagramSpec } from "./schema.ts";

/**
 * Right-angle routes that go around cards, for the whole set of arrows at once.
 *
 * Each arrow leaves its card by the side that faces the other card and arrives by the side that faces back. Arrows that use one side of a card get their own
 * spots along it (ordered by where the other end is, so they do not cross at the card), instead of all meeting at one point. The route is a search over a
 * grid with the cards blocked: it pays for each bend, and more for running along an arrow already routed or crossing one, so busy corridors fill in as
 * parallel lanes.
 *
 * Pure and deterministic. Arrows are routed shortest first, so a long arrow bends around the short ones.
 */

const G = 8; // grid cell, px
const MARGIN = 8; // clear space kept around a card
const PORT_OUT = 26; // how far outside a card's edge the search starts and ends; the last stretch is drawn straight from there to the card, so a head never sits on a bend
const BEND = 6; // cost of a bend, in cells
const PARALLEL = 9; // cost of running along an arrow already routed through a cell
const CROSS = 30; // cost of crossing one
const HEUR = 1; // weight on the distance still to go; above 1 the search is faster but the routes a little longer
const NEAR = 0.4; // cost of running right beside a card
const DIRS: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // up, right, down, left

type Side = 0 | 1 | 2 | 3; // top, right, bottom, left (same numbering as DIRS: the side an arrow leaves by is the direction it moves in)

/** What an arrow runs up to: the whole card with its name plate above it (the flat view), or only the pedestal it stands on (the isometric views, where the card stands up out of the floor). */
export type Footprint = "card" | "pedestal" | "plate";

type Box0 = { hw: number; up: number; down: number; gap: number };
const boxDims = (n: DiagramNode, fp: Footprint): Box0 => {
  if (fp === "card") return { hw: cardHalfWidth(n), up: CARD_ABOVE, down: PAD / 2, gap: 4 };
  if (fp === "plate") return { hw: n.icons.length > 1 ? PAD / 2 + 31 : PAD / 2, up: PAD / 2, down: PAD / 2, gap: 2 }; // the 3D plane's pad
  return { hw: n.icons.length > 1 ? (TILE * 2 + 24) / 2 : (TILE + 8) / 2, up: (TILE + 8) / 2, down: (TILE + 8) / 2, gap: 1 }; // a floor's pad
};

export type RouteInput = {
  /** Whether the link is drawn with a head at both ends. */
  twoWay: boolean;
  /** The arrow ends on a card on another floor: it runs on its own floor to the card's footprint, so it ends at the card's centre and that card does not block it. */
  toOtherFloor: boolean;
};

const boxOf = (n: DiagramNode, c: XY, fp: Footprint): Box => {
  const d = boxDims(n, fp);
  return { l: c[0] - d.hw - MARGIN, r: c[0] + d.hw + MARGIN, t: c[1] - d.up - MARGIN, b: c[1] + d.down + MARGIN };
};

class Heap {
  private f: number[] = [];
  private v: number[] = [];
  get size() {
    return this.f.length;
  }
  push(f: number, v: number) {
    const a = this.f;
    const b = this.v;
    let i = a.length;
    a.push(f);
    b.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]! <= a[i]!) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      [b[p], b[i]] = [b[i]!, b[p]!];
      i = p;
    }
  }
  pop(): number {
    const a = this.f;
    const b = this.v;
    const top = b[0]!;
    const lf = a.pop()!;
    const lv = b.pop()!;
    if (a.length) {
      a[0] = lf;
      b[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]! < a[m]!) m = l;
        if (r < a.length && a[r]! < a[m]!) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        [b[m], b[i]] = [b[i]!, b[m]!];
        i = m;
      }
    }
    return top;
  }
}

/** One floor's grid: which cells a card blocks, and which are already used by a routed arrow (horizontally, vertically). */
type Grid = { nx: number; ny: number; blocked: Uint8Array; near: Uint8Array; occH: Uint8Array; occV: Uint8Array; cost: Float32Array; prev: Int32Array; stamp: Uint32Array; gen: number };

function makeGrid(W: number, H: number, boxes: Box[]): Grid {
  const nx = Math.ceil(W / G) + 2;
  const ny = Math.ceil(H / G) + 2;
  const blocked = new Uint8Array(nx * ny);
  const near = new Uint8Array(nx * ny);
  const fill = (arr: Uint8Array, b: Box, grow: number) => {
    const x0 = Math.max(0, Math.floor((b.l - grow) / G));
    const x1 = Math.min(nx - 1, Math.floor((b.r + grow) / G));
    const y0 = Math.max(0, Math.floor((b.t - grow) / G));
    const y1 = Math.min(ny - 1, Math.floor((b.b + grow) / G));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) arr[y * nx + x] = 1;
  };
  for (const b of boxes) {
    fill(blocked, b, 0);
    fill(near, b, 2 * G);
  }
  // the search's working arrays are made once per floor and reused: `stamp` says which entries belong to the current search
  return { nx, ny, blocked, near, occH: new Uint8Array(nx * ny), occV: new Uint8Array(nx * ny), cost: new Float32Array(nx * ny * 4), prev: new Int32Array(nx * ny * 4), stamp: new Uint32Array(nx * ny * 4), gen: 0 };
}

const cellOf = (p: XY): [number, number] => [Math.floor(p[0] / G), Math.floor(p[1] / G)];
const snap = (v: number) => (Math.floor(v / G) + 0.5) * G; // the centre of the cell a coordinate falls in

/**
 * Routes every link. `floorOf` says which floor a card is on (cards on other floors never block an arrow); leave it out for one plane.
 * Returns, per link, its corner points (ends trimmed to the cards, the start with room for a head when two-way) and the SVG path with hops.
 * A link whose route cannot be found, or whose cards are missing, comes back as a straight line between its ports (or null if a card is missing).
 */
export function routeLinks(
  spec: Pick<DiagramSpec, "nodes" | "links">,
  layout: Layout,
  inputs: RouteInput[],
  floorOf?: (n: DiagramNode) => string,
  taken?: Box[],
  footprint: Footprint = "card",
): (LinkGeometry | null)[] {
  const byId = new Map(spec.nodes.map((n) => [n.id, n]));
  const centre = new Map(spec.nodes.map((n) => [n.id, layout.xy(n.at.col, n.at.row)]));
  const floor = (n: DiagramNode) => (floorOf ? floorOf(n) : "");

  // ---- sides and ports ---------------------------------------------------------------------------------------------------------------
  type Plan = { link: DiagramLink; a: DiagramNode; b: DiagramNode; sa: Side; sb: Side; start: XY; end: XY };
  const plans: (Plan | null)[] = spec.links.map((link) => {
    const a = byId.get(link.from);
    const b = byId.get(link.to);
    if (!a || !b) return null;
    const ca = centre.get(a.id)!;
    const cb = centre.get(b.id)!;
    const dx = cb[0] - ca[0];
    const dy = cb[1] - ca[1];
    const vertical = Math.abs(dy) > 60 || Math.abs(dx) < 40;
    const sa: Side = vertical ? (dy >= 0 ? 2 : 0) : dx >= 0 ? 1 : 3;
    const sb: Side = ((sa + 2) % 4) as Side;
    return { link, a, b, sa, sb, start: ca, end: cb };
  });
  // spots along each side, ordered by where the other end is
  const uses = new Map<string, { plan: number; end: "a" | "b"; key: number }[]>();
  plans.forEach((p, i) => {
    if (!p) return;
    const add = (node: DiagramNode, side: Side, end: "a" | "b", other: XY) => {
      const k = `${node.id}:${side}`;
      const list = uses.get(k) ?? [];
      list.push({ plan: i, end, key: side % 2 === 0 ? other[0] : other[1] });
      uses.set(k, list);
    };
    add(p.a, p.sa, "a", centre.get(p.b.id)!);
    if (!inputs[i]!.toOtherFloor) add(p.b, p.sb, "b", centre.get(p.a.id)!);
  });
  const offsets = new Map<string, number>(); // `${plan}:${end}` -> offset along the side
  for (const [k, list] of uses) {
    const [id, sideText] = [k.slice(0, k.lastIndexOf(":")), Number(k.slice(k.lastIndexOf(":") + 1))];
    const n = byId.get(id)!;
    const room = sideText % 2 === 0 ? boxDims(n, footprint).hw * 2 - 20 : 30;
    list.sort((u, v) => u.key - v.key || u.plan - v.plan);
    const step = list.length > 1 ? Math.max(8, Math.min(20, room / (list.length - 1))) : 0;
    list.forEach((u, idx) => offsets.set(`${u.plan}:${u.end}`, (idx - (list.length - 1) / 2) * step));
  }
  const portOf = (n: DiagramNode, side: Side, off: number): XY => {
    const c = centre.get(n.id)!;
    const { hw, up, down } = boxDims(n, footprint);
    if (side === 0) return [snap(c[0] + off), snap(c[1] - up - PORT_OUT)];
    if (side === 2) return [snap(c[0] + off), snap(c[1] + down + PORT_OUT)];
    if (side === 1) return [snap(c[0] + hw + PORT_OUT), snap(c[1] + off)];
    return [snap(c[0] - hw - PORT_OUT), snap(c[1] + off)];
  };
  plans.forEach((p, i) => {
    if (!p) return;
    p.start = portOf(p.a, p.sa, offsets.get(`${i}:a`) ?? 0);
    p.end = inputs[i]!.toOtherFloor ? ([snap(centre.get(p.b.id)![0]), snap(centre.get(p.b.id)![1])] as XY) : portOf(p.b, p.sb, offsets.get(`${i}:b`) ?? 0);
  });

  // ---- one grid per floor ------------------------------------------------------------------------------------------------------------
  const grids = new Map<string, Grid>();
  const gridFor = (key: string) => {
    let g = grids.get(key);
    if (!g) {
      g = makeGrid(layout.W, layout.H, spec.nodes.filter((n) => floor(n) === key).map((n) => boxOf(n, centre.get(n.id)!, footprint)));
      grids.set(key, g);
    }
    return g;
  };

  // ---- search ------------------------------------------------------------------------------------------------------------------------
  const order = plans
    .map((p, i) => (p ? { i, d: Math.abs(p.start[0] - p.end[0]) + Math.abs(p.start[1] - p.end[1]) } : null))
    .filter((x): x is { i: number; d: number } => x !== null)
    .sort((u, v) => u.d - v.d || u.i - v.i);
  const routes: (XY[] | null)[] = plans.map(() => null);
  for (const { i } of order) {
    const p = plans[i]!;
    const grid = gridFor(floor(p.a));
    routes[i] =
      search(grid, p.start, p.sa, p.end, inputs[i]!.toOtherFloor ? null : p.sb, boxOf(p.b, centre.get(p.b.id)!, footprint), inputs[i]!.toOtherFloor);
  }

  // ---- ends, paths -------------------------------------------------------------------------------------------------------------------
  const finalPts: (XY[] | null)[] = plans.map((p, i) => {
    if (!p) return null;
    let r = routes[i] ?? fallback(p.start, p.sa, p.end);
    // the search starts and ends PORT_OUT from the card; bring each end in along its last stretch to just short of the card (so a head sits on a straight run, touching the card)
    const touch = (pt: XY, n: DiagramNode, side: Side): XY => {
      const c = centre.get(n.id)!;
      const { hw, up, down, gap } = boxDims(n, footprint);
      return side === 0 ? [pt[0], c[1] - up - gap] : side === 2 ? [pt[0], c[1] + down + gap] : side === 1 ? [c[0] + hw + gap, pt[1]] : [c[0] - hw - gap, pt[1]];
    };
    r = [touch(r[0]!, p.a, p.sa), ...r.slice(1)];
    if (!inputs[i]!.toOtherFloor) r = [...r.slice(0, -1), touch(r[r.length - 1]!, p.b, p.sb)];
    r = dedupe(untangle(r));
    return inputs[i]!.twoWay ? trim(r, 10, 0) : r;
  });
  const chipTaken = taken;
  return plans.map((p, i) => {
    const pts = finalPts[i];
    if (!p || !pts) return null;
    const nodesXY = spec.nodes.map((n) => centre.get(n.id)!);
    const w = chipWidth(p.link);
    const mid = p.link.labelAt ? layout.xy(p.link.labelAt[0], p.link.labelAt[1]) : pickLabel(pts, nodesXY, chipTaken && { w, taken: chipTaken });
    chipTaken?.push(chipBox(mid, w));
    return { pts, d: roundedPath(pts), mid };
  });
}

/** When no route is found (the way out is boxed in), a plain right-angle route that ignores the cards, so no arrow is ever drawn slanted. */
function fallback(from: XY, outSide: Side, to: XY): XY[] {
  if (outSide % 2 === 0) {
    const y = (from[1] + to[1]) / 2;
    return dedupe([from, [from[0], y], [to[0], y], to]);
  }
  const x = (from[0] + to[0]) / 2;
  return dedupe([from, [x, from[1]], [x, to[1]], to]);
}

/** A* over (cell, heading). `into` is the side the arrow must arrive at (null: any), `free` the card box that does not block the end. */
function search(grid: Grid, from: XY, outSide: Side, to: XY, into: Side | null, endBox: Box, endsInCard: boolean): XY[] | null {
  // look in a window around the two ends first (most arrows are short); widen it to the whole grid only if nothing is found there
  for (const margin of [40, 120, Infinity]) {
    const r = searchIn(grid, from, outSide, to, into, endBox, endsInCard, margin);
    if (r) return r;
  }
  return null;
}

function searchIn(grid: Grid, from: XY, outSide: Side, to: XY, into: Side | null, endBox: Box, endsInCard: boolean, margin: number): XY[] | null {
  const { nx, ny, blocked, near, occH, occV, cost, prev, stamp } = grid;
  const [sx, sy] = cellOf(from);
  const [ex, ey] = cellOf(to);
  if (sx === ex && sy === ey) return null;
  const inEndBox = (x: number, y: number) => endsInCard && (x + 0.5) * G > endBox.l && (x + 0.5) * G < endBox.r && (y + 0.5) * G > endBox.t && (y + 0.5) * G < endBox.b;
  const gen = ++grid.gen;
  const wx0 = Math.max(0, Math.min(sx, ex) - margin);
  const wx1 = Math.min(nx - 1, Math.max(sx, ex) + margin);
  const wy0 = Math.max(0, Math.min(sy, ey) - margin);
  const wy1 = Math.min(ny - 1, Math.max(sy, ey) + margin);
  const heap = new Heap();
  const start = (sy * nx + sx) * 4 + outSide;
  cost[start] = 0;
  stamp[start] = gen;
  prev[start] = -1;
  heap.push(Math.abs(sx - ex) + Math.abs(sy - ey), start);
  let goal = -1;
  let expanded = 0;
  while (heap.size && expanded++ < 250000) {
    const s = heap.pop();
    const d = s & 3;
    const cell = s >> 2;
    const x = cell % nx;
    const y = (cell - x) / nx;
    const g0 = cost[s]!;
    if (stamp[s] !== gen) continue;
    if (x === ex && y === ey) {
      // an arrow must come in towards the card; arriving along its side costs extra, so another heading wins if there is one
      if (endsInCard || into === null || d === (((into + 2) % 4) as number)) {
        goal = s;
        break;
      }
    }
    for (let nd = 0; nd < 4; nd++) {
      if (nd === (d + 2) % 4) continue; // never turn back on itself
      if (s === start && nd !== outSide) continue; // an arrow leaves its card straight out, so its first stretch is square to the card
      const mx = x + DIRS[nd]![0];
      const my = y + DIRS[nd]![1];
      if (mx < wx0 || my < wy0 || mx > wx1 || my > wy1) continue;
      const mc = my * nx + mx;
      if (blocked[mc] && !(mx === ex && my === ey) && !inEndBox(mx, my)) continue;
      let c = g0 + 1 + (nd !== d ? BEND : 0) + (near[mc] ? NEAR : 0);
      if (nd === 1 || nd === 3) c += occH[mc] ? PARALLEL : occV[mc] ? CROSS : 0;
      else c += occV[mc] ? PARALLEL : occH[mc] ? CROSS : 0;
      const ns = mc * 4 + nd;
      if (stamp[ns] !== gen || c < cost[ns]!) {
        stamp[ns] = gen;
        cost[ns] = c;
        prev[ns] = s;
        heap.push(c + HEUR * (Math.abs(mx - ex) + Math.abs(my - ey)), ns);
      }
    }
  }
  if (goal < 0) return null;
  const cells: [number, number, number][] = [];
  for (let s = goal; s >= 0; s = prev[s]!) {
    const cell = s >> 2;
    cells.push([cell % nx, Math.floor(cell / nx), s & 3]);
  }
  cells.reverse();
  // mark the cells so later arrows pay to share them
  for (let k = 1; k < cells.length; k++) {
    const [x, y, d] = cells[k]!;
    if (d === 1 || d === 3) occH[y * nx + x] = 1;
    else occV[y * nx + x] = 1;
  }
  // corners only
  const pts: XY[] = [from];
  for (let k = 1; k < cells.length - 1; k++) {
    if (cells[k]![2] !== cells[k + 1]![2]) pts.push([(cells[k]![0] + 0.5) * G, (cells[k]![1] + 0.5) * G]);
  }
  pts.push(to);
  // the first and last corners must line up with the ends (the ends are snapped to cell centres, so they do already)
  return dedupe(pts);
}

/**
 * Takes out a notch: a run that steps aside a few pixels and comes back the way it went (down 71, across 16, up 8). The search lands on
 * such corners when its lane lies a cell off the stub it was forced to take; drawn, it reads as a little hook.
 */
const LAST_RUN = 24;
function untangle(pts: XY[]): XY[] {
  const p = pts.map((q) => [...q] as XY);
  for (let guard = 0; guard < 8; guard++) {
    let changed = false;
    for (let k = 1; k + 2 < p.length; k++) {
      const [a, b, c, d] = [p[k - 1]!, p[k]!, p[k + 1]!, p[k + 2]!];
      const v = Math.abs(a[0] - b[0]) < 0.01; // first run vertical, otherwise horizontal
      const i = v ? 1 : 0; // the axis the first and last runs travel along
      const j = 1 - i;
      if (Math.abs(a[j]! - b[j]!) > 0.01 || Math.abs(b[i]! - c[i]!) > 0.01 || Math.abs(c[j]! - d[j]!) > 0.01) continue; // not run, side step, run
      const s1 = b[i]! - a[i]!;
      const s3 = d[i]! - c[i]!;
      if (s1 * s3 >= 0 || Math.abs(c[j]! - b[j]!) > 3 * G) continue; // the last run must come back, and the step aside must be small
      const fix: XY | null = Math.abs(s3) < Math.abs(s1) ? (i === 1 ? [a[0], d[1]] : [d[0], a[1]]) : k > 1 ? (i === 1 ? [c[0], a[1]] : [a[0], c[1]]) : null;
      if (!fix) continue;
      const trial = [...p.slice(0, k), fix, ...p.slice(k + 2)];
      const len = (u: XY, w: XY) => Math.abs(u[0] - w[0]) + Math.abs(u[1] - w[1]);
      if (len(trial[0]!, trial[1]!) < LAST_RUN || len(trial[trial.length - 2]!, trial[trial.length - 1]!) < LAST_RUN) continue; // keep a straight run at each end for the head
      p.splice(0, p.length, ...trial);
      changed = true;
      break;
    }
    if (!changed) break;
  }
  return p;
}

function dedupe(pts: XY[]): XY[] {
  const out: XY[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && Math.abs(q[0] - p[0]) < 0.01 && Math.abs(q[1] - p[1]) < 0.01) continue;
    out.push(p);
  }
  // drop a corner that lies on a straight run
  return out.filter((p, i) => {
    if (i === 0 || i === out.length - 1) return true;
    const a = out[i - 1]!;
    const b = out[i + 1]!;
    return !((Math.abs(a[0] - p[0]) < 0.01 && Math.abs(p[0] - b[0]) < 0.01) || (Math.abs(a[1] - p[1]) < 0.01 && Math.abs(p[1] - b[1]) < 0.01));
  });
}
