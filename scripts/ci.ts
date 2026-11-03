// The pull-request check: lint every spec, show how each changed spec differs from the base branch, and confirm that diagrams generated from Terraform
// have not drifted from the plan. Writes a Markdown report (for a PR comment and the job summary) and exits 1 when something is wrong.
//   node scripts/ci.ts [--config arch-diagram.config.json] [--base origin/main] [--summary report.md]
// Config: { "specs": ["examples"], "maxWarnings": 10, "terraform": [{ "name": "Platform", "plans": ["tf/a.json"], "overlay": "tf/overlay.json", "spec": "docs/platform.json" }] }
// A pull request can change the config and every file it points at, so all of it is treated as untrusted: paths must stay inside the working directory,
// the base ref is validated, and text copied into the report is escaped and capped. Nothing here writes outside --summary or calls the network.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { checkSpec, generateFromPlans } from "../src/terraform.ts";
import type { Overlay } from "../src/terraform.ts";
import { lintSpec } from "../src/validate.ts";
import { diffSpecs, verify } from "../src/verify.ts";
import type { DiagramSpec } from "../src/schema.ts";

export const MARKER = "<!-- arch-diagram-check -->";
const CAP = 12; // items listed per group before "and N more"

/** Text from a pull request, made safe to sit in a Markdown comment: no HTML, links, tables or mentions, one line, and short. */
export function esc(text: unknown, max = 80): string {
  const s = String(text).replace(/\s+/g, " ").trim();
  const cut = s.length > max ? s.slice(0, max - 1) + "…" : s;
  return cut.replace(/[\\`*_{}[\]<>()#+!|~@&:]/g, (c) => `\\${c}`);
}
const list = (items: string[]) => (items.length > CAP ? `${items.slice(0, CAP).map((x) => esc(x)).join(", ")} and ${items.length - CAP} more` : items.map((x) => esc(x)).join(", "));

type Config = { specs?: string[]; maxWarnings?: number; terraform?: { name?: string; plans: string[]; overlay?: string; spec: string }[] };

export type Result = { markdown: string; failed: boolean };

/** A path from the config must stay inside the repo (symlinks included), so a pull request cannot make the check read, or echo, files outside it. */
function inside(root: string, p: string): string {
  const abs = resolve(root, p);
  const real = existsSync(abs) ? realpathSync(abs) : abs;
  const rel = relative(realpathSync(root), real);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`path leaves the repository: ${esc(p)}`);
  return abs;
}

function jsonFiles(root: string, entry: string): string[] {
  const abs = inside(root, entry);
  if (!existsSync(abs)) throw new Error(`no such file or directory: ${esc(entry)}`);
  return statSync(abs).isDirectory() ? readdirSync(abs).filter((f) => f.endsWith(".json")).sort().map((f) => `${entry.replace(/[\\/]$/, "")}/${f}`) : [entry];
}

function baseText(root: string, base: string, path: string): string | null {
  try {
    return execFileSync("git", ["show", `${base}:${path.replace(/\\/g, "/")}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 20 * 1024 * 1024 });
  } catch {
    return null; // not in the base: a new file
  }
}

