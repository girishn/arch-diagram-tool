// S7 spike (not part of the build; elkjs is NOT a dependency of this repo). To rerun: in an empty folder `npm i elkjs`, copy this file there,
// edit REPO and `dir` below to your checkout, then `node elk-spike.mjs`. Env: ELK_OPTS=<json of ELK options>, QUIET=1 for totals only.
// S7 spike: lay out each example with ELK (layered), snap to the grid, and compare P6's metrics with the hand layout.
import { readFileSync, readdirSync } from "node:fs";
import ELK from "elkjs/lib/elk.bundled.js";

const REPO = new URL("../../", import.meta.url).href;
const { measure } = await import(REPO + "src/measure.ts");
const { resolveZones } = await import(REPO + "src/zones.ts");
const elk = new ELK();

const CW = 216, CH = 270; // one grid cell in px (landscape), as computeLayout uses
const NODE_W = 150, NODE_H = 130;

const EXTRA = JSON.parse(process.env.ELK_OPTS ?? "{}");
async function elkPositions(spec, opts = EXTRA) {
  const zones = spec.zones ?? [];
  const zoneOf = new Map();
  for (const z of zones) for (const m of z.members ?? []) zoneOf.set(m, z.id);
  const mk = (id, extra) => ({ id, ...extra });
  const kids = new Map(); // zone id -> children
  const roots = [];
  const zoneNode = new Map(zones.map((z) => [z.id, mk("z:" + z.id, { children: [], layoutOptions: { "elk.padding": "[top=40,left=20,bottom=20,right=20]" } })]));
  for (const z of [...zones].sort((a, b) => a.id.localeCompare(b.id))) (z.parent && zoneNode.has(z.parent) ? zoneNode.get(z.parent) : { children: roots }).children.push(zoneNode.get(z.id));
  for (const n of [...spec.nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    const leaf = mk(n.id, { width: NODE_W, height: NODE_H });
    const z = zoneOf.get(n.id);
    (z && zoneNode.has(z) ? zoneNode.get(z).children : roots).push(leaf);
  }
  const graph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.layered.spacing.nodeNodeBetweenLayers": "90",
      "elk.spacing.nodeNode": "60",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.randomSeed": "1",
      ...opts,
    },
    children: roots,
    edges: spec.links.map((l, i) => ({ id: "e" + i, sources: [l.from], targets: [l.to] })),
  };
  const out = await elk.layout(graph);
  const pos = new Map();
  const walk = (c, ox, oy) => {
    for (const ch of c.children ?? []) {
      if (ch.id.startsWith("z:")) walk(ch, ox + ch.x, oy + ch.y);
      else pos.set(ch.id, [ox + ch.x + ch.width / 2, oy + ch.y + ch.height / 2]);
    }
  };
  walk(out, 0, 0);
  return pos;
}

/** Snap px centres to grid cells; on a clash take the nearest free cell in the same column. */
function snap(spec, pos) {
  const taken = new Set();
  const at = new Map();
  const order = [...spec.nodes].sort((a, b) => pos.get(a.id)[0] - pos.get(b.id)[0] || pos.get(a.id)[1] - pos.get(b.id)[1] || a.id.localeCompare(b.id));
  for (const n of order) {
    const [x, y] = pos.get(n.id);
    const col = Math.round(x / CW);
    const row = Math.round(y / CH);
    let r = row;
    for (let d = 0; taken.has(col + "," + r); d++) r = row + (d % 2 === 0 ? d / 2 + 1 : -(d + 1) / 2);
    taken.add(col + "," + r);
    at.set(n.id, { col, row: r });
  }
  return at;
}

function zoneOverlaps(spec) {
  const zs = resolveZones(spec);
  const anc = (z) => { const s = new Set(); for (let p = z.parent; p; p = zs.find((q) => q.id === p)?.parent) s.add(p); return s; };
  let n = 0;
  for (let i = 0; i < zs.length; i++) for (let j = i + 1; j < zs.length; j++) {
    const a = zs[i], b = zs[j];
    if (anc(a).has(b.id) || anc(b).has(a.id)) continue;
    const A = a.bounds, B = b.bounds;
    if (A.c0 <= B.c1 && B.c0 <= A.c1 && A.r0 <= B.r1 && B.r0 <= A.r1) n++;
  }
  return n;
}

function metrics(spec) {
  const m = measure(spec, false);
  const cols = spec.nodes.map((n) => n.at.col), rows = spec.nodes.map((n) => n.at.row);
  return {
    cross: m.crossings.length,
    bends: m.totalBends,
    cable: Math.round(m.totalCable),
    chips: m.overlappingChips.length,
    covered: m.coveredCables().length,
    zlabel: m.unclearZoneLabels.length,
    zoverlap: zoneOverlaps(spec),
    grid: `${Math.max(...cols) - Math.min(...cols) + 1}x${Math.max(...rows) - Math.min(...rows) + 1}`,
  };
}

const dir = new URL("../../examples/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const rows = [];
for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const hand = JSON.parse(readFileSync(dir + f, "utf8"));
  const stripped = (s) => ({ ...s, links: s.links.map(({ via, labelAt, ...l }) => l) });
  const viaCount = hand.links.filter((l) => l.via || l.labelAt).length;
  const pos = await elkPositions(hand);
  const at = snap(hand, pos);
  const auto = stripped({ ...hand, nodes: hand.nodes.map((n) => ({ ...n, at: at.get(n.id) })), zones: (hand.zones ?? []).map(({ bounds, ...z }) => z) });
  const h = metrics(hand), a = metrics(auto);
  rows.push({ example: f.replace(".json", ""), n: hand.nodes.length, via: viaCount, ...Object.fromEntries(Object.entries(h).map(([k, v]) => ["h_" + k, v])), ...Object.fromEntries(Object.entries(a).map(([k, v]) => ["e_" + k, v])) });
}
const sum = (p, k) => rows.reduce((t, r) => t + r[p + k], 0);
console.log("TOTALS", process.env.ELK_OPTS ?? "default", Object.fromEntries(["cross","bends","cable","chips","zoverlap"].map((k) => [k, `hand ${sum("h_", k)} / elk ${sum("e_", k)}`])));
if (!process.env.QUIET) console.table(rows);

if (process.env.QUIET) process.exit(0);
// Timing on a layered random DAG.
function dag(n) {
  let s = 12345; const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const nodes = Array.from({ length: n }, (_, i) => ({ id: "n" + i }));
  const links = [];
  for (let i = 1; i < n; i++) { links.push({ from: "n" + Math.max(0, i - 1 - Math.floor(rnd() * 4)), to: "n" + i }); if (rnd() < 0.5) links.push({ from: "n" + Math.floor(rnd() * i), to: "n" + i }); }
  return { nodes, links, zones: [] };
}
const times = [];
for (const n of [10, 40, 100, 200, 500]) {
  const g = dag(n);
  await elkPositions(g);
  const t = [];
  for (let k = 0; k < 3; k++) { const t0 = performance.now(); await elkPositions(g); t.push(performance.now() - t0); }
  times.push({ nodes: n, links: g.links.length, ms: Math.round(t.sort((a, b) => a - b)[1]) });
}
console.table(times);
