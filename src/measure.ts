import { chipWidth, computeLayout, linkGeometry, zoneRects } from "./layout.ts";
import { routeLinks } from "./route.ts";
import type { Box, Layout } from "./layout.ts";
import { resolveLink } from "./resolve.ts";
import type { DiagramLink, DiagramNode, DiagramSpec } from "./schema.ts";

type XY = [number, number];

const length = (pts: XY[]) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]), 0);

/** How much of the cable at the label the chip covers, along the cable: its width where the cable runs across, its height where it runs up and down. */
function coverAlong(pts: XY[], mid: XY, width: number): number {
  let best = Infinity;
  let ux = 1;
  let uy = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!;
    const [bx, by] = pts[i]!;
    const l2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((mid[0] - ax) * (bx - ax) + (mid[1] - ay) * (by - ay)) / l2));
    const d = Math.hypot(mid[0] - (ax + t * (bx - ax)), mid[1] - (ay + t * (by - ay)));
    if (d < best) {
      best = d;
      const len = Math.sqrt(l2);
      ux = Math.abs(bx - ax) / len;
      uy = Math.abs(by - ay) / len;
    }
  }
  return width * ux + 24 * uy;
}

/** True when two segments properly cross (touching at an end does not count: cables that meet at a component are not a crossing). */
function segmentsCross(a: XY, b: XY, c: XY, d: XY): boolean {
  const side = (p: XY, q: XY, r: XY) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = side(a, b, c);
  const d2 = side(a, b, d);
  const d3 = side(c, d, a);
  const d4 = side(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** A card is about this far either side of its cell centre, and a little more above and below (its name plate and shadow). */
const CARD_HALF_W = 56;
const CARD_HALF_H = 76;

/** Whether any part of the polyline runs through the card box at (cx, cy). Sampled finely: cables are a few hundred px long and a card is 112 px wide. */
function passesThrough(pts: XY[], cx: number, cy: number): boolean {
  for (let k = 1; k < pts.length; k++) {
    const [ax, ay] = pts[k - 1]!;
    const [bx, by] = pts[k]!;
    const steps = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / 6));
    for (let t = 0; t <= steps; t++) {
      const x = ax + ((bx - ax) * t) / steps;
      const y = ay + ((by - ay) * t) / steps;
      if (Math.abs(x - cx) < CARD_HALF_W && Math.abs(y - cy) < CARD_HALF_H) return true;
    }
  }
  return false;
}

/** How much of cable `a` lies within `tol` px of cable `b` and runs the same way (not a crossing: a stretch of shared line), in px. */
function sharedLength(a: XY[], b: XY[], tol = 5): number {
  let shared = 0;
  for (let k = 1; k < a.length; k++) {
    const [ax, ay] = a[k - 1]!;
    const [bx, by] = a[k]!;
    const steps = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / 6));
    for (let t = 0; t <= steps; t++) {
      const x = ax + ((bx - ax) * t) / steps;
      const y = ay + ((by - ay) * t) / steps;
      for (let m = 1; m < b.length; m++) {
        const [px, py] = b[m - 1]!;
        const [qx, qy] = b[m]!;
        const len = Math.hypot(qx - px, qy - py) || 1;
        const along = ((x - px) * (qx - px) + (y - py) * (qy - py)) / (len * len);
        const d = Math.abs((qy - py) * (x - px) - (qx - px) * (y - py)) / len;
        if (d < tol && along > 0 && along < 1) {
          shared += Math.hypot(bx - ax, by - ay) / steps;
          break;
        }
      }
    }
  }
  return shared;
}

export type LinkMetric = { link: DiagramLink; cable: number; cover: number; visible: number; box: Box; bends: number };

export type LayoutMetrics = {
  layout: Layout;
  links: LinkMetric[];
  /** Pairs of links whose label chips overlap. */
  overlappingChips: [DiagramLink, DiagramLink][];
  /** Links whose chip leaves under `minVisible` px of its cable showing (short cables only; a long cable has room to spare). */
  coveredCables: (minVisible?: number) => LinkMetric[];
  /** Zones whose label found no clear spot. */
  unclearZoneLabels: string[];
  /** Cables that run through a card they do not connect: the card hides part of the arrow, and the arrow reads as if it touched the card. */
  throughCards: { link: DiagramLink; node: DiagramNode }[];
  /** Pairs of cables that share a stretch of line (at least `minShared` px), so one hides the other and only the top one can be pointed at. */
  overlappingCables: (minShared?: number) => [DiagramLink, DiagramLink][];
  /** Pairs of links whose cables cross. Links that share a component are not counted, since they meet there anyway. */
  crossings: [DiagramLink, DiagramLink][];
  /** Total cable length in px, and total bends (corners where a cable changes direction). */
  totalCable: number;
  totalBends: number;
};

