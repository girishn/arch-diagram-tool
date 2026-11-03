// Terraform plan or state JSON to a diagram spec. Several plans (a repo with a root module per concern) merge into one diagram.
//   node scripts/tf.ts generate <plan.json>... [--overlay overlay.json] [--out spec.json]
//   node scripts/tf.ts check    <plan.json>... --spec spec.json [--overlay overlay.json]
//   node scripts/tf.ts pin      <plan.json>... --overlay overlay.json   (writes every card's current cell into the overlay, so a later plan change cannot move them)
//   node scripts/tf.ts strip    <plan.json> [--out stripped.json]       (keeps only what the generator reads, so the file is safe to share)
// Make the JSON with `terraform show -json plan.out > plan.json`, or `terraform show -json > state.json` for what is deployed now.
// Only the JSON is read: no HCL, no state backend, no credentials. Permission arrows (Kafka ACLs) need known values: use state, or a plan made after the first apply.
// Exit codes: 0 ok, 1 the spec has errors, an overlay key matches nothing, or (check) the committed spec has drifted, 2 usage or read problem.
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { checkSpec, generateFromPlans, stripPlan } from "../src/terraform.ts";
import type { Overlay } from "../src/terraform.ts";

const [cmd, ...rest] = process.argv.slice(2);
const files: string[] = [];
const flags: Record<string, string> = {};
for (let i = 0; i < rest.length; i++) {
  if (rest[i]!.startsWith("--")) {
    if (rest[i + 1] === undefined) usage(`${rest[i]} needs a value`);
    flags[rest[i]!.slice(2)] = rest[++i]!;
  } else files.push(rest[i]!);
}
function usage(m: string): never {
  console.error(`${m}\nusage: node scripts/tf.ts generate|check|pin <plan.json>... [--overlay f] [--out f] [--spec f] | strip <plan.json> [--out f]`);
  process.exit(2);
}
const read = (p: string) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    console.error(`cannot read or parse ${p}: ${(e as Error).message}`);
    process.exit(2);
  }
};
if (!["generate", "check", "pin", "strip"].includes(cmd ?? "") || !files.length) usage("give a command and at least one plan file");
if (cmd === "check" && !flags.spec) usage("check needs --spec");
if (cmd === "pin" && !flags.overlay) usage("pin needs --overlay (the file it writes to)");

if (cmd === "strip") {
  if (files.length !== 1) usage("strip takes one file");
  let text: string;
  try {
    text = JSON.stringify(stripPlan(read(files[0]!)), null, 2) + "\n";
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
  if (flags.out) writeFileSync(flags.out, text);
  else process.stdout.write(text);
  process.exit(0);
}

// With several files each plan is named after its file (`confluent-topics.json` gives `confluent-topics`), which prefixes its resources.
const name = (f: string) => basename(f).replace(/\.json$/, "").replace(/\.(plan|state)$/, "");
let result;
try {
  result = generateFromPlans(files.map((f) => ({ name: name(f), plan: read(f) })), flags.overlay ? (read(flags.overlay) as Overlay) : undefined);
} catch (e) {
  console.error((e as Error).message);
  process.exit(2);
}
const { spec, report } = result;
const list = (m: Record<string, number>) => Object.entries(m).map(([k, v]) => `${k} x${v}`).join(", ");
const note = (s: string) => console.error(s);
note(`${report.resources} resources: ${report.nodes} nodes, ${report.zones} zones, ${report.links} links`);
if (Object.keys(report.unmapped).length) note(`not drawn, no mapping rule (add one in src/tfMapping.ts): ${list(report.unmapped)}`);
if (Object.keys(report.skipped).length) note(`not drawn on purpose: ${list(report.skipped)}`);
if (report.unresolved) note(`${report.unresolved} permission arrows could not be resolved: their values are unknown (unknown until apply) or name nothing drawn. Use state JSON, or a plan made after the first apply.`);
for (const w of report.warnings) note(`warning: ${w}`);
for (const e of report.errors) note(`error: ${e}`);
const specErrors = report.issues.filter((i) => i.severity === "error");
for (const i of specErrors) note(`error ${i.pointer || "/"}: ${i.message} (${i.rule})`);
const warns = report.issues.length - specErrors.length;
if (warns) note(`${warns} lint warning${warns === 1 ? "" : "s"}; run scripts/lint.ts on the output for detail`);
const bad = report.errors.length > 0 || specErrors.length > 0;

if (cmd === "generate") {
  const text = JSON.stringify(spec, null, 2) + "\n";
  if (flags.out) writeFileSync(flags.out, text);
  else process.stdout.write(text);
  process.exit(bad ? 1 : 0);
}

if (cmd === "pin") {
  if (bad) process.exit(1);
  const o = read(flags.overlay!) as Overlay;
  o.nodes ??= {};
  let n = 0;
  for (const node of spec.nodes) {
    if (!(node as Record<string, unknown>)["x-tf"] || o.nodes[node.id]?.at) continue; // pin generated cards only; never move one that is already pinned
    o.nodes[node.id] = { ...o.nodes[node.id], at: node.at };
    n++;
  }
  writeFileSync(flags.overlay!, JSON.stringify(o, null, 2) + "\n");
  note(`pinned ${n} card${n === 1 ? "" : "s"} in ${flags.overlay}`);
  process.exit(0);
}

const c = checkSpec(spec, read(flags.spec!));
if (c.ok && !bad) note("check: the committed spec matches the plan and overlay");
else {
  if (!c.ok) {
    note("check: the committed spec has drifted from the plan and overlay. Regenerate it, or fix the plan or overlay.");
    if (c.diff) for (const k of ["nodes", "links", "zones"] as const) {
      const d = c.diff[k];
      if (d.added.length) note(`  ${k} to add: ${d.added.join(", ")}`);
      if (d.removed.length) note(`  ${k} to remove: ${d.removed.join(", ")}`);
      for (const ch of d.changed) note(`  ${k} changed: ${ch.id} (${ch.fields.join(", ")})`);
    }
    if (c.diff?.trace) note("  trace changed");
    if (c.diff?.fields.length) note(`  top-level fields changed: ${c.diff.fields.join(", ")}`);
  }
  process.exit(1);
}
