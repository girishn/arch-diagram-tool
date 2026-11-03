// Geometry for the isometric "floors" view. Pure: no DOM, no React. A floor is a flat layer drawn under a 2D matrix, and a card stands at its projected
// screen position, so what is in front is just document order (the browser's own 3D sorting paints tilted layers over upright cards).
import type { DiagramSpec } from "./schema.ts";
import type { ZoneRect } from "./layout.ts";

/** Pixels between one floor and the next, before the plane is scaled. */
export const FLOOR_GAP = 170;

/** A card's box around its projected pad centre, in screen px: its width, how far its name plate reaches above, and the pad's shadow below. */
const CARD = { half: 62, above: 150, below: 48 };

export type XY = (col: number, row: number) => [number, number];
export type Band = { id: string; label: string; i: number; left: number; top: number; width: number; height: number };

/** Plane point (x, y) at height h, to the plane's own frame after the view's rotation and tilt: rotate about the centre, squash by cos(tilt), lift by h * sin(tilt). */
export function projector(W: number, H: number, rx: number, rz: number) {
  const d = Math.PI / 180;
  const [cz, sz, cx, sx] = [Math.cos(rz * d), Math.sin(rz * d), Math.cos(rx * d), Math.sin(rx * d)];
  const proj = (x: number, y: number, h: number): [number, number] => {
    const dx = x - W / 2;
    const dy = y - H / 2;
    return [W / 2 + dx * cz - dy * sz, H / 2 + (dx * sz + dy * cz) * cx - h * sx];
  };
  /** The CSS matrix that draws a flat layer at height h. */
  const matrix = (h: number) => `matrix(${cz}, ${sz * cx}, ${-sz}, ${cz * cx}, 0, ${-h * sx})`;
  return { proj, matrix };
}

/** Height of a layer's floor: the first (top) layer is highest, and a node with no layer stands on the ground. */
export function layerHeight(spec: Pick<DiagramSpec, "layers">, layerId: string | undefined): number {
  const layers = spec.layers ?? [];
  const i = layerId === undefined ? -1 : layers.findIndex((l) => l.id === layerId);
  return i < 0 ? 0 : (layers.length - i) * FLOOR_GAP;
}

/** The layer a zone sits in: that of its members, or of what is inside it. */
export function zoneLayers(spec: Pick<DiagramSpec, "zones" | "nodes">): Map<string, string | undefined> {
  const zs = spec.zones ?? [];
  const layer = new Map(spec.nodes.map((n) => [n.id, n.layer]));
  const find = (z: (typeof zs)[number], seen: Set<string>): string | undefined =>
    (z.members ?? []).map((m) => layer.get(m)).find(Boolean) ?? zs.filter((c) => c.parent === z.id && !seen.has(c.id)).map((c) => find(c, new Set([...seen, z.id]))).find(Boolean);
  return new Map(zs.map((z) => [z.id, find(z, new Set())]));
}

/** A band spans the rows its layer's cards use: the full width in landscape; in portrait rows run across, so it is a vertical strip. */
export function bandRectsOf(spec: Pick<DiagramSpec, "layers" | "nodes">, xy: XY, W: number, H: number, portrait: boolean): Band[] {
  return (spec.layers ?? []).flatMap((l, i) => {
    const rows = spec.nodes.filter((n) => n.layer === l.id).map((n) => n.at.row);
    if (!rows.length) return [];
    const a = xy(0, Math.min(...rows));
    const b = xy(0, Math.max(...rows));
    const pad = portrait ? 85 : 135;
    return portrait ? [{ id: l.id, label: l.label, i, left: a[0] - pad, top: 0, width: b[0] - a[0] + 2 * pad, height: H }] : [{ id: l.id, label: l.label, i, left: 0, top: a[1] - pad, width: W, height: b[1] - a[1] + 2 * pad }];
  });
}

/** The box that holds everything the floors view draws (bands, zones, cards with their name plates), in the plane's frame. The empty ground plate is left out. */
export function floorsBounds(o: { spec: Pick<DiagramSpec, "layers" | "nodes" | "zones">; xy: XY; W: number; H: number; zones: ZoneRect[]; bands: Band[]; rx: number; rz: number }) {
  const { proj } = projector(o.W, o.H, o.rx, o.rz);
  const zl = zoneLayers(o.spec);
  let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  const rect = (l: number, t: number, w: number, h: number, elev: number) => {
    for (const [x, y] of [[l, t], [l + w, t], [l, t + h], [l + w, t + h]] as const) add(...proj(x, y, elev));
  };
  for (const b of o.bands) rect(b.left, b.top, b.width, b.height, layerHeight(o.spec, o.spec.layers![b.i]!.id));
  for (const z of o.zones) rect(z.left, z.top, z.width, z.height, layerHeight(o.spec, zl.get(z.id)));
  for (const n of o.spec.nodes) {
    const [px, py] = proj(...o.xy(n.at.col, n.at.row), layerHeight(o.spec, n.layer));
    add(px - CARD.half, py - CARD.above);
    add(px + CARD.half, py + CARD.below);
  }
  return { minX, maxX, minY, maxY };
}
