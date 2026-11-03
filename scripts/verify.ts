// Verifier CLI: `node scripts/verify.ts <validate|describe|diff|patch> ...`. JSON on stdout, so a script or an agent can parse it.
//   validate <spec.json>                 exit 1 when the spec has errors
//   describe <spec.json>
//   diff <before.json> <after.json>      exit 1 when they differ
//   patch <spec.json> <ops.json>         prints the patched spec; exit 1 when the patch is refused
// For text, SARIF or GitHub output over many files, use scripts/lint.ts.
import { readFileSync } from "node:fs";
import { TOOLS } from "./verify-tools.ts";

const [cmd, a, b] = process.argv.slice(2);
const usage = (m: string): never => {
  console.error(`${m}\nusage: node scripts/verify.ts validate|describe <spec.json> | diff <before.json> <after.json> | patch <spec.json> <ops.json>`);
  process.exit(2);
};
const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

try {
  let out: any;
  if ((cmd === "validate" || cmd === "describe") && a) out = tool(cmd).run({ path: a });
  else if (cmd === "diff" && a && b) out = tool("diff").run({ before_path: a, after_path: b });
  else if (cmd === "patch" && a && b) out = tool("patch").run({ path: a, ops: readJson(b) });
  else usage(cmd ? "missing or unknown arguments" : "give a command");
  if (cmd === "patch" && out.ok) console.log(JSON.stringify(out.spec, null, 2));
  else console.log(JSON.stringify(out, null, 2));
  process.exit(cmd === "validate" ? (out.ok ? 0 : 1) : cmd === "diff" ? (out.same ? 0 : 1) : cmd === "patch" ? (out.ok ? 0 : 1) : 0);
} catch (e) {
  console.error((e as Error).message);
  process.exit(2);
}
