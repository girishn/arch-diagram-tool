import { describe, expect, it } from "vitest";
import { validateSpec } from "../../src/index.ts";
import type { DiagramSpec } from "../../src/index.ts";
import { readFileSync, readdirSync } from "node:fs";
import { EXAMPLES } from "./examples.ts";

// Warnings the examples are known to carry. A new warning in an example means a spec or a lint rule changed; look at it.
const KNOWN_WARNINGS: Record<string, string[]> = {
  "simple-web-app": ["nodes.store: never visited by the trace"],
  // The registry and the dead-letter queue are on the diagram but no trace step visits them. Add steps, or accept it.
  "hospital-event-backbone": ["nodes.registry: never visited by the trace", "nodes.dlq: never visited by the trace"],
};

const simple = () => structuredClone(EXAMPLES.find((e) => e.file === "simple-web-app")!.spec);
const messages = (spec: unknown, severity: "error" | "warning") =>
  validateSpec(spec)
    .filter((i) => i.severity === severity)
    .map((i) => `${i.path}: ${i.message}`);

describe("examples are golden fixtures", () => {
  it("finds the examples", () => expect(EXAMPLES.length).toBeGreaterThanOrEqual(4));

  for (const { file, spec } of EXAMPLES) {
    it(`${file} has no errors and only the known warnings`, () => {
      expect(messages(spec, "error")).toEqual([]);
      expect(messages(spec, "warning")).toEqual(KNOWN_WARNINGS[file] ?? []);
    });
  }
});

describe("errors", () => {
  const cases: [string, (s: DiagramSpec) => void, RegExp][] = [
    ["wrong version", (s) => ((s as { version: number }).version = 2), /^version/],
    ["duplicate node id", (s) => (s.nodes[1]!.id = s.nodes[0]!.id), /duplicate id/],
    ["two nodes in one cell", (s) => (s.nodes[1]!.at = { ...s.nodes[0]!.at }), /same cell/],
    ["link to an unknown node", (s) => (s.links[0]!.to = "nope"), /unknown node "nope"/],
    ["self link", (s) => (s.links[0]!.to = s.links[0]!.from), /self-link/],
    ["unknown pattern", (s) => ((s.links[0] as { pattern: string }).pattern = "rpc"), /pattern/],
    ["unknown traffic value", (s) => ((s.links[0] as { traffic: string }).traffic = "sideways"), /traffic/],
    ["undeclared lens on a node", (s) => (s.nodes[0]!.lenses = { nolens: { badge: "x" } }), /not declared/],
    ["bad level", (s) => (s.nodes[0]!.lenses = { security: { badge: "x", level: "severe" as never } }), /level/],
    ["bad scale", (s) => (s.nodes[0]!.scale = { min: 5, max: 2 }), /scale/],
    ["zone with an unknown member", (s) => s.zones![0]!.members!.push("ghost"), /unknown node "ghost"/],
    ["zone parent cycle", (s) => ((s.zones![0]!.parent = s.zones![2]!.id), (s.zones![2]!.parent = s.zones![0]!.id)), /cycle/],
    ["node in two zones", (s) => s.zones![0]!.members!.push(s.zones![2]!.members![0]!), /already a member/],
    ["trace through an unknown node", (s) => (s.trace![0]!.node = "ghost"), /unknown node "ghost"/],
  ];
  for (const [name, mutate, expected] of cases) {
    it(name, () => {
      const spec = simple();
      mutate(spec);
      expect(messages(spec, "error").join("\n")).toMatch(expected);
    });
  }

  it("rejects things that are not specs without throwing", () => {
    for (const bad of [null, undefined, 1, "x", [], {}, { version: 1 }, { version: 1, title: "t", nodes: [], links: [] }]) {
      expect(() => validateSpec(bad)).not.toThrow();
      expect(messages(bad, "error").length).toBeGreaterThan(0);
    }
  });
});

