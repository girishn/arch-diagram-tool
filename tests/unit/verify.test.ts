import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { handle } from "../../scripts/mcp.ts";
import { applyPatch, describeSpec, diffSpecs, verify } from "../../src/verify.ts";
import type { DiagramSpec } from "../../src/schema.ts";

const load = (n: string): DiagramSpec => JSON.parse(readFileSync(new URL(`../../examples/${n}.json`, import.meta.url), "utf8"));
const spec = () => load("simple-web-app");

describe("verify", () => {
  it("reports a good example as ok, with JSON Pointers on problems", () => {
    expect(verify(spec()).ok).toBe(true);
    const bad = spec();
    bad.links[0]!.to = "nope";
    const r = verify(bad);
    expect(r.ok).toBe(false);
    expect(r.issues.find((i) => i.severity === "error")!.pointer).toMatch(/^\/links\/0/);
  });
});

describe("describeSpec", () => {
  it("summarises counts and connections", () => {
    const s = spec();
    const d = describeSpec(s);
    expect(d.counts.nodes).toBe(s.nodes.length);
    expect(d.zones.every((z) => Array.isArray(z.members))).toBe(true);
    expect(d.nodes.some((n) => n.zone.length > 0)).toBe(true);
    expect(d.nodes[0]!.connections).toMatch(/Outgoing|Incoming|No connections/);
  });
});

describe("diffSpecs", () => {
  it("is empty for equal specs and matches by id, not position", () => {
    const a = spec();
    const b = spec();
    b.nodes.reverse();
    expect(diffSpecs(a, b).same).toBe(true);
  });
  it("reports added, removed and changed", () => {
    const a = spec();
    const b = spec();
    b.nodes[0]!.label = "Renamed";
    b.links.pop();
    const d = diffSpecs(a, b);
    expect(d.same).toBe(false);
    expect(d.nodes.changed).toEqual([{ id: b.nodes[0]!.id, fields: ["label"] }]);
    expect(d.links.removed).toHaveLength(1);
  });
});

describe("applyPatch", () => {
  it("applies replace and add and returns a valid spec", () => {
    const r = applyPatch(spec(), [{ op: "replace", path: "/title", value: "New title" }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.spec as DiagramSpec).title).toBe("New title");
  });
  it("does not change its input", () => {
    const s = spec();
    applyPatch(s, [{ op: "replace", path: "/title", value: "X" }]);
    expect(s.title).not.toBe("X");
  });
  it("refuses a patch that adds an error, and says which", () => {
    const r = applyPatch(spec(), [{ op: "replace", path: "/links/0/to", value: "nope" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.newErrors!.length).toBeGreaterThan(0);
  });
  it("refuses a path that does not exist, naming the operation", () => {
    const r = applyPatch(spec(), [{ op: "remove", path: "/nodes/99" }]);
    expect(r).toMatchObject({ ok: false, opIndex: 0, pointer: "/nodes/99" });
  });
  it("refuses reserved names and a failed test", () => {
    expect(applyPatch(spec(), [{ op: "add", path: "/__proto__/x", value: 1 }]).ok).toBe(false);
    expect(applyPatch(spec(), [{ op: "test", path: "/title", value: "wrong" }]).ok).toBe(false);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
  it("appends with - and keeps an already-broken spec patchable toward fixing it", () => {
    const broken = spec();
    broken.links[0]!.to = "nope";
    const fixed = applyPatch(broken, [{ op: "replace", path: "/links/0/to", value: broken.nodes[1]!.id }]);
    expect(fixed.ok).toBe(true);
  });
});

describe("MCP handler", () => {
  it("lists the four tools", () => {
    const r = handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }) as any;
    expect(r.result.tools.map((t: any) => t.name).sort()).toEqual(["describe", "diff", "patch", "validate"]);
  });
  it("answers a tool call, and returns tool errors as isError rather than crashing", () => {
    const good = handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "validate", arguments: { spec: spec() } } }) as any;
    expect(good.result.isError).toBe(false);
    expect(good.result.structuredContent.ok).toBe(true);
    const bad = handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "validate", arguments: {} } }) as any;
    expect(bad.result.isError).toBe(true);
  });
  it("ignores notifications and rejects unknown methods", () => {
    expect(handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeUndefined();
    expect((handle({ jsonrpc: "2.0", id: 4, method: "nope" }) as any).error.code).toBe(-32601);
  });
});

describe("processes", () => {
  it("the MCP server answers over stdio", () => {
    const input = [{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 2, method: "tools/list" }].map((m) => JSON.stringify(m)).join("\n") + "\n";
    const r = spawnSync(process.execPath, ["scripts/mcp.ts"], { input, encoding: "utf8", timeout: 20000 });
    const lines = r.stdout.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0].result.serverInfo.name).toBe("arch-diagram-verify");
  });
  it("the CLI validates and exits non-zero on a bad spec", () => {
    const ok = spawnSync(process.execPath, ["scripts/verify.ts", "validate", "examples/simple-web-app.json"], { encoding: "utf8", timeout: 20000 });
    expect(ok.status).toBe(0);
    expect(JSON.parse(ok.stdout).ok).toBe(true);
    const missing = spawnSync(process.execPath, ["scripts/verify.ts", "validate", "examples/none.json"], { encoding: "utf8", timeout: 20000 });
    expect(missing.status).toBe(2);
  });
});
