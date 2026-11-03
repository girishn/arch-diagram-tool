import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { RULES, lintSpec, validateSpec } from "../../src/index.ts";
import type { DiagramSpec } from "../../src/index.ts";
import { formatText, pointerOf, toGithubAnnotations, toSarif } from "../../src/lintFormat.ts";
import { schemaText } from "../../scripts/gen-schema.ts";
import { EXAMPLES } from "./examples.ts";

const root = new URL("../../", import.meta.url);
const simple = () => structuredClone(EXAMPLES.find((e) => e.file === "simple-web-app")!.spec) as DiagramSpec & Record<string, unknown>;

describe("rule ids", () => {
  const source = readFileSync(new URL("src/validate.ts", root), "utf8");
  const used = [...source.matchAll(/\b(err|warn)\("([a-z-]+)"/g)].map((m) => ({ kind: m[1] === "err" ? "error" : "warning", id: m[2]! }));
  // the suppression layer builds issues by hand rather than through err and warn
  for (const m of source.matchAll(/severity: "(error|warning)", rule: "([a-z-]+)"/g)) used.push({ kind: m[1]!, id: m[2]! });

  it("every rule the validator reports is in the registry, at the severity the registry says", () => {
    expect(used.length).toBeGreaterThan(60);
    for (const u of used) {
      expect(RULES, u.id).toHaveProperty(u.id);
      expect(RULES[u.id as keyof typeof RULES].severity, u.id).toBe(u.kind);
    }
  });

  it("every rule in the registry is reported somewhere (no dead ids)", () => {
    const ids = new Set(used.map((u) => u.id));
    expect(Object.keys(RULES).filter((id) => !ids.has(id))).toEqual([]);
  });

  it("gives every issue a rule id from the registry", () => {
    const s = simple();
    (s.links[0] as Record<string, unknown>).ofPath = true;
    s.nodes[1]!.at = { ...s.nodes[0]!.at };
    const issues = validateSpec(s);
    expect(issues.length).toBeGreaterThan(2);
    for (const i of issues) expect(RULES).toHaveProperty(i.rule);
  });
});

describe("lintIgnore", () => {
  const key = "nodes.store";
  it("silences a warning on purpose and keeps count of it", () => {
    const s = simple();
    s.lintIgnore = [{ rule: "trace-unvisited-node", path: key, reason: "The store is only a backup target." }];
    const r = lintSpec(s);
    expect(r.issues).toEqual([]);
    expect(r.suppressed.map((i) => `${i.rule} ${i.path} ${i.reason}`)).toEqual([`trace-unvisited-node ${key} The store is only a backup target.`]);
  });

  it("without a path silences the rule everywhere", () => {
    const s = simple();
    s.lintIgnore = [{ rule: "trace-unvisited-node", reason: "Not every component is on the request path." }];
    expect(lintSpec(s).issues).toEqual([]);
  });

  it("does not silence the same rule at another place", () => {
    const s = simple();
    s.lintIgnore = [{ rule: "trace-unvisited-node", path: "nodes.elsewhere", reason: "x" }];
    const r = lintSpec(s);
    expect(r.issues.map((i) => i.rule).sort()).toEqual(["lint-ignore-unused", "trace-unvisited-node"]);
  });

  it("needs a reason", () => {
    const s = simple();
    s.lintIgnore = [{ rule: "trace-unvisited-node", reason: "" }];
    expect(lintSpec(s).issues.map((i) => `${i.severity} ${i.rule}`)).toContain("error lint-ignore-invalid");
    delete (s.lintIgnore[0] as Partial<(typeof s.lintIgnore)[0]>).reason;
    expect(lintSpec(s).issues.map((i) => i.rule)).toContain("lint-ignore-invalid");
  });

  it("cannot silence an error, or a rule that does not exist", () => {
    const s = simple();
    s.nodes[1]!.at = { ...s.nodes[0]!.at };
    s.lintIgnore = [
      { rule: "node-cell-shared", reason: "trying to hide a real error" },
      { rule: "no-such-rule", reason: "typo" },
    ];
    const r = lintSpec(s);
    expect(r.issues.map((i) => i.rule)).toContain("node-cell-shared");
    expect(r.issues.filter((i) => i.rule === "lint-ignore-unknown-rule")).toHaveLength(2);
    expect(r.suppressed).toEqual([]);
  });

  it("reports an entry that matched nothing, so suppressions cannot go stale", () => {
    const s = simple();
    s.lintIgnore = [{ rule: "node-orphan", reason: "was true once" }];
    expect(lintSpec(s).issues.map((i) => i.rule)).toContain("lint-ignore-unused");
  });
});

describe("output formats", () => {
  const s = simple();
  s.lintIgnore = [{ rule: "node-no-explanation", reason: "Kept short on purpose." }];
  (s.nodes[0] as Record<string, unknown>).detail = undefined;
  const r = lintSpec(s);

  it("text: one line per issue with the rule id and a count", () => {
    const text = formatText("a.json", r.issues, r.suppressed);
    expect(text).toContain("a.json: warning trace-unvisited-node at nodes.store: never visited by the trace");
    expect(text.split("\n").at(-1)).toMatch(/^a\.json: 0 errors, \d+ warnings?, 1 suppressed$/);
  });

  it("github: workflow commands with escaped data", () => {
    expect(toGithubAnnotations("dir/a.json", [{ severity: "warning", rule: "x-rule", path: "a.b", message: "50% of\nlines, ok: yes" }])).toBe("::warning file=dir/a.json,title=x-rule::a.b: 50%25 of%0Alines, ok: yes");
  });

  it("sarif: 2.1.0 with every rule described, logical locations, and suppression justifications", () => {
    const sarif = toSarif([{ file: "dir\\a.json", issues: r.issues, suppressed: r.suppressed }]);
    expect(sarif.version).toBe("2.1.0");
    const run = sarif.runs[0]!;
    expect(run.tool.driver.rules).toHaveLength(Object.keys(RULES).length);
    const warn = run.results.find((x) => x.ruleId === "trace-unvisited-node")!;
    expect(warn.locations[0]!.logicalLocations[0]!.fullyQualifiedName).toBe("/nodes/store");
    expect(warn.locations[0]!.physicalLocation.artifactLocation.uri).toBe("dir/a.json");
    const silenced = run.results.filter((x) => x.suppressions);
    expect(silenced).toHaveLength(r.suppressed.length);
    expect(silenced[0]!.suppressions![0]!.justification).toBe("Kept short on purpose.");
  });

  it("turns paths into JSON-Pointer-like locations", () => {
    expect(pointerOf("links[3].to")).toBe("/links/3/to");
    expect(pointerOf("nodes[2].detail.mentions[0]")).toBe("/nodes/2/detail/mentions/0");
    expect(pointerOf("")).toBe("");
  });
});

describe("the lint CLI", () => {
  const run = (...args: string[]) => spawnSync(process.execPath, ["scripts/lint.ts", ...args], { cwd: new URL(".", root), encoding: "utf8" });

  it("exits 0 when there are no errors, and prints the rule ids", () => {
    const r = run("examples/simple-web-app.json");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("warning trace-unvisited-node");
  });

  it("exits 1 when warnings exceed --max-warnings, and 0 when they do not", () => {
    expect(run("--max-warnings", "0", "examples/simple-web-app.json").status).toBe(1);
    expect(run("--max-warnings", "1", "examples/simple-web-app.json").status).toBe(0);
  });

  it("exits 1 for an invalid spec", () => {
    expect(run("tests/fixtures/invalid/self-link.json").status).toBe(1);
  });

  it("exits 2 for a usage problem or an unreadable file", () => {
    expect(run().status).toBe(2);
    expect(run("--format", "xml", "examples/simple-web-app.json").status).toBe(2);
    expect(run("no-such-file.json").status).toBe(2);
  });

  it("writes SARIF that parses", () => {
    const r = run("--format", "sarif", "examples/simple-web-app.json");
    expect(JSON.parse(r.stdout).version).toBe("2.1.0");
  });
});

describe("the JSON Schema", () => {
  const committed = readFileSync(new URL("schema/diagram-spec.v1.schema.json", root), "utf8");
  const Ajv = ((Ajv2020 as unknown as { default?: typeof Ajv2020 }).default ?? Ajv2020) as typeof Ajv2020;
  const validate = new Ajv({ allErrors: true, strict: false }).compile(JSON.parse(committed));
  const errors = () => (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);

  it("is up to date: regenerate with `npm run gen:schema`", () => {
    expect(committed).toBe(schemaText);
  });

  const fixtures = readdirSync(new URL("tests/fixtures/golden/", root)).map((f) => ({ name: `golden/${f}`, spec: JSON.parse(readFileSync(new URL(`tests/fixtures/golden/${f}`, root), "utf8")) }));
  for (const { name, spec } of [...EXAMPLES.map((e) => ({ name: `examples/${e.file}`, spec: e.spec })), ...fixtures])
    it(`accepts ${name}`, () => {
      expect(validate(spec), errors().join("; ")).toBe(true);
    });

  const bad: [string, (s: Record<string, any>) => void, RegExp][] = [
    ["a typo in a link field", (s) => (s.links[0].ofPath = true), /ofPath|additional/],
    ["an unknown pattern", (s) => (s.links[0].pattern = "rpc"), /allowed values/],
    ["a missing label", (s) => delete s.nodes[0].label, /label/],
    ["no nodes", (s) => (s.nodes = []), /fewer than 1/],
    ["version 2", (s) => (s.version = 2), /constant/],
    ["a javascript: reference", (s) => (s.nodes[0].references = [{ label: "x", url: "javascript:alert(1)" }]), /pattern/],
    ["a bad link id", (s) => (s.links[0].id = "a b"), /pattern/],
    ["a waypoint with three numbers", (s) => (s.links[0].via = [[1, 2, 3]]), /items|fewer|more/],
  ];
  for (const [name, mutate, pattern] of bad)
    it(`rejects ${name}`, () => {
      const s = structuredClone(simple()) as Record<string, any>;
      mutate(s);
      expect(validate(s)).toBe(false);
      expect(errors().join("; ")).toMatch(pattern);
    });

  it("lets x- fields through", () => {
    const s = structuredClone(simple()) as Record<string, any>;
    s["x-run"] = 1;
    s.nodes[0]["x-owner"] = "me";
    expect(validate(s), errors().join("; ")).toBe(true);
  });
});

describe("synthetic bench specs", () => {
  for (const n of [10, 40, 100, 200])
    it(`${n} components validate with no errors and no crossings`, async () => {
      const { syntheticSpec } = await import("../../demo/synthetic.ts");
      const spec = syntheticSpec(n);
      expect(validateSpec(spec).filter((i) => i.severity === "error")).toEqual([]);
      expect(spec.nodes).toHaveLength(n);
    });
});