describe("warnings", () => {
  it("flags a link that crosses a vpc edge without a traffic tag", () => {
    const spec = simple();
    delete spec.links.find((l) => l.from === "api" && l.to === "fn")!.traffic;
    expect(messages(spec, "warning").join("\n")).toMatch(/leaves|enters/);
  });

  it("flags a traffic tag that points the wrong way", () => {
    const spec = simple();
    spec.links.find((l) => l.from === "api" && l.to === "fn")!.traffic = "egress";
    expect(messages(spec, "warning").join("\n")).toMatch(/tagged "egress"/);
  });

  it("does not ask a dependency link to be tagged", () => {
    const spec = structuredClone(EXAMPLES.find((e) => e.file === "platform-tooling")!.spec);
    expect(spec.links.some((l) => l.pattern === "dependency")).toBe(true);
    expect(messages(spec, "warning").filter((m) => m.startsWith("links[") && /traffic/.test(m))).toEqual([]);
  });

  it("flags a node with no explanation and one the trace never visits", () => {
    const spec = simple();
    delete spec.nodes[1]!.detail;
    const out = messages(spec, "warning").join("\n");
    expect(out).toMatch(/no explanation/);
    expect(out).toMatch(/never visited by the trace/);
  });

  it("does not ask a peripheral node to be on the trace", () => {
    const spec = structuredClone(EXAMPLES.find((e) => e.file === "platform-tooling")!.spec);
    expect(messages(spec, "warning").join("\n")).not.toMatch(/never visited/);
  });
});

// Specs that were valid when v1 was written must stay valid, with no errors and no warnings at all. Add a fixture when v1 gains a field; never edit one to make it pass.
// The smallest valid spec has no explanations on purpose, so it carries the completeness warnings; the contract fixture must be clean.
const GOLDEN_WARNINGS: Record<string, string[]> = {
  "v1-minimal.json": ["nodes[0].detail: node has no explanation", "nodes[1].detail: node has no explanation", "links[0].detail: arrow has no explanation"],
};

describe("golden contract fixtures", () => {
  const dir = new URL("../fixtures/golden/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  it("finds them", () => expect(files.length).toBeGreaterThanOrEqual(2));
  for (const file of files) {
    it(`${file} has no errors and only its expected warnings`, () => {
      const spec = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
      expect(messages(spec, "error")).toEqual([]);
      expect(messages(spec, "warning")).toEqual(GOLDEN_WARNINGS[file] ?? []);
    });
  }
});

describe("the contract's optional data", () => {
  it("warns about a field it does not know, and names the path", () => {
    const s = simple();
    (s.links[0] as Record<string, unknown>).ofPath = true;
    expect(messages(s, "warning")).toContain("links[0].ofPath: unknown field, ignored (start its name with x- to keep your own data without this warning)");
    expect(messages(s, "error")).toEqual([]);
  });

  it("keeps x- fields without a warning, at every level", () => {
    const s = simple() as unknown as Record<string, unknown> & { nodes: Record<string, unknown>[]; links: Record<string, unknown>[] };
    s["x-run"] = 1;
    s.nodes[0]!["x-owner"] = "me";
    s.links[0]!["x-slo"] = "fast";
    expect(messages(s, "warning")).toEqual(KNOWN_WARNINGS["simple-web-app"]);
  });

  const bad: [string, (s: DiagramSpec) => void, RegExp][] = [
    ["tags that are not strings", (s) => (s.nodes[0]!.tags = [1] as never), /tags/],
    ["a property that is an object", (s) => (s.nodes[0]!.properties = { a: {} } as never), /properties/],
    ["a javascript: reference", (s) => (s.nodes[0]!.references = [{ label: "x", url: "javascript:alert(1)" }]), /references\[0\]\.url/],
    ["a data: reference", (s) => (s.nodes[0]!.references = [{ label: "x", url: "data:text/html,hi" }]), /references\[0\]\.url/],
    ["a protocol-relative reference", (s) => (s.nodes[0]!.references = [{ label: "x", url: "//evil.example/x" }]), /references\[0\]\.url/],
    ["a reference with no label", (s) => (s.nodes[0]!.references = [{ url: "https://a.example" } as never]), /references\[0\]/],
    ["a source line of zero", (s) => (s.nodes[0]!.source = { file: "a.tf", line: 0 }), /source/],
    ["a duplicate link id", (s) => ((s.links[0]!.id = "same"), (s.links[1]!.id = "same")), /duplicate link id/],
    ["a link id with a space", (s) => (s.links[0]!.id = "a b"), /links\[0\]\.id/],
  ];
  for (const [name, mutate, pattern] of bad)
    it(`rejects ${name}`, () => {
      const s = simple();
      mutate(s);
      expect(messages(s, "error").join("\n")).toMatch(pattern);
    });

  it("accepts http, https, mailto, a same-site path and an anchor", () => {
    const s = simple();
    s.nodes[0]!.references = ["http://a.example", "https://a.example/x?y=1", "mailto:a@b.example", "/docs/x", "./x", "../x", "#top"].map((url) => ({ label: "l", url }));
    expect(messages(s, "error")).toEqual([]);
  });
});