export function run(root: string, config: Config, base: string | undefined): Result {
  if (base !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._/@~^-]*$/.test(base)) throw new Error(`not a usable base ref: ${esc(base)}`);
  const out: string[] = [];
  let failed = false;
  const problems: string[] = [];

  // 1. lint
  const files = (config.specs ?? ["examples"]).flatMap((e) => jsonFiles(root, e));
  let errors = 0;
  let warnings = 0;
  const issueLines: string[] = [];
  const parsed = new Map<string, unknown>();
  for (const f of files) {
    let spec: unknown;
    try {
      spec = JSON.parse(readFileSync(inside(root, f), "utf8"));
    } catch (e) {
      errors++;
      issueLines.push(`- \`${esc(f, 60)}\`: cannot be read as JSON`);
      continue;
    }
    parsed.set(f, spec);
    const { issues } = lintSpec(spec);
    for (const i of issues) {
      if (i.severity === "error") errors++;
      else warnings++;
      if (i.severity === "error" && issueLines.length < CAP) issueLines.push(`- \`${esc(f, 60)}\` ${esc(i.path, 40)}: ${esc(i.message, 100)} (${esc(i.rule, 40)})`);
    }
  }
  if (errors) problems.push(`${errors} lint error${errors === 1 ? "" : "s"}`);
  if (config.maxWarnings !== undefined && warnings > config.maxWarnings) problems.push(`${warnings} lint warnings (limit ${config.maxWarnings})`);

  // 2. what changed against the base
  const changes: string[] = [];
  if (base !== undefined) {
    for (const f of files) {
      const head = parsed.get(f);
      if (head === undefined) continue;
      const before = baseText(root, base, f);
      if (before === null) {
        changes.push(`- \`${esc(f, 60)}\`: new diagram`);
        continue;
      }
      let prior: unknown;
      try {
        prior = JSON.parse(before);
      } catch {
        changes.push(`- \`${esc(f, 60)}\`: the base version is not valid JSON, so no comparison`);
        continue;
      }
      if (!verify(prior).ok || !verify(head).ok) {
        changes.push(`- \`${esc(f, 60)}\`: not compared (one side has errors)`);
        continue;
      }
      const d = diffSpecs(prior as DiagramSpec, head as DiagramSpec);
      if (d.same) continue;
      const parts: string[] = [];
      for (const k of ["nodes", "links", "zones"] as const) {
        const x = d[k];
        if (x.added.length) parts.push(`${k} added: ${list(x.added)}`);
        if (x.removed.length) parts.push(`${k} removed: ${list(x.removed)}`);
        if (x.changed.length) parts.push(`${k} changed: ${list(x.changed.map((c) => `${c.id} (${c.fields.join(", ")})`))}`);
      }
      if (d.trace) parts.push("trace changed");
      if (d.fields.length) parts.push(`top level changed: ${list(d.fields)}`);
      changes.push(`- \`${esc(f, 60)}\`: ${parts.join("; ")}`);
    }
  }

  // 3. generated diagrams still match their plans
  const tf: string[] = [];
  for (const [i, t] of (config.terraform ?? []).entries()) {
    const name = esc(t.name ?? `Terraform ${i + 1}`, 60);
    try {
      const plans = t.plans.map((p) => ({ name: basename(p).replace(/\.json$/, "").replace(/\.(plan|state)$/, ""), plan: JSON.parse(readFileSync(inside(root, p), "utf8")) as unknown }));
      const overlay = t.overlay ? (JSON.parse(readFileSync(inside(root, t.overlay), "utf8")) as Overlay) : undefined;
      const { spec, report } = generateFromPlans(plans, overlay);
      const committed = JSON.parse(readFileSync(inside(root, t.spec), "utf8")) as unknown;
      const c = checkSpec(spec, committed);
      const bad = report.errors.length + report.issues.filter((x) => x.severity === "error").length;
      const notes = [report.unresolved ? `${report.unresolved} permission arrows unresolved` : "", Object.keys(report.unmapped).length ? `${Object.values(report.unmapped).reduce((a, b) => a + b, 0)} resources not drawn (no mapping rule)` : ""].filter(Boolean).join("; ");
      if (bad) {
        problems.push(`${name}: the plans and overlay do not make a valid diagram`);
        tf.push(`- **${name}**: failed. ${report.errors.slice(0, 5).map((e) => esc(e, 120)).join(" ")}`);
      } else if (!c.ok) {
        problems.push(`${name}: the committed diagram has drifted from its plans`);
        const parts: string[] = [];
        if (c.diff) for (const k of ["nodes", "links", "zones"] as const) {
          const x = c.diff[k];
          if (x.added.length) parts.push(`${k} to add: ${list(x.added)}`);
          if (x.removed.length) parts.push(`${k} to remove: ${list(x.removed)}`);
          if (x.changed.length) parts.push(`${k} changed: ${list(x.changed.map((y) => y.id))}`);
        }
        tf.push(`- **${name}**: drifted. Regenerate it with \`npm run tf -- generate\`. ${parts.join("; ")}`);
      } else tf.push(`- **${name}**: in sync${notes ? ` (${notes})` : ""}`);
    } catch (e) {
      problems.push(`${name}: could not run`);
      tf.push(`- **${name}**: could not run: ${esc((e as Error).message, 160)}`);
    }
  }

  failed = problems.length > 0;
  out.push(MARKER, `## Diagram check: ${failed ? "failed" : "passed"}`, "");
  if (failed) out.push(...problems.map((p) => `- ${esc(p, 140)}`), "");
  out.push(`Linted ${files.length} diagram${files.length === 1 ? "" : "s"}: ${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}.`, "");
  if (issueLines.length) out.push(...issueLines, "");
  if (base !== undefined) out.push("### Changed diagrams", "", ...(changes.length ? changes : ["No diagram changed."]), "");
  if (tf.length) out.push("### Generated from Terraform", "", ...tf, "");
  return { markdown: out.join("\n"), failed };
}

if (process.argv[1]?.endsWith("ci.ts")) {
  const args = process.argv.slice(2);
  const flag = (n: string) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const root = process.cwd();
  const configPath = flag("config") ?? "arch-diagram.config.json";
  let config: Config = {};
  try {
    if (existsSync(resolve(root, configPath))) config = JSON.parse(readFileSync(inside(root, configPath), "utf8")) as Config;
    else if (flag("config")) throw new Error(`no config at ${esc(configPath)}`);
    const result = run(root, config, flag("base"));
    const summary = flag("summary");
    if (summary) writeFileSync(summary, result.markdown + "\n");
    else console.log(result.markdown);
    process.exit(result.failed ? 1 : 0);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
}
