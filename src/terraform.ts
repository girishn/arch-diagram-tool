// Terraform plan JSON (`terraform show -json plan.out`) to a diagram spec, plus a hand-written overlay for what Terraform cannot know.
// Reads the JSON only: no HCL, no state backend, no credentials. Pure and deterministic (same input, same output), so `checkSpec`
// can regenerate in memory and compare with the committed spec to catch drift. React-free.
import type { Cell, DiagramLink, DiagramNode, DiagramSpec, DiagramZone } from "./schema.ts";
import { keptAttrs, ruleFor, TF_MAPPING } from "./tfMapping.ts";
import type { EdgeRule, JoinRule, NodeRule, ZoneRule } from "./tfMapping.ts";
import { diffSpecs, verify } from "./verify.ts";
import type { SpecDiff, VerifyIssue } from "./verify.ts";

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => typeof x === "object" && x !== null && !Array.isArray(x);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

// ---------------------------------------------------------------------------------------------------------------- reading the plan

type Mod = { prefix: string; parent?: Mod; varRaw: Record<string, string[]>; calls: Map<string, Mod>; outputs: Map<string, string[]> };
type CfgRes = { key: string; type: string; mode: string; name: string; mod: Mod; attrs: Record<string, string[]>; deps: string[] };

/** Every string under a `references` key, anywhere inside an expression (blocks nest and repeat). */
function collectRefs(x: unknown, out: string[] = []): string[] {
  if (Array.isArray(x)) x.forEach((v) => collectRefs(v, out));
  else if (isObj(x)) for (const [k, v] of Object.entries(x)) k === "references" && Array.isArray(v) ? out.push(...v.filter((s): s is string => typeof s === "string")) : collectRefs(v, out);
  return out;
}

function readModule(cfg: Json, prefix: string, parent: Mod | undefined, varRaw: Record<string, string[]>, all: CfgRes[]): Mod {
  const mod: Mod = { prefix, parent, varRaw, calls: new Map(), outputs: new Map() };
  for (const r of arr(cfg.resources)) {
    if (!isObj(r) || typeof r.address !== "string") continue;
    const attrs: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(isObj(r.expressions) ? r.expressions : {})) attrs[k] = collectRefs(v);
    all.push({ key: prefix + r.address, type: String(r.type), mode: String(r.mode), name: String(r.name), mod, attrs, deps: arr(r.depends_on).filter((s): s is string => typeof s === "string") });
  }
  for (const [k, o] of Object.entries(isObj(cfg.outputs) ? cfg.outputs : {})) mod.outputs.set(k, isObj(o) ? collectRefs(o.expression) : []);
  for (const [name, call] of Object.entries(isObj(cfg.module_calls) ? cfg.module_calls : {})) {
    if (!isObj(call)) continue;
    const inputs: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(isObj(call.expressions) ? call.expressions : {})) inputs[k] = collectRefs(v);
    mod.calls.set(name, readModule(isObj(call.module) ? call.module : {}, `${prefix}module.${name}.`, mod, inputs, all));
  }
  return mod;
}

const NOT_RESOURCES = new Set(["local", "each", "count", "path", "terraform", "self"]);

/** The resource keys a reference points at. `var.x` and `module.m.out` are followed through module boundaries; `local.x` cannot be (the plan does not carry local definitions). */
function refKeys(ref: string, mod: Mod, depth = 0): string[] {
  if (depth > 20) return [];
  const t = ref.replace(/\[[^\]]*\]/g, "").split(".");
  const head = t[0]!;
  if (head === "var") return mod.parent ? (mod.varRaw[t[1] ?? ""] ?? []).flatMap((r) => refKeys(r, mod.parent!, depth + 1)) : [];
  if (head === "module") {
    const child = mod.calls.get(t[1] ?? "");
    return child ? (child.outputs.get(t[2] ?? "") ?? []).flatMap((r) => refKeys(r, child, depth + 1)) : [];
  }
  if (NOT_RESOURCES.has(head)) return [];
  if (head === "data") return t.length >= 3 ? [`${mod.prefix}${t.slice(0, 3).join(".")}`] : [];
  return t.length >= 2 ? [`${mod.prefix}${t.slice(0, 2).join(".")}`] : [];
}

type Instance = { address: string; values: Json };
type Planned = { key: string; type: string; mode: string; name: string; instances: number; values: Json; inst: Instance[] };

