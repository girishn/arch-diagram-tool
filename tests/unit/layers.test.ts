import { describe, expect, it } from "vitest";
import { lintSpec } from "../../src/index.ts";
import type { DiagramSpec } from "../../src/index.ts";
import { resolveLenses } from "../../src/presets.ts";
import { EXAMPLES } from "./examples.ts";

const base = () => structuredClone(EXAMPLES.find((e) => e.file === "simple-web-app")!.spec) as DiagramSpec & Record<string, unknown>;
const rules = (s: unknown) => lintSpec(s).issues.map((i) => `${i.severity}:${i.rule}`);

/** The sample spec with its first two nodes in one layer and the rest in another, one band of rows each. */
function layered() {
  const s = base();
  s.layers = [{ id: "top", label: "Top" }, { id: "bottom", label: "Bottom" }];
  s.nodes.forEach((n, i) => {
    n.layer = i < 2 ? "top" : "bottom";
    n.at = { col: n.at.col, row: i < 2 ? 0 : 1 + Math.floor((i - 2) / 4) };
  });
  // keep every cell distinct
  const seen = new Set<string>();
  for (const n of s.nodes) {
    while (seen.has(`${n.at.col},${n.at.row}`)) n.at = { col: n.at.col + 1, row: n.at.row };
    seen.add(`${n.at.col},${n.at.row}`);
  }
  s.zones = [];
  return s;
}

describe("layers and planes", () => {
  it("a layered spec is clean", () => {
    expect(rules(layered()).filter((r) => r.startsWith("error"))).toEqual([]);
    expect(rules(layered())).not.toContain("warning:node-layer-missing");
    expect(rules(layered())).not.toContain("warning:layer-rows-overlap");
  });

  it("a layer needs an id and a label, and ids are unique", () => {
    const s = layered();
    (s.layers as unknown[])[0] = { id: "top" };
    expect(rules(s)).toContain("error:layer-invalid");
    const d = layered();
    d.layers!.push({ id: "top", label: "Again" });
    expect(rules(d)).toContain("error:layer-duplicate");
  });

  it("a node cannot name a layer that is not declared, and every node should name one", () => {
    const s = layered();
    s.nodes[0]!.layer = "nowhere";
    expect(rules(s)).toContain("error:layer-unknown");
    const m = layered();
    delete m.nodes[0]!.layer;
    expect(lintSpec(m).issues.find((i) => i.rule === "node-layer-missing")?.path).toBe("nodes[0].layer");
  });

  it("a spec without layers is never asked for them", () => {
    expect(rules(base())).not.toContain("warning:node-layer-missing");
  });

  it("plane must be control or data, on nodes and on links", () => {
    const s = layered();
    s.nodes[0]!.plane = "management" as never;
    s.links[0]!.plane = "user" as never;
    expect(rules(s).filter((r) => r === "error:plane-invalid")).toHaveLength(2);
    const ok = layered();
    ok.nodes[0]!.plane = "control";
    ok.links[0]!.plane = "data";
    expect(rules(ok)).not.toContain("error:plane-invalid");
  });

  it("warns when two layers share grid rows (their bands would overlap)", () => {
    const s = layered();
    s.nodes[2]!.at = { col: 9, row: 0 };
    expect(rules(s)).toContain("warning:layer-rows-overlap");
  });

  it("warns when a zone holds nodes from two layers (it cannot sit on one floor)", () => {
    const s = layered();
    s.zones = [{ id: "z", label: "Mixed", members: [s.nodes[0]!.id, s.nodes[2]!.id] }];
    expect(rules(s)).toContain("warning:layer-zone-mixed");
  });

  it("`layers` and `plane` are known fields, so they are not flagged as typos", () => {
    expect(rules(layered())).not.toContain("warning:unknown-field");
  });

  it("the Planes lens is a preset: declare it by id alone", () => {
    expect(resolveLenses({ lenses: [{ id: "planes" }] })[0]).toMatchObject({ id: "planes", label: "Planes" });
    const s = layered();
    s.lenses = [{ id: "planes" }];
    expect(rules(s)).not.toContain("error:lens-label-required");
  });
});