/**
 * The layout checks as numbers: overlaps (chips, zone labels), crossings, bends and cable length. Used by the tests as a regression guard,
 * and meant for anything that places nodes (a lint rule, an auto-layout) to tell whether a change made a diagram better or worse.
 */
export function measure(spec: DiagramSpec, portrait: boolean, routed = false): LayoutMetrics {
  const layout = computeLayout(spec, portrait);
  const taken: Box[] = [];
  const links: LinkMetric[] = [];
  const cables: { pts: XY[]; mid: XY; label: string }[] = [];
  // with `routed`, the arrows are measured as the router draws them (right angles around the cards) instead of as straight lines
  const routes = routed ? routeLinks(spec, layout, spec.links.map((l) => ({ twoWay: resolveLink(l).twoWay, toOtherFloor: false })), undefined, taken) : null;
  for (const [idx, link] of spec.links.entries()) {
    const g = routes ? routes[idx] : linkGeometry(spec, link, layout, resolveLink(link).twoWay, taken, true);
    if (!g) continue;
    const cable = length(g.pts);
    const w = chipWidth(link);
    const cover = coverAlong(g.pts, g.mid, w);
    links.push({ link, cable, cover, visible: cable - cover, bends: Math.max(0, g.pts.length - 2), box: { l: g.mid[0] - w / 2, r: g.mid[0] + w / 2, t: g.mid[1] - 12, b: g.mid[1] + 12 } });
    cables.push({ pts: g.pts, mid: g.mid, label: link.label });
  }
  const crossings: [DiagramLink, DiagramLink][] = [];
  for (let i = 0; i < cables.length; i++)
    for (let j = i + 1; j < cables.length; j++) {
      const a = links[i]!.link;
      const b = links[j]!.link;
      if (a.from === b.from || a.from === b.to || a.to === b.from || a.to === b.to) continue;
      const pa = cables[i]!.pts;
      const pb = cables[j]!.pts;
      let hit = false;
      for (let u = 1; u < pa.length && !hit; u++) for (let v = 1; v < pb.length && !hit; v++) hit = segmentsCross(pa[u - 1]!, pa[u]!, pb[v - 1]!, pb[v]!);
      if (hit) crossings.push([a, b]);
    }
  const throughCards: { link: DiagramLink; node: DiagramNode }[] = [];
  cables.forEach((c, i) => {
    for (const n of spec.nodes) {
      const l = links[i]!.link;
      if (n.id === l.from || n.id === l.to) continue;
      const [cx, cy] = layout.xy(n.at.col, n.at.row);
      if (passesThrough(c.pts, cx, cy)) throughCards.push({ link: l, node: n });
    }
  });
  const overlappingChips: [DiagramLink, DiagramLink][] = [];
  for (let i = 0; i < links.length; i++)
    for (let j = i + 1; j < links.length; j++) {
      const a = links[i]!.box;
      const b = links[j]!.box;
      if (a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b) overlappingChips.push([links[i]!.link, links[j]!.link]);
    }
  const unclearZoneLabels = zoneRects(spec, layout, cables)
    .filter((z) => !z.isLabelClear)
    .map((z) => z.id);
  return {
    layout,
    links,
    overlappingChips,
    throughCards,
    overlappingCables: (min = 36) => {
      const out: [DiagramLink, DiagramLink][] = [];
      for (let i = 0; i < cables.length; i++)
        for (let j = i + 1; j < cables.length; j++)
          if (Math.max(sharedLength(cables[i]!.pts, cables[j]!.pts), sharedLength(cables[j]!.pts, cables[i]!.pts)) >= min) out.push([links[i]!.link, links[j]!.link]);
      return out;
    },
    coveredCables: (min = 40) => links.filter((m) => m.cable < 400 && m.visible < min),
    unclearZoneLabels,
    crossings,
    totalCable: links.reduce((n, m) => n + m.cable, 0),
    totalBends: links.reduce((n, m) => n + m.bends, 0),
  };
}

/** The name the layout tests used before this became public. */
export const measureLayout = measure;