/** `prefix` keeps resources from different plans apart when several are merged (empty for a single plan). */
function readPlanned(mod: unknown, out: Map<string, Planned>, prefix: string) {
  if (!isObj(mod)) return;
  for (const r of arr(mod.resources)) {
    if (!isObj(r) || typeof r.address !== "string") continue;
    const key = prefix + r.address.replace(/\[[^\]]*\]/g, "");
    const inst = { address: prefix + r.address, values: isObj(r.values) ? r.values : {} };
    const prior = out.get(key);
    if (prior) {
      prior.instances++;
      prior.inst.push(inst);
    } else out.set(key, { key, type: String(r.type), mode: String(r.mode), name: String(r.name), instances: 1, values: inst.values, inst: [inst] });
  }
  for (const c of arr(mod.child_modules)) readPlanned(c, out, prefix);
}

// -------------------------------------------------------------------------------------------------------------------------- overlay

/** The hand-written part. Everything here is something Terraform does not say; keys must match what was generated or `generate` reports an error. */
export type Overlay = {
  $schema?: string;
  version: 1;
  title?: string;
  description?: string;
  lenses?: DiagramSpec["lenses"];
  /** Tiers from top to bottom. Give each node its `layer` through `nodes`, or in `addNodes`. */
  layers?: DiagramSpec["layers"];
  trace?: DiagramSpec["trace"];
  prose?: DiagramSpec["prose"];
  lintIgnore?: DiagramSpec["lintIgnore"];
  /** Changes to generated nodes, keyed by node id or Terraform address (`aws_lambda_function.chat`). `detail` and `lenses` are merged; other fields replace. `at` pins a cell. */
  nodes?: Record<string, Partial<DiagramNode>>;
  /** Changes to generated links, keyed `fromId>toId`. */
  links?: Record<string, Partial<DiagramLink>>;
  /** Changes to generated zones, keyed by zone id or address. */
  zones?: Record<string, Partial<DiagramZone>>;
  /** Things Terraform cannot know: users, an external model provider, a trust boundary. A node without `at` is placed like a generated one. */
  addNodes?: (Omit<DiagramNode, "at"> & { at?: Cell })[];
  addLinks?: DiagramLink[];
  addZones?: DiagramZone[];
  /** Node ids or addresses to leave out. */
  hide?: string[];
};

// -------------------------------------------------------------------------------------------------------------------------- generate

export type TfReport = {
  resources: number;
  nodes: number;
  zones: number;
  links: number;
  /** Permission arrows (value joins) that matched a rule but whose values were unknown or named nothing drawn. Usually values are unknown until apply. */
  unresolved: number;
  /** Managed resource types with no mapping rule, with counts. They are not drawn; add a rule to draw them. */
  unmapped: Record<string, number>;
  /** Types deliberately not drawn (rule kind skip). */
  skipped: Record<string, number>;
  warnings: string[];
  /** Overlay keys that matched nothing, and other reasons to fail. */
  errors: string[];
  issues: VerifyIssue[];
};

