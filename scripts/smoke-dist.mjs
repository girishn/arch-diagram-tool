// Checks the built package (run `npm run build` first) the way a consumer would use it: plain Node, no Vite, no TypeScript.
// Fails loudly on the things a bundler can quietly get wrong: the "use client" directive, the entry points, the files that ship.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const fail = (m) => {
  console.error(`smoke-dist: ${m}`);
  process.exit(1);
};
const first = (f) => readFileSync(new URL(`../dist/${f}`, import.meta.url), "utf8").split("\n")[0];

if (first("index.js") !== '"use client";') fail('dist/index.js must start with "use client" (Next.js needs it on the component entry)');
for (const f of ["core.js", "svg.js"]) if (first(f).includes("use client")) fail(`dist/${f} must not be a client module, or a server component could not call it`);

const spec = JSON.parse(readFileSync(new URL("../examples/simple-web-app.json", import.meta.url), "utf8"));

const core = await import("../dist/core.js");
if (core.validateSpec(spec).some((i) => i.severity === "error")) fail("core: validateSpec reports errors on a good example");
if (!core.lintSpec(spec) || !core.RULES["link-unknown-node"]) fail("core: lintSpec or RULES missing");
if (typeof core.measure(spec, false).totalCable !== "number") fail("core: measure");

const { renderToSvg } = await import("../dist/svg.js");
const svg = renderToSvg(spec);
if (!svg.startsWith("<svg ") || !svg.includes(spec.nodes[0].label)) fail("svg: renderToSvg output");

const { ArchExplorer } = await import("../dist/index.js");
const html = renderToStaticMarkup(createElement(ArchExplorer, { spec }));
if (!html.includes(spec.nodes[0].label)) fail("index: ArchExplorer did not render on the server");

// What ships: dist, schema, README, LICENSE. Never the icon folder, tests, or research notes.
const files = JSON.parse(execSync("npm pack --dry-run --json", { encoding: "utf8" }))[0].files.map((f) => f.path);
const stray = files.filter((p) => !/^(dist\/|schema\/|README\.md$|LICENSE$|package\.json$)/.test(p));
if (stray.length) fail(`unexpected files in the package: ${stray.join(", ")}`);
if (files.some((p) => /aws-icons/i.test(p))) fail("AWS icon files must never be packaged");

console.log(`smoke-dist: ok (${files.length} files)`);
