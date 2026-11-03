// Small deterministic checks over a spec, shaped for a tool caller (a CLI or an agent): plain JSON in, plain JSON out, no React.
// Errors carry a JSON Pointer so a caller can repair exactly the part that is wrong.
import { connectionsOf, describeConnections, zonePath } from "./describe.ts";
import { pointerOf } from "./lintFormat.ts";
import type { DiagramSpec } from "./schema.ts";
import { lintSpec } from "./validate.ts";

export type VerifyIssue = { severity: "error" | "warning"; rule: string; pointer: string; message: string };
export type VerifyReport = { ok: boolean; errors: number; warnings: number; suppressed: number; issues: VerifyIssue[] };

/** Validate and lint in one pass. `ok` means no errors (warnings do not fail it). */
export function verify(spec: unknown): VerifyReport {
  const { issues, suppressed } = lintSpec(spec);
  const list = issues.map((i) => ({ severity: i.severity, rule: i.rule, pointer: pointerOf(i.path), message: i.message }));
  const errors = list.filter((i) => i.severity === "error").length;
  return { ok: errors === 0, errors, warnings: list.length - errors, suppressed: suppressed.length, issues: list };
}

/** A short structured summary an agent can read instead of the whole spec. Expects a spec with no errors. */
export function describeSpec(spec: DiagramSpec) {
  return {
    title: spec.title,
    description: spec.description ?? null,
    counts: { nodes: spec.nodes.length, links: spec.links.length, zones: spec.zones?.length ?? 0, trace: spec.trace?.length ?? 0 },
    lenses: (spec.lenses ?? []).map((l) => l.id),
    zones: (spec.zones ?? []).map((z) => ({ id: z.id, label: z.label, kind: z.kind ?? "group", parent: z.parent ?? null, members: z.members ?? [] })),
    nodes: spec.nodes.map((n) => {
      const c = connectionsOf(spec, n.id);
      return { id: n.id, label: n.label, at: n.at, zone: zonePath(spec, n.id), in: c.incoming.length, out: c.outgoing.length, connections: describeConnections(spec, n.id) };
    }),
    trace: (spec.trace ?? []).map((t) => `${t.node}: ${t.label}`),
  };
}

