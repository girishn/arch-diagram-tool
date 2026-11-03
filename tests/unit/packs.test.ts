import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArchExplorer, genericPack, packFromIconify, packFromSvgMap, resolveIcon } from "../../src/index.ts";
import { renderToSvg } from "../../src/renderSvg.tsx";
import { EXAMPLES } from "./examples.ts";

const spec = () => structuredClone(EXAMPLES.find((e) => e.file === "simple-web-app")!.spec);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>';

describe("packFromSvgMap", () => {
  const pack = packFromSvgMap({ "Api-Gateway": SVG }, { aliases: { apigw: "api-gateway" }, attribution: "Trademark notice.", unmodified: true });

  it("finds an icon by key or alias, ignoring case, and returns an image URL", () => {
    expect(pack.resolve("API-GATEWAY")?.src).toMatch(/^data:image\/svg\+xml/);
    expect(pack.resolve("apigw")?.src).toBe(pack.resolve("api-gateway")?.src);
    expect(pack.resolve("nope")).toBeUndefined();
    expect(pack.attribution).toBe("Trademark notice.");
    expect(pack.unmodified).toBe(true);
  });

  it("falls back to the generic pack for a key it does not hold", () => {
    expect(resolveIcon(pack, "database")).toBe(genericPack.resolve("database"));
  });
});

describe("packFromIconify", () => {
  const json = { width: 24, height: 24, icons: { server: { body: '<path d="M0 0h24v24H0z"/>' }, wide: { body: "<g/>", width: 32 } }, aliases: { host: { parent: "server" } } };
  const pack = packFromIconify(json, { attribution: "Set licence: MIT." });

  it("builds an SVG with the set's viewBox, per icon and per alias, on the glyph tile", () => {
    const decode = (k: string) => decodeURIComponent(pack.resolve(k)!.src!.split(",")[1]!);
    expect(decode("server")).toContain('viewBox="0 0 24 24"');
    expect(decode("wide")).toContain('viewBox="0 0 32 24"');
    expect(decode("host")).toContain('d="M0 0h24v24H0z"');
    expect(pack.resolve("server")?.tile).toBe("glyph");
  });
});

describe("attribution and unmodified icons", () => {
  const pack = packFromSvgMap({ client: SVG, "api-gateway": SVG }, { attribution: "Vendor and the vendor icons are trademarks of Vendor Inc.", unmodified: true });
  const html = (p = pack) => renderToStaticMarkup(createElement(ArchExplorer, { spec: spec(), iconPack: p }));

  it("shows the credit line and switches off icon changes when the pack's icons are drawn", () => {
    const out = html();
    expect(out).toContain("trademarks of Vendor Inc.");
    expect(out).toContain('class="adg unmod');
  });

  it("shows no credit when none of the pack's icons are on the diagram", () => {
    expect(html(packFromSvgMap({ unrelated: SVG }, { attribution: "Vendor credit." }))).not.toContain("Vendor credit.");
  });

  it("puts the credit under the static SVG and leaves the icon uncropped", () => {
    const svg = renderToSvg(spec(), { iconPack: pack });
    expect(svg).toContain("trademarks of Vendor Inc.");
    expect(svg).not.toContain("clip-path");
    expect(renderToSvg(spec())).not.toContain("trademarks");
  });
});
