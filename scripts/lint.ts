// Lint spec files: `node scripts/lint.ts [--format text|sarif|github] [--max-warnings N] <file.json | directory>...`
// Exit codes: 0 clean (within the warning limit), 1 an error, or more warnings than --max-warnings, 2 a usage, read or parse problem.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { formatText, toGithubAnnotations, toSarif } from "../src/lintFormat.ts";
import { lintSpec } from "../src/validate.ts";

const args = process.argv.slice(2);
const files: string[] = [];
let format = "text";
let maxWarnings = Infinity;
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === "--format") format = args[++i] ?? "";
  else if (a === "--max-warnings") maxWarnings = Number(args[++i]);
  else if (a.startsWith("--")) usage(`unknown option ${a}`);
  else files.push(...expand(a));
}
if (!["text", "sarif", "github"].includes(format)) usage(`--format must be text, sarif or github, not "${format}"`);
if (Number.isNaN(maxWarnings) || maxWarnings < 0) usage("--max-warnings needs a number from 0");
if (!files.length) usage("give at least one spec file");

/** A directory stands for the .json files in it. */
function expand(path: string): string[] {
  try {
    return statSync(path).isDirectory() ? readdirSync(path).filter((f) => f.endsWith(".json")).sort().map((f) => `${path.replace(/[\\/]$/, "")}/${f}`) : [path];
  } catch {
    return [path]; // a missing file is reported when it is read
  }
}

function usage(message: string): never {
  console.error(`${message}\nusage: node scripts/lint.ts [--format text|sarif|github] [--max-warnings N] <file.json>...`);
  process.exit(2);
}

const results = files.map((file) => {
  let spec: unknown;
  try {
    spec = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`${file}: cannot read or parse (${(e as Error).message})`);
    process.exit(2);
  }
  return { file, ...lintSpec(spec) };
});

if (format === "sarif") {
  console.log(JSON.stringify(toSarif(results), null, 2));
} else if (format === "github") {
  for (const r of results) if (r.issues.length) console.log(toGithubAnnotations(r.file, r.issues));
} else {
  for (const r of results) console.log(formatText(r.file, r.issues, r.suppressed));
}

const errors = results.reduce((n, r) => n + r.issues.filter((i) => i.severity === "error").length, 0);
const warnings = results.reduce((n, r) => n + r.issues.filter((i) => i.severity === "warning").length, 0);
if (errors > 0 || warnings > maxWarnings) process.exit(1);
