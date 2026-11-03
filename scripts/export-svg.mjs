// Draw a spec's flat view as a standalone SVG: `node scripts/export-svg.mjs [--theme id] [--out file.svg] <spec.json>`
// With no --out the SVG goes to standard output. The renderer is TSX, which Node cannot load by itself, so Vite loads it.
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "vite";

const args = process.argv.slice(2);
let theme = "brass";
let out;
let input;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--theme") theme = args[++i] ?? "";
  else if (a === "--out") out = args[++i];
  else if (a.startsWith("--")) fail(`unknown option ${a}`);
  else input = a;
}
function fail(message) {
  console.error(`${message}\nusage: node scripts/export-svg.mjs [--theme id] [--out file.svg] <spec.json>`);
  process.exit(2);
}
if (!input) fail("give a spec file");

let spec;
try {
  spec = JSON.parse(readFileSync(input, "utf8"));
} catch (e) {
  fail(`${input}: cannot read or parse (${e.message})`);
}
const vite = await createServer({ root: process.cwd(), configFile: false, appType: "custom", server: { middlewareMode: true }, logLevel: "silent", plugins: [(await import("@vitejs/plugin-react")).default()] });
try {
  const { renderToSvg } = await vite.ssrLoadModule("/src/renderSvg.tsx");
  const { THEMES } = await vite.ssrLoadModule("/src/themes.ts");
  if (!THEMES.some((t) => t.id === theme)) fail(`unknown theme "${theme}"; choose from ${THEMES.map((t) => t.id).join(", ")}`);
  const svg = renderToSvg(spec, { theme });
  if (out) writeFileSync(out, svg + "\n");
  else console.log(svg);
} finally {
  await vite.close();
}