const slug = (s: string) => s.toLowerCase().replace(/^aws_/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const humanise = (s: string) => {
  const t = s.replace(/[_-]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);

/** Ids read as `fn-chat`, `bucket-docs`, `vpc-main`: a short type word and the Terraform name (a module's name stands in for `this`, `main` and `default`). Sorted first, so file order never matters. */
function assignIds(items: { key: string; short: string; name: string }[]): Map<string, string> {
  const ids = new Map<string, string>();
  const used = new Set<string>();
  for (const r of [...items].sort((a, b) => a.key.localeCompare(b.key))) {
    const mods = [...r.key.matchAll(/module\.([^.]+)\./g)].map((m) => m[1]!);
    const base = ["this", "main", "default"].includes(r.name) && mods.length ? mods[mods.length - 1]! : r.name;
    const lone = r.name === "this" && !mods.length; // the idiom for a single instance: `eks`, not `eks-this`
    const pre = (stem: string) => (stem.startsWith(`${r.short}-`) ? stem : `${r.short}-${stem}`); // `svc-replay-tool` stays, it is not `svc-svc-replay-tool`
    const id = [...(lone ? [r.short] : []), pre(slug(base)), pre(slug(mods.concat(base).join("-")))].find((t) => !used.has(t)) ?? `${slug(r.key)}-${used.size}`;
    used.add(id);
    ids.set(r.key, id);
  }
  return ids;
}

/**
 * Longest-path columns (back edges of a cycle are ignored). Each connected group of cards is laid out on its own and the groups are stacked, so a zone
 * around one group can never swallow another's cards. Inside a group, rows are ordered by sweeping the mean row of each card's neighbours (fewer crossings),
 * and each column is centred. Cards nothing links to go in a block underneath. Pinned cells are kept and never reused.
 */
function place(ids: string[], edges: [string, string][], pins: Map<string, Cell>): Map<string, Cell> {
  const preds = new Map<string, string[]>(ids.map((i) => [i, []]));
  const nbrs = new Map<string, string[]>(ids.map((i) => [i, []]));
  for (const [a, b] of edges) {
    if (a === b || !preds.has(a) || !preds.has(b)) continue;
    preds.get(b)!.push(a);
    nbrs.get(a)!.push(b);
    nbrs.get(b)!.push(a);
  }
  for (const p of preds.values()) p.sort();
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const dep = (n: string): number => {
    if (depth.has(n)) return depth.get(n)!;
    visiting.add(n);
    let d = 0;
    for (const p of preds.get(n)!) if (!visiting.has(p)) d = Math.max(d, dep(p) + 1);
    visiting.delete(n);
    depth.set(n, d);
    return d;
  };
  [...ids].sort().forEach(dep);

  const out = new Map<string, Cell>(pins);
  const pinCells = new Set([...pins.values()].map((c) => `${c.col},${c.row}`));
  const linked = new Set(edges.flatMap(([a, b]) => (a === b ? [] : [a, b])));
  const loose = ids.filter((i) => !pins.has(i) && !linked.has(i)).sort();
  const free = ids.filter((i) => !pins.has(i) && linked.has(i)).sort();

  // connected groups, biggest first
  const seen = new Set<string>();
  const groups: string[][] = [];
  for (const start of free) {
    if (seen.has(start)) continue;
    const group: string[] = [];
    for (const queue = [start]; queue.length; ) {
      const n = queue.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      group.push(n);
      for (const m of nbrs.get(n)!) if (!seen.has(m) && !pins.has(m)) queue.push(m);
    }
    groups.push(group.sort());
  }
  groups.sort((a, b) => b.length - a.length || a[0]!.localeCompare(b[0]!));

  let base = pins.size ? Math.max(...[...pins.values()].map((c) => c.row)) + 2 : 0;
  for (const group of groups) {
    const cols = [...new Set(group.map((i) => depth.get(i)!))].sort((a, b) => a - b);
    const colList = new Map(cols.map((c) => [c, group.filter((i) => depth.get(i) === c)]));
    const tallest = Math.max(...[...colList.values()].map((l) => l.length));
    const lay = (col: number, list: string[]) => {
      let r = base + Math.floor((tallest - list.length) / 2);
      for (const n of list) {
        while (pinCells.has(`${col},${r}`)) r++;
        out.set(n, { col, row: r++ });
      }
    };
    for (const [col, list] of colList) lay(col, list); // a first order (by id), then refined
    for (let it = 0; it < 8; it++) {
      for (const col of it % 2 === 0 ? cols : [...cols].reverse()) {
        const list = colList.get(col)!;
        const key = new Map(list.map((n) => {
          const rows = nbrs.get(n)!.flatMap((m) => (out.has(m) ? [out.get(m)!.row] : []));
          return [n, rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : out.get(n)!.row] as const;
        }));
        list.sort((a, b) => key.get(a)! - key.get(b)! || a.localeCompare(b));
        lay(col, list);
      }
    }
    base = Math.max(...group.map((n) => out.get(n)!.row)) + 2;
  }

  // Cards nothing links to would stack in one tall column; put them in a block under the rest instead.
  const taken = new Set([...out.values()].map((c) => `${c.col},${c.row}`));
  const wide = Math.max(1, Math.min(6, Math.ceil(Math.sqrt(loose.length * 2))));
  loose.forEach((n, k) => {
    const col = k % wide;
    let row = base + Math.floor(k / wide);
    while (taken.has(`${col},${row}`)) row++;
    taken.add(`${col},${row}`);
    out.set(n, { col, row });
  });
  return out;
}

/**
 * The table names a SQL statement reads (after FROM, JOIN, or TABLE as in a windowing function) and writes (after INTO), with quotes removed and comments ignored. A name may be
 * qualified (`env`.`cluster`.`topic`); the caller tries each shorter tail, since topic names contain dots themselves.
 */
export function sqlTables(sql: string): { reads: string[]; writes: string[] } {
  const text = sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
  const reads: string[] = [];
  const writes: string[] = [];
  for (const m of text.matchAll(/\b(?<!CREATE\s+)(INTO|FROM|JOIN|TABLE)\s+((?:`[^`]+`|"[^"]+"|[A-Za-z0-9_\-.]+)(?:\s*\.\s*(?:`[^`]+`|"[^"]+"|[A-Za-z0-9_\-]+))*)/gi)) {
    const name = m[2]!.replace(/[`"\s]/g, "");
    if (name && !/^table$/i.test(name)) (m[1]!.toUpperCase() === "INTO" ? writes : reads).push(name);
  }
  return { reads, writes };
}

/** Merge one overlay patch into a generated object. `detail` and `lenses` merge by key; everything else replaces. */
function patchNode<T extends object>(base: T, patch: Partial<T>): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    const cur = out[k];
    out[k] = (k === "detail" || k === "lenses") && isObj(cur) && isObj(v) ? { ...cur, ...v } : v;
  }
  return out as T;
}

export function generateFromPlan(plan: unknown, overlay: Overlay = { version: 1 }) {
  return generateFromPlans([{ name: "", plan }], overlay);
}

/** One or several plans (or state files) merged into one diagram, e.g. a repo with a root module per concern. With several, each resource is keyed `name/address` so equal addresses in different plans stay apart. */
export function generateFromPlans(inputs: { name: string; plan: unknown }[], overlay: Overlay = { version: 1 }): { spec: DiagramSpec; report: TfReport } {
  const report: TfReport = { resources: 0, nodes: 0, zones: 0, links: 0, unresolved: 0, unmapped: {}, skipped: {}, warnings: [], errors: [], issues: [] };
  const planned = new Map<string, Planned>();
  const cfgRes: CfgRes[] = [];
  for (const { name, plan } of inputs) {
    const label = name || "the input";
    if (!isObj(plan)) throw new Error(`${label}: not a Terraform plan or state JSON (expected an object)`);
    const rootValues = (isObj(plan.planned_values) ? plan.planned_values : isObj(plan.values) ? plan.values : undefined)?.root_module;
    if (!isObj(rootValues)) throw new Error(`${label}: not a Terraform plan or state JSON: no planned_values.root_module or values.root_module (use \`terraform show -json\`)`);
    const prefix = inputs.length > 1 ? `${name}/` : "";
    readPlanned(rootValues, planned, prefix);
    if (isObj(plan.configuration) && isObj(plan.configuration.root_module)) readModule(plan.configuration.root_module, prefix, undefined, {}, cfgRes);
    else report.warnings.push(`${label}: no configuration section (a state file, not a plan): cards and zones are drawn, and links come only from permission values, not references`);
  }
  const cfg = new Map(cfgRes.map((c) => [c.key, c]));
  /** The resource a drawn instance came from (`a.b["k"]` is `a.b`), so its references can be looked up. */
  const baseOf = new Map<string, string>();
  /** Resolved resource keys per attribute of a resource. */
  const refsOf = (key: string, attr?: string): string[] => {
    const c = cfg.get(baseOf.get(key) ?? key);
    if (!c) return [];
    const raw = attr ? (c.attrs[attr] ?? []) : [...Object.values(c.attrs).flat(), ...c.deps];
    return [...new Set(raw.flatMap((r) => refKeys(r, c.mod)))].sort();
  };

  // classify
  type Unit = Planned & { rule: NodeRule };
  const nodeRes: Unit[] = [];
  const joinRes: (Planned & { rule: JoinRule })[] = [];
  const zoneRes: (Planned & { rule: ZoneRule })[] = [];
  const edgeRes: (Planned & { rule: EdgeRule })[] = [];
  for (const p of [...planned.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    if (p.mode !== "managed") continue;
    report.resources++;
    const rule = ruleFor(p.type, p.mode);
    if (!rule) bump(report.unmapped, p.type);
    else if (rule.kind === "skip") bump(report.skipped, p.type);
    else if (rule.kind === "node" && rule.perInstance) {
      // one card per instance, named from an attribute (falling back to the instance key)
      for (const i of p.inst) {
        const idx = /\[(?:"([^"]*)"|(\d+))\][^\]]*$/.exec(i.address);
        const attr = i.values[rule.perInstance.labelAttr];
        nodeRes.push({ ...p, key: i.address, name: typeof attr === "string" ? attr : (idx?.[1] ?? idx?.[2] ?? p.name), instances: 1, values: i.values, inst: [i], rule });
        baseOf.set(i.address, p.key);
      }
    } else if (rule.kind === "node") nodeRes.push({ ...p, rule });
    else if (rule.kind === "join") joinRes.push({ ...p, rule });
    else if (rule.kind === "zone") zoneRes.push({ ...p, rule });
    else if (rule.kind === "edge") edgeRes.push({ ...p, rule });
  }
  const idOf = assignIds([...nodeRes.map((n) => ({ key: n.key, short: n.rule.short, name: n.name })), ...zoneRes.map((z) => ({ key: z.key, short: z.rule.zoneKind === "subnet" ? "subnet" : "vpc", name: z.name }))]);
  const nodeKeys = new Set(nodeRes.map((n) => n.key));
  /** A reference points at a resource; if that is drawn as one card per instance, it means all of them. */
  const instKeys = new Map<string, string[]>();
  for (const n of nodeRes) {
    const base = baseOf.get(n.key);
    if (base) (instKeys.get(base) ?? instKeys.set(base, []).get(base)!).push(n.key);
  }
  const drawn = (k: string): string[] => instKeys.get(k) ?? (nodeKeys.has(k) ? [k] : []);
  const zoneKeys = new Set(zoneRes.map((z) => z.key));

  // links: connector resources, IAM permissions, then plain references; one link per ordered pair
  type Cand = { from: string; to: string; label: string; pattern: DiagramLink["pattern"]; prio: number; src: string };
  const cands: Cand[] = [];
  for (const e of edgeRes) {
    const from = refsOf(e.key, e.rule.from).flatMap(drawn);
    const to = refsOf(e.key, e.rule.to).flatMap(drawn);
    for (const a of from) for (const b of to) if (a !== b) cands.push({ from: a, to: b, label: e.rule.label, pattern: e.rule.pattern, prio: e.rule.priority, src: e.key });
  }
  // What each IAM policy reaches: follow references through resources that are not drawn (policy documents), stop at drawn ones.
  const reach = (key: string, seen = new Set<string>()): string[] => {
    if (seen.has(key)) return [];
    seen.add(key);
    const passThrough = (k: string) => {
      const c = cfg.get(k);
      return c !== undefined && c.type !== "aws_iam_role" && ruleFor(c.type, c.mode)?.kind === "attach";
    };
    return refsOf(key).flatMap((k) => (drawn(k).length ? drawn(k) : passThrough(k) ? reach(k, seen) : []));
  };
  const policiesOf = (role: string): string[] => {
    const out: string[] = [];
    for (const c of cfgRes) {
      if (c.type === "aws_iam_role_policy" && refsOf(c.key, "role").includes(role)) out.push(c.key);
      if (c.type === "aws_iam_role_policy_attachment" && refsOf(c.key, "role").includes(role)) out.push(...refsOf(c.key, "policy_arn").filter((k) => cfg.get(k)?.type === "aws_iam_policy"));
    }
    return out;
  };
  for (const n of nodeRes) {
    const refs = refsOf(n.key);
    for (const role of refs.filter((k) => cfg.get(k)?.type === "aws_iam_role"))
      for (const pol of policiesOf(role)) for (const t of reach(pol)) if (t !== n.key) cands.push({ from: n.key, to: t, label: "Uses (IAM)", pattern: "request-response", prio: 1, src: pol });
    for (const t of refs.flatMap(drawn).filter((k) => k !== n.key && (baseOf.get(k) === undefined || baseOf.get(k) !== baseOf.get(n.key)))) cands.push({ from: n.rule.refs?.flip ? t : n.key, to: n.rule.refs?.flip ? n.key : t, label: n.rule.refs?.label ?? "Uses", pattern: "request-response", prio: 0, src: baseOf.get(n.key) ?? n.key });
  }
  // Value joins (Kafka ACLs): find each end by matching an attribute value, so this works on state as well as on a plan.
  const byValue = new Map<string, string>();
  for (const rule of Object.values(TF_MAPPING)) {
    if (rule.kind !== "join") continue;
    for (const e of [rule.a, rule.b]) for (const n of nodeRes) if (n.type === e.type && typeof n.values[e.on] === "string") byValue.set(`${e.type}\0${e.on}\0${n.values[e.on]}`, n.key);
  }
  const endOf = (e: JoinRule["a"], v: unknown): string | undefined => {
    if (typeof v !== "string") return undefined;
    return byValue.get(`${e.type}\0${e.on}\0${e.strip && v.startsWith(e.strip) ? v.slice(e.strip.length) : v}`);
  };
  /** Every drawn resource of `e.type` whose `e.on` value starts with `prefix`. */
  const startingWith = (e: JoinRule["a"], prefix: string): string[] => nodeRes.filter((n) => n.type === e.type && typeof n.values[e.on] === "string" && (n.values[e.on] as string).startsWith(prefix)).map((n) => n.key);
  for (const j of joinRes) {
    for (const i of j.inst) {
      const known = Object.keys(j.rule.where).every((k) => k in i.values);
      if (!known) {
        report.unresolved++; // the value that decides whether this applies is not known yet
        continue;
      }
      if (!Object.entries(j.rule.where).every(([k, v]) => i.values[k] === v)) continue; // another kind of ACL (cluster, group): not drawn
      const op = i.values[j.rule.byAttr];
      if (typeof op !== "string") {
        report.unresolved++;
        continue;
      }
      const dir = j.rule.direction[op];
      if (!dir) continue; // an operation this rule does not draw (DESCRIBE, CREATE, ...)
      const a = endOf(j.rule.a, i.values[j.rule.a.attr]);
      const pw = j.rule.b.prefixWhen;
      const how = pw ? i.values[pw.attr] : undefined;
      if (pw && how !== pw.literal && how !== pw.prefixed) {
        if (how === undefined) report.unresolved++;
        continue; // a pattern this rule does not draw (MATCH, ANY)
      }
      // a prefix ACL reaches every drawn resource that starts with it, possibly none (the names may belong to topics Terraform does not manage)
      const prefixed = pw !== undefined && how === pw.prefixed;
      const target = i.values[j.rule.b.attr];
      const bs = prefixed ? (typeof target === "string" ? startingWith(j.rule.b, target) : []) : [endOf(j.rule.b, target)].filter((x): x is string => x !== undefined);
      if (!a || (!bs.length && !prefixed)) {
        report.unresolved++;
        continue;
      }
      for (const b of bs) cands.push({ from: dir === "a>b" ? a : b, to: dir === "a>b" ? b : a, label: j.rule.label[op] ?? op, pattern: j.rule.pattern, prio: j.rule.priority, src: j.key });
    }
  }
  // Jobs whose SQL names what they read and write (Flink statements)
  for (const n of nodeRes) {
    const sr = n.rule.sqlRefs;
    const sql = sr ? n.values[sr.attr] : undefined;
    if (!sr || typeof sql !== "string") continue;
    const byName = new Map(nodeRes.filter((t) => t.type === sr.type && typeof t.values[sr.on] === "string").map((t) => [t.values[sr.on] as string, t.key]));
    const { reads, writes } = sqlTables(sql);
    const hit = (names: string[]) =>
      names.flatMap((nm) => {
        const parts = nm.split(".");
        for (let k = 0; k < parts.length; k++) {
          const found = byName.get(parts.slice(k).join("."));
          if (found) return [found];
        }
        return [];
      });
    for (const t of hit(reads)) cands.push({ from: t, to: n.key, label: "Reads", pattern: "stream", prio: 5, src: n.key });
    for (const t of hit(writes)) cands.push({ from: n.key, to: t, label: "Writes", pattern: "stream", prio: 5, src: n.key });
  }
  const merged = new Map<string, Cand[]>();
  for (const c of cands) (merged.get(`${c.from}>${c.to}`) ?? merged.set(`${c.from}>${c.to}`, []).get(`${c.from}>${c.to}`)!).push(c);

  let nodes: (Omit<DiagramNode, "at"> & { at?: Cell })[] = nodeRes.map((n) => {
    const generic = ["this", "main", "default"].includes(n.name) && !n.rule.perInstance; // a name that says nothing: use the kind of thing it is
    // Several instances (count, for_each, or a module with for_each) are one stacked card with a badge; the keys, when there are any, are named.
    const keys = [...new Set(n.inst.flatMap((i) => [...i.address.matchAll(/\["([^"]*)"\]/g)].map((m) => m[1]!)))].sort();
    const pw = n.rule.perInstance?.peripheralWhen;
    const peripheral = n.rule.peripheral || (pw !== undefined && typeof n.values[pw.attr] === "string" && (n.values[pw.attr] as string).endsWith(pw.endsWith));
    return {
      id: idOf.get(n.key)!,
      label: n.rule.perInstance ? n.name : generic ? n.rule.sub : humanise(n.name),
      sub: generic ? n.type : n.rule.sub,
      ...(n.instances > 1 ? { scale: { min: n.instances, max: n.instances, unit: "instances" } } : {}),
      icons: [n.rule.icon],
      ...(peripheral ? { peripheral: true } : {}),
      detail: { tag: n.type, role: n.rule.role + (keys.length > 1 ? ` One per ${keys.join(", ")}.` : "") },
      "x-tf": n.key,
    };
  });
  // A permission or plain reference (weak) that runs against a connector arrow (strong) between the same two cards is the same relationship seen twice,
  // for example a queue that triggers a function and the function's permission to read the queue. Draw the connector only.
  const top = (list: Cand[]) => Math.max(...list.map((c) => c.prio));
  const reversed = ([key, list]: [string, Cand[]]) => {
    const [a, b] = [list[0]!.from, list[0]!.to];
    const back = merged.get(`${b}>${a}`);
    return top(list) <= 1 && back !== undefined && top(back) >= 3;
  };
  let links: DiagramLink[] = [...merged.entries()]
    .filter((e) => !reversed(e))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, list]) => {
      const best = [...list].sort((a, b) => b.prio - a.prio || a.label.localeCompare(b.label))[0]!;
      const srcs = [...new Set(list.map((c) => c.src))].sort();
      const from = idOf.get(best.from)!;
      const to = idOf.get(best.to)!;
      return { id: `${from}_to_${to}`, from, to, label: best.label, pattern: best.pattern, detail: `Derived from Terraform: ${srcs.join(", ")}.`, "x-tf": srcs } as DiagramLink;
    });

  // zones
  const zoneOfNode = (key: string): string | undefined => {
    const refs = refsOf(key).filter((k) => zoneKeys.has(k));
    return refs.find((k) => zoneRes.find((z) => z.key === k)!.rule.zoneKind === "subnet") ?? refs[0];
  };
  const members = new Map<string, string[]>();
  for (const n of nodeRes) {
    const z = zoneOfNode(n.key);
    if (z) (members.get(z) ?? members.set(z, []).get(z)!).push(idOf.get(n.key)!);
  }
  let zones: DiagramZone[] = zoneRes.map((z) => {
    const parent = z.rule.parentAttr ? refsOf(z.key, z.rule.parentAttr).find((k) => zoneKeys.has(k)) : undefined;
    const m = (members.get(z.key) ?? []).sort();
    return { id: idOf.get(z.key)!, label: z.name === "this" ? (z.rule.zoneKind === "vpc" ? "VPC" : humanise(z.rule.zoneKind)) : humanise(z.name), kind: z.rule.zoneKind, ...(m.length ? { members: m } : {}), ...(parent ? { parent: idOf.get(parent)! } : {}), "x-tf": z.key } as DiagramZone;
  });
  // A zone with nothing in it and nothing inside it is noise.
  const keep = (z: DiagramZone): boolean => Boolean(z.members?.length) || zones.some((c) => c.parent === z.id && keep(c));
  zones = zones.filter(keep);

  // A link between a node inside a VPC and one outside it crosses the VPC edge; say which way (the overlay can override).
  const vpcOf = (nodeId: string): string | undefined => {
    let z = zones.find((q) => q.members?.includes(nodeId));
    while (z) {
      if (z.kind === "vpc") return z.id;
      z = z.parent ? zones.find((q) => q.id === z!.parent) : undefined;
    }
    return undefined;
  };
  links = links.map((l) => {
    const [a, b] = [vpcOf(l.from), vpcOf(l.to)];
    return a === b ? l : { ...l, traffic: b ? "ingress" : "egress" };
  });

  // overlay
  const find = <T extends { id: string; "x-tf"?: unknown }>(list: T[], k: string) => list.find((x) => x.id === k || x["x-tf"] === k);
  for (const [k, p] of Object.entries(overlay.nodes ?? {})) {
    const t = find(nodes, k);
    if (!t) report.errors.push(`overlay.nodes["${k}"] matches no generated node`);
    else nodes = nodes.map((n) => (n === t ? patchNode(n, p as Partial<typeof n>) : n));
  }
  for (const [k, p] of Object.entries(overlay.links ?? {})) {
    const t = links.find((l) => `${l.from}>${l.to}` === k || l.id === k);
    if (!t) report.errors.push(`overlay.links["${k}"] matches no generated link (keys look like "from>to", using node ids)`);
    else links = links.map((l) => (l === t ? patchNode(l, p) : l));
  }
  for (const [k, p] of Object.entries(overlay.zones ?? {})) {
    const t = find(zones, k);
    if (!t) report.errors.push(`overlay.zones["${k}"] matches no generated zone`);
    else zones = zones.map((z) => (z === t ? patchNode(z, p) : z));
  }
  const ids = new Set([...nodes, ...zones].map((x) => x.id));
  for (const a of [...(overlay.addNodes ?? []), ...(overlay.addZones ?? [])]) if (ids.has(a.id)) report.errors.push(`overlay adds "${a.id}" but a generated node or zone has that id`);
  nodes = [...nodes, ...(overlay.addNodes ?? [])];
  links = [...links, ...(overlay.addLinks ?? [])];
  zones = [...zones, ...(overlay.addZones ?? [])];
  for (const k of overlay.hide ?? []) {
    const t = find(nodes, k);
    if (!t) report.errors.push(`overlay.hide "${k}" matches no node`);
    else {
      nodes = nodes.filter((n) => n !== t);
      links = links.filter((l) => l.from !== t.id && l.to !== t.id);
      zones = zones.map((z) => (z.members?.includes(t.id) ? { ...z, members: z.members.filter((m) => m !== t.id) } : z));
    }
  }
  zones = zones.filter((z) => z.members?.length || zones.some((c) => c.parent === z.id) || overlay.addZones?.some((a) => a.id === z.id));

  // positions: pinned cells stay, the rest are layered
  const pins = new Map<string, Cell>();
  for (const n of nodes) if (n.at) pins.set(n.id, n.at);
  const cells = place(nodes.map((n) => n.id), links.map((l) => [l.from, l.to]), pins);
  const placed: DiagramNode[] = nodes.map((n) => ({ ...n, at: cells.get(n.id)! }));

  const spec: DiagramSpec = {
    ...(overlay.$schema ? { $schema: overlay.$schema } : {}),
    version: 1,
    title: overlay.title ?? "Infrastructure from Terraform",
    ...(overlay.description ? { description: overlay.description } : {}),
    ...(overlay.lenses ? { lenses: overlay.lenses } : {}),
    nodes: placed,
    links,
    ...(overlay.layers ? { layers: overlay.layers } : {}),
    ...(zones.length ? { zones } : {}),
    ...(overlay.trace ? { trace: overlay.trace } : {}),
    ...(overlay.prose ? { prose: overlay.prose } : {}),
    ...(overlay.lintIgnore ? { lintIgnore: overlay.lintIgnore } : {}),
  };
  report.nodes = placed.length;
  report.zones = zones.length;
  report.links = links.length;
  report.issues = verify(spec).issues;
  return { spec, report };
}

// ----------------------------------------------------------------------------------------------------------------------------- check

/** Key order does not matter for equality; array order does (the generator sorts, so a committed spec made by it matches). */
export function canonical(x: unknown): string {
  const norm = (v: unknown): unknown => (Array.isArray(v) ? v.map(norm) : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])])) : v);
  return JSON.stringify(norm(x));
}

/** Whether the committed spec is what the plan and overlay generate now. When it is not, `diff` says what moved. */
export function checkSpec(generated: DiagramSpec, committed: unknown): { ok: boolean; diff: SpecDiff | null } {
  if (canonical(generated) === canonical(committed)) return { ok: true, diff: null };
  return { ok: false, diff: verify(committed).ok ? diffSpecs(committed as DiagramSpec, generated) : null };
}

// ---------------------------------------------------------------------------------------------------------------------------- strip

/**
 * Reduces a plan or state to what the generator reads: addresses and types, the references between resources (never the values behind them),
 * and the few attributes the mapping table names (see `keptAttrs`). Safe to share: account ids, keys, ARNs and secrets are not in the result.
 * Only plain strings, numbers and booleans survive, and only for the attributes the mapping asks for.
 */
export function stripPlan(plan: unknown): unknown {
  if (!isObj(plan)) throw new Error("not a Terraform plan or state JSON (expected an object)");
  const keep = keptAttrs();
  const values = (mod: unknown): Json => {
    if (!isObj(mod)) return {};
    const resources = arr(mod.resources).filter(isObj).map((r) => {
      const want = keep[String(r.type)];
      const v: Json = {};
      if (want && isObj(r.values)) for (const k of want) if (["string", "number", "boolean"].includes(typeof r.values[k])) v[k] = r.values[k];
      return { address: r.address, mode: r.mode, type: r.type, name: r.name, ...(r.index !== undefined ? { index: r.index } : {}), values: v };
    });
    return { resources, ...(arr(mod.child_modules).length ? { child_modules: arr(mod.child_modules).map(values) } : {}), ...(isObj(mod) && typeof mod.address === "string" ? { address: mod.address } : {}) };
  };
  const refsOnly = (expressions: unknown): Json => {
    const out: Json = {};
    for (const [k, v] of Object.entries(isObj(expressions) ? expressions : {})) {
      const refs = collectRefs(v);
      if (refs.length) out[k] = { references: refs };
    }
    return out;
  };
  const config = (mod: unknown): Json => {
    if (!isObj(mod)) return {};
    const calls: Json = {};
    for (const [name, call] of Object.entries(isObj(mod.module_calls) ? mod.module_calls : {})) if (isObj(call)) calls[name] = { expressions: refsOnly(call.expressions), module: config(call.module) };
    const outputs: Json = {};
    for (const [name, o] of Object.entries(isObj(mod.outputs) ? mod.outputs : {})) if (isObj(o)) outputs[name] = { expression: { references: collectRefs(o.expression) } };
    return {
      resources: arr(mod.resources).filter(isObj).map((r) => ({ address: r.address, mode: r.mode, type: r.type, name: r.name, expressions: refsOnly(r.expressions), ...(arr(r.depends_on).length ? { depends_on: r.depends_on } : {}) })),
      module_calls: calls,
      outputs,
    };
  };
  const src = isObj(plan.planned_values) ? plan.planned_values : isObj(plan.values) ? plan.values : undefined;
  return {
    format_version: plan.format_version,
    ...(isObj(plan.planned_values) ? { planned_values: { root_module: values(src?.root_module) } } : { values: { root_module: values(src?.root_module) } }),
    ...(isObj(plan.configuration) ? { configuration: { root_module: config(plan.configuration.root_module) } } : {}),
  };
}
