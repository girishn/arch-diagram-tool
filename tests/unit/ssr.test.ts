import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArchDiagram, ArchExplorer } from "../../src/index.ts";
import { EXAMPLES } from "./examples.ts";

// The test environment is plain Node: there is no `window` or `document`, so a render that touches either throws.
// That is what a Next.js static export needs.
describe("server rendering", () => {
  it("runs without a browser", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
  });

  for (const { file, spec } of EXAMPLES) {
    it(`renders ${file}`, () => {
      const html = renderToString(createElement(ArchExplorer, { spec }));
      expect(html).toContain("adg-bar");
      expect(html).toContain("Overview");
      if (spec.trace?.length) expect(html).toContain("The full request path");
    });
  }

  it("renders each component's spoken description (the cards link to them once the stage is measured in the browser)", () => {
    const spec = EXAMPLES.find((e) => e.file === "simple-web-app")!.spec;
    const html = renderToString(createElement(ArchExplorer, { spec }));
    const descriptions = [...html.matchAll(/<span id="[^"]*-d-([^"]+)">([^<]+)<\/span>/g)];
    expect(descriptions.map((m) => m[1])).toEqual(spec.nodes.map((n) => n.id));
    for (const m of descriptions) expect(m[2]).toMatch(/Outgoing:|Incoming:|No connections/);
  });

  it("includes the whole diagram as text", () => {
    const spec = EXAMPLES.find((e) => e.file === "platform-tooling")!.spec;
    const html = renderToString(createElement(ArchExplorer, { spec }));
    expect(html).toContain("Diagram as text");
    for (const n of spec.nodes) expect(html).toContain(n.label);
    expect(html).toContain("Request trace");
  });

  it("lists a component's tags, properties, source and references in the text view, with references as safe links", () => {
    const spec = JSON.parse(readFileSync(new URL("../fixtures/golden/v1-contract.json", import.meta.url), "utf8"));
    const html = renderToString(createElement(ArchExplorer, { spec })).replace(/<!-- -->/g, ""); // React marks the joins between text pieces
    expect(html).toContain("Tags: edge, public.");
    expect(html).toContain("region = ap-southeast-2; replicas = 3; multiAz = true.");
    expect(html).toContain("aws_api_gateway_rest_api.main, infra/api.tf:12");
    expect(html).toContain('<a href="https://example.com/runbook" rel="noopener noreferrer">Runbook</a>');
  });

  it("shows a readable error instead of a diagram for an invalid spec", () => {
    const spec = structuredClone(EXAMPLES[0]!.spec);
    spec.links[0]!.to = "nope";
    const html = renderToString(createElement(ArchExplorer, { spec }));
    expect(html).toContain("not valid");
    expect(html).toContain("nope");
    expect(html).not.toContain("adg-bar");
  });

  it("renders the diagram alone, with a theme", () => {
    const html = renderToString(createElement(ArchDiagram, { spec: EXAMPLES[0]!.spec, selected: null, onSelect: () => {}, theme: "paper" }));
    expect(html).toContain("--adg-bg:#faf7f0");
  });

  it("falls back to a neutral icon for an unknown icon key, without throwing", () => {
    const spec = structuredClone(EXAMPLES[0]!.spec);
    spec.nodes[0]!.icons = ["definitely-not-an-icon"];
    expect(() => renderToString(createElement(ArchExplorer, { spec }))).not.toThrow();
  });
});
