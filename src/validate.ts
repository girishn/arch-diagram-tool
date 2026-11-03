import { INTERACTIONS, LEVELS, PATTERNS, PLANES, TRAFFIC, ZONE_KINDS } from "./schema.ts";
import type { DiagramSpec, Interaction, Issue, Level, Pattern, Plane, Traffic, ZoneKind } from "./schema.ts";
import { resolveZones, zoneExtents } from "./zones.ts";
import { LENS_PRESETS } from "./presets.ts";
import { RULES, isRuleId } from "./rules.ts";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPoint = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(isNum);

// The fields each part of a spec may carry. Anything else that does not start with `x-` is reported, which catches typos like `ofPath`.
const META = ["tags", "properties", "references", "source"];
export const KNOWN: Record<string, string[]> = {
  spec: ["$schema", "version", "title", "description", "nodes", "links", "layers", "zones", "trace", "prose", "lenses", "lintIgnore"],
  node: ["id", "label", "sub", "at", "icons", "layer", "plane", "peripheral", "scale", "detail", "lenses", ...META],
  link: ["id", "from", "to", "label", "plane", "detail", "mentions", "via", "offPath", "pattern", "interaction", "traffic", "protocol", "twoWay", "lenses", "labelAt", ...META],
  zone: ["id", "label", "kind", "members", "parent", "bounds", ...META],
  detail: ["tag", "role", "why", "tradeoff", "mentions"],
  scale: ["min", "max", "unit", "trigger"],
  layer: ["id", "label", "summary"],
  step: ["node", "label"],
};
// http(s) and mailto, or a path inside the same site; never `javascript:` or `data:`.
const SAFE_URL = /^(https?:\/\/|mailto:|\.{0,2}\/(?!\/)|#)/i;

/** Structural checks (errors) plus completeness checks (warnings), before any `lintIgnore` is applied. */
function collectIssues(input: unknown): Issue[] {
  const issues: Issue[] = [];
  const err = (rule: string, path: string, message: string) => issues.push({ severity: "error", rule, path, message });
  const warn = (rule: string, path: string, message: string) => issues.push({ severity: "warning", rule, path, message });

  if (!isObj(input)) return [{ severity: "error", rule: "spec-not-object", path: "", message: "spec must be an object" }];
  if (input.version !== 1) err("spec-version", "version", "must be 1");
  if (!isStr(input.title)) err("title-required", "title", "required string");
  if (!Array.isArray(input.nodes) || input.nodes.length === 0) err("nodes-required", "nodes", "required non-empty array");
  if (!Array.isArray(input.links)) err("links-required", "links", "required array");
  if (issues.length) return issues;

  const spec = input as unknown as DiagramSpec;
  const unknownFields = (part: keyof typeof KNOWN, value: unknown, path: string) => {
    if (!isObj(value)) return;
    for (const key of Object.keys(value))
      if (!KNOWN[part]!.includes(key) && !key.startsWith("x-")) warn("unknown-field", path ? `${path}.${key}` : key, "unknown field, ignored (start its name with x- to keep your own data without this warning)");
  };
  const checkMeta = (v: Record<string, unknown>, p: string) => {
    if (v.tags !== undefined && !(Array.isArray(v.tags) && v.tags.every(isStr))) err("meta-tags", `${p}.tags`, "must be an array of non-empty strings");
    if (v.properties !== undefined) {
      if (!isObj(v.properties) || !Object.values(v.properties).every((x) => ["string", "number", "boolean"].includes(typeof x))) err("meta-properties", `${p}.properties`, "must be an object of strings, numbers and booleans");
    }
    if (v.references !== undefined) {
      if (!Array.isArray(v.references)) err("meta-references", `${p}.references`, "must be an array of { label, url }");
      else
        v.references.forEach((r, i) => {
          if (!isObj(r) || !isStr(r.label) || !isStr(r.url)) return err("meta-reference-shape", `${p}.references[${i}]`, "needs a label and a url");
          if (!SAFE_URL.test(r.url)) err("meta-reference-url", `${p}.references[${i}].url`, "must be http(s), mailto, or a path on the same site");
        });
    }
    if (v.source !== undefined) {
      const src = v.source;
      if (!isObj(src) || (src.address !== undefined && !isStr(src.address)) || (src.file !== undefined && !isStr(src.file)) || (src.line !== undefined && !(Number.isInteger(src.line) && (src.line as number) >= 1)))
        err("meta-source", `${p}.source`, "must be { address?, file?, line? } with line a whole number from 1");
    }
  };
  unknownFields("spec", input, "");
  const lensIds = new Set((spec.lenses ?? []).map((l) => l.id));
  const seenLens = new Set<string>();
  spec.lenses?.forEach((l, i) => {
    const p = `lenses[${i}]`;
    if (!isStr(l.id)) return err("lens-id-required", `${p}.id`, "required string");
    if (l.id === "flow") err("lens-id-reserved", `${p}.id`, '"flow" is built in and cannot be declared');
    if (seenLens.has(l.id)) err("lens-duplicate", `${p}.id`, `duplicate lens "${l.id}"`);
    seenLens.add(l.id);
    if (!isStr(l.label) && !LENS_PRESETS[l.id]) err("lens-label-required", `${p}.label`, "required unless the id is a preset");
  });
  const checkLevel = (path: string, level: unknown) => {
    if (level !== undefined && !LEVELS.includes(level as Level)) err("level-invalid", path, `must be one of: ${LEVELS.join(", ")}`);
  };
  const layers = spec.layers ?? [];
  const layerIds = new Set<string>();
  layers.forEach((l, i) => {
    const p = `layers[${i}]`;
    unknownFields("layer", l, p);
    if (!isStr(l.id) || !isStr(l.label)) return err("layer-invalid", p, "id and label required");
    if (layerIds.has(l.id)) err("layer-duplicate", `${p}.id`, `duplicate layer "${l.id}"`);
    layerIds.add(l.id);
  });
  const ids = new Set<string>();
  const cells = new Map<string, string>();

  spec.nodes.forEach((n, i) => {
    const p = `nodes[${i}]`;
    unknownFields("node", n, p);
    unknownFields("detail", n.detail, `${p}.detail`);
    unknownFields("scale", n.scale, `${p}.scale`);
    checkMeta(n as unknown as Record<string, unknown>, p);
    if (!isStr(n.id)) return err("node-id-required", `${p}.id`, "required string");
    if (ids.has(n.id)) err("node-id-duplicate", `${p}.id`, `duplicate id "${n.id}"`);
    ids.add(n.id);
    if (!isStr(n.label)) err("node-label-required", `${p}.label`, "required string");
    if (!isObj(n.at) || !isNum(n.at.col) || !isNum(n.at.row)) err("node-position-required", `${p}.at`, "required { col, row } numbers");
    else {
      const key = `${n.at.col},${n.at.row}`;
      const other = cells.get(key);
      if (other) err("node-cell-shared", `${p}.at`, `same cell as "${other}"`);
      else cells.set(key, n.id);
    }
    if (!Array.isArray(n.icons) || n.icons.length === 0) err("node-icons-required", `${p}.icons`, "at least one icon key required");
    else if (n.icons.length > 1 && n.icons.some((ic) => typeof ic === "string"))
      warn("icons-grouped-unlabelled", `${p}.icons`, "grouped icons should each have a label");
    for (const [lens, fact] of Object.entries(n.lenses ?? {})) {
      if (!lensIds.has(lens)) err("lens-undeclared", `${p}.lenses.${lens}`, "lens not declared in spec.lenses");
      checkLevel(`${p}.lenses.${lens}.level`, fact.level);
    }
    if (n.scale) {
      const { min, max } = n.scale;
      if (!isNum(min) || !isNum(max) || min < 0 || max < min) err("scale-invalid", `${p}.scale`, "need numbers with 0 <= min <= max");
    }
    if (n.layer !== undefined && !layerIds.has(n.layer)) err("layer-unknown", `${p}.layer`, `unknown layer "${n.layer}"`);
    else if (layers.length && n.layer === undefined) warn("node-layer-missing", `${p}.layer`, "layers are declared but this node is in none");
    if (n.plane !== undefined && !PLANES.includes(n.plane as Plane)) err("plane-invalid", `${p}.plane`, `must be one of: ${PLANES.join(", ")}`);
    if (!n.detail) warn("node-no-explanation", `${p}.detail`, "node has no explanation");
    else if (!n.detail.role || !n.detail.why) warn("node-missing-role-why", `${p}.detail`, "missing role or why");
  });

  const linked = new Set<string>();
  const linkIds = new Set<string>();
  spec.links.forEach((l, i) => {
    const p = `links[${i}]`;
    unknownFields("link", l, p);
    checkMeta(l as unknown as Record<string, unknown>, p);
    if (l.id !== undefined) {
      if (!isStr(l.id) || !/^[A-Za-z][\w.-]*$/.test(l.id)) err("link-id-invalid", `${p}.id`, "must start with a letter and use only letters, digits, _ . -");
      else if (linkIds.has(l.id)) err("link-id-duplicate", `${p}.id`, `duplicate link id "${l.id}"`);
      else linkIds.add(l.id);
    }
    for (const end of ["from", "to"] as const) {
      if (!ids.has(l[end])) err("link-unknown-node", `${p}.${end}`, `unknown node "${l[end]}"`);
      else linked.add(l[end]);
    }
    if (l.from === l.to) err("link-self", p, "self-link");
    if (!isStr(l.label)) err("link-label-required", `${p}.label`, "required string");
    if (l.via?.some((pt) => !isPoint(pt))) err("link-via-invalid", `${p}.via`, "waypoints must be [col, row]");
    if (l.labelAt && !isPoint(l.labelAt)) err("link-label-at-invalid", `${p}.labelAt`, "must be [col, row]");
    if (!l.detail) warn("link-no-explanation", `${p}.detail`, "arrow has no explanation");
    for (const [lens, fact] of Object.entries(l.lenses ?? {})) {
      if (!lensIds.has(lens)) err("lens-undeclared", `${p}.lenses.${lens}`, "lens not declared in spec.lenses");
      checkLevel(`${p}.lenses.${lens}.level`, fact.level);
    }
    const pattern = l.pattern as Pattern | undefined;
    const interaction = l.interaction as Interaction | undefined;
    if (pattern !== undefined && !PATTERNS.includes(pattern)) err("pattern-invalid", `${p}.pattern`, `must be one of: ${PATTERNS.join(", ")}`);
    if (interaction !== undefined && !INTERACTIONS.includes(interaction))
      err("interaction-invalid", `${p}.interaction`, `must be one of: ${INTERACTIONS.join(", ")}`);
    if (pattern === "dependency" && (interaction !== undefined || l.twoWay !== undefined))
      warn("dependency-interaction-ignored", p, "interaction and twoWay do not apply to a dependency");
    if (interaction === "sync" && pattern && ["event", "message", "stream", "batch"].includes(pattern))
      warn("interaction-unusual", `${p}.interaction`, `"${pattern}" is normally async`);
    if (l.plane !== undefined && !PLANES.includes(l.plane as Plane)) err("plane-invalid", `${p}.plane`, `must be one of: ${PLANES.join(", ")}`);
    if (l.traffic !== undefined && !TRAFFIC.includes(l.traffic as Traffic)) err("traffic-invalid", `${p}.traffic`, `must be one of: ${TRAFFIC.join(", ")}`);
    if (l.twoWay && pattern === "event") warn("two-way-event", `${p}.twoWay`, "an event has no response; use request-response or message");
  });

  spec.zones?.forEach((z, i) => {
    unknownFields("zone", z, `zones[${i}]`);
    checkMeta(z as unknown as Record<string, unknown>, `zones[${i}]`);
  });
  validateZones(spec, ids, err, warn);

  const stepsByNode = new Set<string>();
  spec.trace?.forEach((s, i) => {
    unknownFields("step", s, `trace[${i}]`);
    if (!ids.has(s.node)) err("trace-unknown-node", `trace[${i}].node`, `unknown node "${s.node}"`);
    else stepsByNode.add(s.node);
  });

  // Mentions: tagged ids must exist; a node's text should only lean on nodes it is linked to.
  const neighbours = new Map<string, Set<string>>();
  for (const l of spec.links) {
    if (!neighbours.has(l.from)) neighbours.set(l.from, new Set());
    if (!neighbours.has(l.to)) neighbours.set(l.to, new Set());
    neighbours.get(l.from)!.add(l.to);
    neighbours.get(l.to)!.add(l.from);
  }
  const mentioned = new Set<string>();
  spec.nodes.forEach((n, i) =>
    n.detail?.mentions?.forEach((m, j) => {
      if (!ids.has(m)) return err("mention-unknown-node", `nodes[${i}].detail.mentions[${j}]`, `unknown node "${m}"`);
      mentioned.add(m);
      if (m !== n.id && !neighbours.get(n.id)?.has(m))
        warn("mention-not-linked", `nodes[${i}].detail.mentions[${j}]`, `"${n.id}" describes "${m}" but they are not linked`);
    }),
  );
  spec.links.forEach((l, i) =>
    l.mentions?.forEach((m, j) => {
      if (!ids.has(m)) return err("mention-unknown-node", `links[${i}].mentions[${j}]`, `unknown node "${m}"`);
      mentioned.add(m);
    }),
  );
  spec.prose?.forEach((b, i) => {
    if (!isStr(b.id) || !isStr(b.text)) err("prose-invalid", `prose[${i}]`, "id and text required");
    b.mentions?.forEach((m, j) => {
      if (!ids.has(m)) err("mention-unknown-node", `prose[${i}].mentions[${j}]`, `unknown node "${m}"`);
      else mentioned.add(m);
    });
  });
  if (spec.prose?.length)
    for (const n of spec.nodes) if (!mentioned.has(n.id)) warn("prose-uncovered-node", `nodes.${n.id}`, "not mentioned by any prose block");

  // Completeness: every component should be reachable and explained.
  for (const n of spec.nodes) {
    if (!linked.has(n.id)) warn("node-orphan", `nodes.${n.id}`, "no links: orphan component");
    if (spec.trace && !stepsByNode.has(n.id) && !n.peripheral) warn("trace-unvisited-node", `nodes.${n.id}`, "never visited by the trace");
  }

  // Trace hops must be reachable on the link graph (undirected, as the renderer's BFS is).
  if (spec.trace && spec.trace.length > 1) {
    const adj = new Map<string, string[]>();
    for (const l of spec.links) {
      adj.set(l.from, [...(adj.get(l.from) ?? []), l.to]);
      adj.set(l.to, [...(adj.get(l.to) ?? []), l.from]);
    }
    const reach = (a: string, b: string) => {
      const seen = new Set([a]);
      const q = [a];
      while (q.length) {
        const cur = q.shift()!;
        if (cur === b) return true;
        for (const nx of adj.get(cur) ?? []) if (!seen.has(nx)) (seen.add(nx), q.push(nx));
      }
      return false;
    };
    for (let i = 1; i < spec.trace.length; i++) {
      const a = spec.trace[i - 1]!.node;
      const b = spec.trace[i]!.node;
      if (ids.has(a) && ids.has(b) && !reach(a, b)) err("trace-unreachable", `trace[${i}]`, `no path from "${a}" to "${b}"`);
    }
  }

  return issues;
}

type Report = (rule: string, path: string, message: string) => void;

function validateZones(spec: DiagramSpec, nodeIds: Set<string>, err: Report, warn: Report) {
  const zones = spec.zones ?? [];
  const zoneIds = new Set<string>();
  const owner = new Map<string, string>();
  const parentOf = new Map<string, string>();
  const hasChild = new Set<string>();

  zones.forEach((z, i) => {
    const p = `zones[${i}]`;
    if (!isStr(z.id) || !isStr(z.label)) return err("zone-invalid", p, "id and label required");
    if (zoneIds.has(z.id)) err("zone-duplicate", `${p}.id`, `duplicate zone "${z.id}"`);
    zoneIds.add(z.id);
    if (z.kind !== undefined && !ZONE_KINDS.includes(z.kind as ZoneKind))
      err("zone-kind-invalid", `${p}.kind`, `must be one of: ${ZONE_KINDS.join(", ")}`);
    z.members?.forEach((m, j) => {
      if (!nodeIds.has(m)) return err("zone-unknown-member", `${p}.members[${j}]`, `unknown node "${m}"`);
      const other = owner.get(m);
      if (other) err("zone-member-twice", `${p}.members[${j}]`, `"${m}" is already a member of zone "${other}"`);
      else owner.set(m, z.id);
    });
    const b = z.bounds;
    if (b && (![b.c0, b.r0, b.c1, b.r1].every(isNum) || b.c1 <= b.c0 || b.r1 <= b.r0))
      err("zone-bounds-invalid", `${p}.bounds`, "need c0<c1 and r0<r1");
    if (z.parent !== undefined) {
      if (z.parent === z.id) err("zone-own-parent", `${p}.parent`, "a zone cannot be its own parent");
      else parentOf.set(z.id, z.parent);
    }
  });

  zones.forEach((z, i) => {
    if (z.parent === undefined || z.parent === z.id) return;
    if (!zoneIds.has(z.parent)) return err("zone-unknown-parent", `zones[${i}].parent`, `unknown zone "${z.parent}"`);
    hasChild.add(z.parent);
    const seen = new Set([z.id]);
    for (let c: string | undefined = z.parent; c; c = parentOf.get(c)) {
      if (seen.has(c)) return err("zone-cycle", `zones[${i}].parent`, "parent chain forms a cycle");
      seen.add(c);
    }
  });

  zones.forEach((z, i) => {
    if (!z.bounds && !z.members?.length && !hasChild.has(z.id))
      err("zone-empty", `zones[${i}]`, "needs members, child zones or explicit bounds");
  });

  // Layout sanity, on the tight extents (before padding).
  const ext = zoneExtents(spec);
  const ancestors = (id: string) => {
    const out = new Set<string>();
    for (let c = parentOf.get(id); c && !out.has(c); c = parentOf.get(c)) out.add(c);
    return out;
  };
  const within = (id: string, zone: string) => id === zone || ancestors(id).has(zone);
  // A card is roughly 0.3 cell either side of its cell, 0.45 above (name plate) and 0.2 below. Use the padded bounds the renderer draws.
  const drawn = new Map(resolveZones(spec).map((z) => [z.id, z.bounds]));
  for (const z of zones) {
    const e = drawn.get(z.id);
    if (!e) continue;
    for (const n of spec.nodes) {
      const z2 = owner.get(n.id);
      if (z2 && within(z2, z.id)) continue;
      const hit = n.at.col + 0.3 >= e.c0 && n.at.col - 0.3 <= e.c1 && n.at.row + 0.2 >= e.r0 && n.at.row - 0.45 <= e.r1;
      if (hit) warn("zone-overlaps-node", `zones.${z.id}`, `the card for "${n.id}" overlaps this zone but the node is not a member`);
    }
  }
  for (let i = 0; i < zones.length; i++)
    for (let j = i + 1; j < zones.length; j++) {
      const a = zones[i]!;
      const b = zones[j]!;
      if (within(a.id, b.id) || within(b.id, a.id)) continue;
      const ea = ext.get(a.id);
      const eb = ext.get(b.id);
      if (ea && eb && ea.c0 <= eb.c1 && eb.c0 <= ea.c1 && ea.r0 <= eb.r1 && eb.r0 <= ea.r1)
        warn("zone-overlaps-zone", `zones.${a.id}`, `overlaps zone "${b.id}" without being nested`);
    }

  // Layers: a band covers the rows its nodes use, so two layers sharing rows draw over each other; a zone drawn on one floor cannot hold nodes from another.
  const layers = spec.layers ?? [];
  const layerIds = new Set(layers.map((l) => l.id));
  const rowsOf = new Map<string, [number, number]>();
  for (const n of spec.nodes) {
    if (n.layer === undefined || !layerIds.has(n.layer)) continue;
    const r = rowsOf.get(n.layer);
    rowsOf.set(n.layer, r ? [Math.min(r[0], n.at.row), Math.max(r[1], n.at.row)] : [n.at.row, n.at.row]);
  }
  for (let i = 0; i < layers.length; i++)
    for (let j = i + 1; j < layers.length; j++) {
      const a = rowsOf.get(layers[i]!.id);
      const b = rowsOf.get(layers[j]!.id);
      if (a && b && a[0] <= b[1] && b[0] <= a[1]) warn("layer-rows-overlap", `layers.${layers[i]!.id}`, `shares grid rows with layer "${layers[j]!.id}", so their bands overlap`);
    }
  const layerOfNode = new Map(spec.nodes.map((n) => [n.id, n.layer]));
  for (const z of zones) {
    const used = new Set((z.members ?? []).map((m) => layerOfNode.get(m)));
    if (used.size > 1) warn("layer-zone-mixed", `zones.${z.id}`, "holds nodes from more than one layer, so it cannot sit on a single floor");
  }

  // Traffic (a dependency moves no data, so it is exempt): a link that crosses the edge of a vpc or boundary zone should say which way. Innermost zone of each end decides.
  const edges = zones.filter((z) => z.kind === "vpc" || z.kind === "boundary");
  spec.links.forEach((l, i) => {
    if (!nodeIds.has(l.from) || !nodeIds.has(l.to) || l.from === l.to || l.pattern === "dependency") return;
    const fz = owner.get(l.from);
    const tz = owner.get(l.to);
    for (const z of edges) {
      const fromIn = !!fz && within(fz, z.id);
      const toIn = !!tz && within(tz, z.id);
      if (fromIn === toIn) continue;
      const dir: Traffic = fromIn ? "egress" : "ingress";
      const where = `${dir === "egress" ? "leaves" : "enters"} "${z.label}"`;
      if (l.traffic === undefined) warn("traffic-untagged", `links[${i}].traffic`, `link ${where}; tag it traffic: "${dir}"`);
      else if (l.traffic !== dir) warn("traffic-mismatch", `links[${i}].traffic`, `tagged "${l.traffic}" but the link ${where}`);
      return;
    }
  });
}

/**
 * Lints a spec and applies its `lintIgnore` entries. `suppressed` holds the warnings that were silenced on purpose, so a report can still count them.
 * Only warnings can be silenced; an entry with no reason, an unknown rule, or one that matched nothing is itself reported.
 */
export function lintSpec(input: unknown): { issues: Issue[]; suppressed: (Issue & { reason: string })[] } {
  const raw = collectIssues(input);
  const ignores = isObj(input) && Array.isArray(input.lintIgnore) ? input.lintIgnore : [];
  if (!ignores.length) return { issues: raw, suppressed: [] };

  const extra: Issue[] = [];
  const used = new Set<number>();
  const active: { i: number; rule: string; path?: string; reason: string }[] = [];
  ignores.forEach((entry, i) => {
    const at = `lintIgnore[${i}]`;
    if (!isObj(entry) || !isStr(entry.rule) || !isStr(entry.reason) || (entry.path !== undefined && !isStr(entry.path))) {
      extra.push({ severity: "error", rule: "lint-ignore-invalid", path: at, message: "needs a rule and a reason (a sentence on why this warning is accepted), and an optional path" });
      return;
    }
    if (!isRuleId(entry.rule) || RULES[entry.rule].severity !== "warning") {
      extra.push({ severity: "warning", rule: "lint-ignore-unknown-rule", path: `${at}.rule`, message: `"${entry.rule}" is not a rule that can be suppressed` });
      return;
    }
    active.push({ i, rule: entry.rule, path: entry.path as string | undefined, reason: entry.reason });
  });

  const issues: Issue[] = [];
  const suppressed: (Issue & { reason: string })[] = [];
  for (const issue of raw) {
    const hit = issue.severity === "warning" ? active.find((a) => a.rule === issue.rule && (a.path === undefined || a.path === issue.path)) : undefined;
    if (hit) {
      used.add(hit.i);
      suppressed.push({ ...issue, reason: hit.reason });
    } else issues.push(issue);
  }
  for (const a of active) if (!used.has(a.i)) extra.push({ severity: "warning", rule: "lint-ignore-unused", path: `lintIgnore[${a.i}]`, message: `"${a.rule}"${a.path ? ` at ${a.path}` : ""} matched nothing; delete this entry` });
  return { issues: [...issues, ...extra], suppressed };
}

/**
 * The issues a spec has, after its `lintIgnore` entries. A spec with no errors is safe to render;
 * warnings flag gaps in what the diagram explains.
 */
export function validateSpec(input: unknown): Issue[] {
  return lintSpec(input).issues;
}