type Change = { id: string; fields: string[] };
export type SpecDiff = {
  same: boolean;
  nodes: { added: string[]; removed: string[]; changed: Change[] };
  links: { added: string[]; removed: string[]; changed: Change[] };
  zones: { added: string[]; removed: string[]; changed: Change[] };
  trace: boolean;
  fields: string[];
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fieldsDiffer = (a: Record<string, unknown>, b: Record<string, unknown>) => [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().filter((k) => !same(a[k], b[k]));

function diffBy<T extends object>(a: T[], b: T[], key: (x: T) => string) {
  const ma = new Map(a.map((x) => [key(x), x]));
  const mb = new Map(b.map((x) => [key(x), x]));
  const changed: Change[] = [];
  for (const [k, x] of ma) {
    const y = mb.get(k);
    if (y) {
      const fields = fieldsDiffer(x as Record<string, unknown>, y as Record<string, unknown>);
      if (fields.length) changed.push({ id: k, fields });
    }
  }
  return { added: [...mb.keys()].filter((k) => !ma.has(k)).sort(), removed: [...ma.keys()].filter((k) => !mb.has(k)).sort(), changed: changed.sort((p, q) => p.id.localeCompare(q.id)) };
}

/** A link is matched by its `id` when it has one, otherwise by `from>to:label`, so a rename shows as one removal and one addition. */
export const linkKey = (l: { id?: string; from: string; to: string; label: string }) => l.id ?? `${l.from}>${l.to}:${l.label}`;

/** What changed between two specs, by id, never by array position. Both must be valid specs. */
export function diffSpecs(a: DiagramSpec, b: DiagramSpec): SpecDiff {
  const nodes = diffBy(a.nodes, b.nodes, (n) => n.id);
  const links = diffBy(a.links, b.links, linkKey);
  const zones = diffBy(a.zones ?? [], b.zones ?? [], (z) => z.id);
  const trace = !same(a.trace ?? [], b.trace ?? []);
  const rest = (s: DiagramSpec) => {
    const { nodes: _n, links: _l, zones: _z, trace: _t, ...o } = s;
    return o as Record<string, unknown>;
  };
  const fields = fieldsDiffer(rest(a), rest(b));
  const empty = (d: { added: string[]; removed: string[]; changed: Change[] }) => !d.added.length && !d.removed.length && !d.changed.length;
  return { same: empty(nodes) && empty(links) && empty(zones) && !trace && !fields.length, nodes, links, zones, trace, fields };
}

export type PatchOp = { op: "add" | "replace" | "remove" | "test"; path: string; value?: unknown };
export type PatchResult =
  | { ok: true; spec: unknown; report: VerifyReport }
  | { ok: false; reason: string; opIndex?: number; pointer?: string; newErrors?: VerifyIssue[] };

const BAD_SEGMENT = new Set(["__proto__", "constructor", "prototype"]);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function segments(pointer: string): string[] | null {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) return null;
  return pointer.slice(1).split("/").map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/**
 * Applies JSON Patch operations (RFC 6902: add, replace, remove, test) to a copy of the spec. The patch is refused as a whole if an
 * operation does not apply, or if it leaves the spec with an error the original did not have, so a caller never receives a broken spec.
 */
export function applyPatch(spec: unknown, ops: PatchOp[]): PatchResult {
  if (!Array.isArray(ops)) return { ok: false, reason: "patch must be an array of operations" };
  const before = verify(spec);
  const doc = { root: clone(spec) } as { root: unknown };
  const fail = (i: number, reason: string, pointer: string): PatchResult => ({ ok: false, reason, opIndex: i, pointer });

  for (let i = 0; i < ops.length; i++) {
    const o = ops[i]!;
    if (!o || typeof o !== "object" || typeof o.path !== "string" || !["add", "replace", "remove", "test"].includes(o.op)) return fail(i, "each operation needs an op (add, replace, remove or test) and a string path", "");
    const segs = segments(o.path);
    if (!segs) return fail(i, "path must be a JSON Pointer starting with /", o.path);
    if (segs.some((s) => BAD_SEGMENT.has(s))) return fail(i, "path uses a reserved name", o.path);
    if (o.op !== "remove" && !("value" in o)) return fail(i, `${o.op} needs a value`, o.path);

    if (!segs.length) {
      if (o.op === "remove") return fail(i, "cannot remove the whole spec", o.path);
      if (o.op === "test") {
        if (!same(doc.root, o.value)) return fail(i, "test failed: the spec differs from the value", o.path);
      } else doc.root = clone(o.value);
      continue;
    }
    let parent: unknown = doc.root;
    for (const s of segs.slice(0, -1)) {
      parent = Array.isArray(parent) ? parent[Number(s)] : parent && typeof parent === "object" ? (parent as Record<string, unknown>)[s] : undefined;
    }
    const last = segs[segs.length - 1]!;
    if (!parent || typeof parent !== "object") return fail(i, "the parent of this path does not exist", o.path);

    if (Array.isArray(parent)) {
      const idx = last === "-" ? parent.length : /^(0|[1-9]\d*)$/.test(last) ? Number(last) : -1;
      if (idx < 0) return fail(i, "array index must be a number or - (the end)", o.path);
      if (o.op === "add") {
        if (idx > parent.length) return fail(i, `index ${idx} is past the end (length ${parent.length})`, o.path);
        parent.splice(idx, 0, clone(o.value));
      } else {
        if (idx >= parent.length) return fail(i, `no item at index ${idx} (length ${parent.length})`, o.path);
        if (o.op === "replace") parent[idx] = clone(o.value);
        else if (o.op === "remove") parent.splice(idx, 1);
        else if (!same(parent[idx], o.value)) return fail(i, "test failed: the value differs", o.path);
      }
    } else {
      const obj = parent as Record<string, unknown>;
      const has = Object.prototype.hasOwnProperty.call(obj, last);
      if (o.op === "add") obj[last] = clone(o.value);
      else if (!has) return fail(i, "nothing exists at this path", o.path);
      else if (o.op === "replace") obj[last] = clone(o.value);
      else if (o.op === "remove") delete obj[last];
      else if (!same(obj[last], o.value)) return fail(i, "test failed: the value differs", o.path);
    }
  }

  const report = verify(doc.root);
  const had = new Set(before.issues.filter((x) => x.severity === "error").map((x) => `${x.rule}|${x.pointer}|${x.message}`));
  const newErrors = report.issues.filter((x) => x.severity === "error" && !had.has(`${x.rule}|${x.pointer}|${x.message}`));
  if (newErrors.length) return { ok: false, reason: `the patch would leave ${newErrors.length} new error${newErrors.length === 1 ? "" : "s"}; nothing was changed`, newErrors };
  return { ok: true, spec: doc.root, report };
}
