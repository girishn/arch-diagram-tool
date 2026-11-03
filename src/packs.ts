import type { IconDef, IconPack } from "./icons.tsx";

/** Options shared by the pack builders. */
export type PackOptions = {
  /** Trademark or credit wording, shown whenever one of the pack's icons is drawn. */
  attribution?: string;
  /** Draw the icons exactly as supplied. Set for any vendor set whose terms forbid altering the icons. */
  unmodified?: boolean;
  /** `service` (the default) for icons that carry their own background; `glyph` for line icons that need a light tile. */
  tile?: IconDef["tile"];
};

/** An SVG string as an image URL. It goes through `<img>`, so the SVG's own styles and scripts cannot touch the page. */
export const svgDataUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/**
 * A pack from an in-memory map of icon key to SVG source, such as `import.meta.glob("./icons/*.svg", { query: "?raw" })` gives.
 * Keys are matched case-insensitively. `aliases` lets several spec keys share one icon (`{ apigw: "api-gateway" }`).
 */
export function packFromSvgMap(svgs: Record<string, string>, opts: PackOptions & { aliases?: Record<string, string> } = {}): IconPack {
  const byKey = new Map(Object.entries(svgs).map(([k, v]) => [k.toLowerCase(), v]));
  const aliases = new Map(Object.entries(opts.aliases ?? {}).map(([k, v]) => [k.toLowerCase(), v.toLowerCase()]));
  const cache = new Map<string, IconDef>();
  return {
    attribution: opts.attribution,
    unmodified: opts.unmodified,
    resolve(key) {
      const k = key.toLowerCase();
      const svg = byKey.get(k) ?? byKey.get(aliases.get(k) ?? "");
      if (!svg) return undefined;
      let def = cache.get(k);
      if (!def) cache.set(k, (def = { tile: opts.tile ?? "service", src: svgDataUri(svg) }));
      return def;
    },
  };
}

/** The part of the Iconify JSON format that matters here (https://iconify.design/docs/types/iconify-json.html). */
export type IconifyJson = {
  prefix?: string;
  width?: number;
  height?: number;
  icons: Record<string, { body: string; width?: number; height?: number }>;
  aliases?: Record<string, { parent: string; width?: number; height?: number }>;
};

/**
 * A pack from an Iconify JSON set (hundreds of open icon sets ship in this format). Plain data, so it works on a server and in a static
 * export, unlike the client-only Iconify components. Iconify icons are mostly line art, so they default to the light `glyph` tile.
 * The set's licence is yours to check and credit: pass it as `attribution`.
 */
export function packFromIconify(json: IconifyJson, opts: PackOptions = {}): IconPack {
  const svgs: Record<string, string> = {};
  const add = (name: string, body: string, w?: number, h?: number) => {
    const width = w ?? json.width ?? 16;
    const height = h ?? json.height ?? 16;
    svgs[name] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${body}</svg>`;
  };
  for (const [name, i] of Object.entries(json.icons ?? {})) add(name, i.body, i.width, i.height);
  for (const [name, a] of Object.entries(json.aliases ?? {})) {
    const parent = json.icons?.[a.parent];
    if (parent) add(name, parent.body, a.width ?? parent.width, a.height ?? parent.height);
  }
  return packFromSvgMap(svgs, { tile: "glyph", ...opts });
}
