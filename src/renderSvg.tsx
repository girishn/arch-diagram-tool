import { renderToStaticMarkup } from "react-dom/server";
import { chipWidth, computeLayout, linkGeometry, TILE, zoneRects } from "./layout.ts";
import type { Box } from "./layout.ts";
import { genericPack, resolveIcon } from "./icons.tsx";
import type { IconPack } from "./icons.tsx";
import { resolveLink } from "./resolve.ts";
import { routeLinks } from "./route.ts";
import type { DiagramSpec } from "./schema.ts";
import { getTheme, ZONE_BORDER_MIX, ZONE_LABEL_MIX, ZONE_STYLE } from "./themes.ts";
import type { Theme } from "./themes.ts";

export type SvgOptions = {
  theme?: string | Theme;
  iconPack?: IconPack;
  /** Label every cable. Off-path cables are labelled in a still image because there is no hover to reveal them. Default true. */
  allLabels?: boolean;
  /** `"orthogonal"` (default): right-angle routes around the cards, as the live diagram draws them. `"straight"`: straight lines, bent at the spec's waypoints. */
  routing?: "straight" | "orthogonal";
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** `pct` percent of colour `a` mixed into colour `b`. SVG viewers do not all support `color-mix`, so the mixing is done here. */
function mix(a: string, b: string, pct: number): string {
  const rgb = (h: string) => {
    const x = h.replace("#", "");
    const f = x.length === 3 ? x.replace(/./g, "$&$&") : x;
    return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
  };
  const [ra, rb] = [rgb(a), rgb(b)];
  return "#" + ra.map((v, i) => Math.round((v * pct + rb[i]! * (100 - pct)) / 100).toString(16).padStart(2, "0")).join("");
}

/**
 * The flat (top) view as one self-contained SVG string, for a README, a slide or an og:image. Same geometry as the live diagram
 * (it calls the same layout functions), but no scripts, no animation and no CSS variables, so any viewer can draw it. Uses
 * `react-dom/server` to draw the icon pack's icons, so it is not exported from the main entry (import `src/renderSvg.tsx` directly, or the separate `svg` entry once packaged), which
 * keeps it out of browser bundles. Shows the Flow view only; lenses and the trace are interactive features.
 */
export function renderToSvg(spec: DiagramSpec, opts: SvgOptions = {}): string {
  const th = getTheme(opts.theme).vars;
  const pack = opts.iconPack ?? genericPack;
  const layout = computeLayout(spec, false);
  const { W, xy } = layout;
  // A vendor pack's credit line goes under the picture, only when one of its own icons is drawn.
  const credit = pack.attribution && spec.nodes.some((n) => n.icons.some((ic) => pack.resolve(typeof ic === "string" ? ic : ic.icon))) ? pack.attribution : null;
  const H = layout.H + (credit ? 34 : 0);
  const unmod = pack.unmodified === true;
  const font = (k: "font-serif" | "font-mono") => esc(th[k] ?? "serif");
  const nameSize = 14;

  const taken: Box[] = [];
  const routed = (opts.routing ?? "orthogonal") === "orthogonal" ? routeLinks(spec, layout, spec.links.map((l) => ({ twoWay: resolveLink(l).twoWay, toOtherFloor: false })), undefined, taken, "card") : null;
  const links = spec.links.map((l, i) => {
    const r = resolveLink(l);
    const g = routed ? routed[i] : linkGeometry(spec, l, layout, r.twoWay, taken, true);
    return g ? { l, r, g } : null;
  });
  const zones = zoneRects(
    spec,
    layout,
    links.flatMap((x) => (x ? [{ pts: x.g.pts, mid: x.g.mid, label: x.l.label }] : [])),
  ).sort((a, b) => a.depth - b.depth);

  const out: string[] = [];
  const grid = `<pattern id="g" width="44" height="44" patternUnits="userSpaceOnUse"><path d="M44 0H0V44" fill="none" stroke="${th.border}" stroke-width="1"/></pattern>`;
  const marker = (id: string, hollow: boolean) =>
    hollow
      ? `<marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="12" markerHeight="12" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1 1 L9 5 L1 9 z" fill="${th.bg}" stroke="${th.accent}" stroke-width="1.6" stroke-linejoin="round"/></marker>`
      : `<marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="12" markerHeight="12" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0 0 L10 5 L0 10 z" fill="${th.accent}"/></marker>`;

  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(spec.title)}" font-family="${font("font-serif")}">`,
    `<title>${esc(spec.title)}</title>`,
    spec.description ? `<desc>${esc(spec.description)}</desc>` : "",
    `<defs>${grid}${marker("a", false)}${marker("h", true)}</defs>`,
    `<rect width="${W}" height="${H}" fill="${th.bg2}"/><rect width="${W}" height="${H}" fill="url(#g)"/>`,
  );

  for (const z of zones) {
    const st = ZONE_STYLE[z.kind];
    const base = st.color === "accent-dim" ? th["accent-dim"]! : st.color;
    const dash = st.line === "dashed" ? ' stroke-dasharray="7 5"' : st.line === "dotted" ? ' stroke-dasharray="2 4"' : "";
    out.push(
      `<rect x="${z.left}" y="${z.top}" width="${z.width}" height="${z.height}" rx="6" fill="${mix(base, th.bg2!, 8)}" stroke="${mix(base, th.text!, ZONE_BORDER_MIX)}" stroke-width="1.5"${dash}/>`,
      `<text x="${z.left + z.labelLeft}" y="${z.top + z.labelTop + 18}" font-size="18" font-style="italic" fill="${mix(base, th.text!, ZONE_LABEL_MIX)}">${esc(z.label)}</text>`,
    );
  }

  for (const x of links) {
    if (!x) continue;
    const { r, g } = x;
    const dep = r.pattern === "dependency";
    const hollow = r.interaction === "async";
    const style = dep ? ' stroke-width="2" stroke-dasharray="6 6"' : hollow ? ' stroke-width="4" stroke-dasharray="1 9" stroke-linecap="round"' : r.offPath ? ' stroke-width="2.5" stroke-dasharray="10 8"' : ' stroke-width="3.5"';
    const m = dep ? "" : ` marker-end="url(#${hollow ? "h" : "a"})"${r.twoWay ? ` marker-start="url(#${hollow ? "h" : "a"})"` : ""}`;
    out.push(`<path d="${g.d}" fill="none" stroke="${th["accent-dim"]}"${style}${m}${r.offPath ? ' opacity="0.7"' : ""}/>`);
  }

  for (const n of spec.nodes) {
    const [cx, cy] = xy(n.at.col, n.at.row);
    const icons = n.icons.map((ic) => ({ def: resolveIcon(pack, typeof ic === "string" ? ic : ic.icon), caption: typeof ic === "string" ? undefined : ic.label }));
    const fw = icons.length * TILE + (icons.length - 1) * 8 + 16;
    const fh = TILE + 16;
    const fx = cx - fw / 2;
    const fy = cy - fh / 2;
    const dashed = n.peripheral ? ' stroke-dasharray="5 4"' : "";
    out.push(`<g><rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" rx="6" fill="${th.bg3}" stroke="${th["accent-dim"]}"${dashed}/>`);
    icons.forEach(({ def }, k) => {
      const ix = fx + 8 + k * (TILE + 8);
      const iy = fy + 8;
      const glyph = def.tile === "glyph" && !unmod;
      const inner = def.src ? `<image href="${esc(def.src)}" width="${TILE}" height="${TILE}"/>` : `<svg viewBox="0 0 64 64" width="${TILE}" height="${TILE}">${renderToStaticMarkup(<>{def.svg}</>)}</svg>`;
      out.push(
        glyph
          ? `<g transform="translate(${ix} ${iy})"><rect width="${TILE}" height="${TILE}" rx="6" fill="${th["glyph-tile"]}"/><g transform="translate(12 12) scale(${(TILE - 24) / TILE})">${inner}</g></g>`
          : `<g transform="translate(${ix} ${iy})" ${unmod ? "" : ' clip-path="inset(0 round 6px)"'}>${inner}</g>`,
      );
    });
    const showSub = Boolean(n.sub);
    const plateW = n.label.length * 8.6 + 22;
    const plateH = nameSize + 11;
    const subY = fy - 12;
    const plateBottom = showSub ? subY - 12 : fy - 8;
    out.push(
      `<rect x="${cx - plateW / 2}" y="${plateBottom - plateH}" width="${plateW}" height="${plateH}" fill="${th.bg}" stroke="${th["accent-dim"]}"${dashed}/>`,
      `<text x="${cx}" y="${plateBottom - 8}" text-anchor="middle" font-size="${nameSize}" font-weight="600" fill="${th.text}">${esc(n.label)}</text>`,
    );
    if (showSub) out.push(`<text x="${cx}" y="${subY}" text-anchor="middle" font-size="10" letter-spacing="1.6" font-family="${font("font-mono")}" fill="${th["text-dim"]}">${esc(n.sub!.toUpperCase())}</text>`);
    out.push("</g>");
  }

  for (const x of links) {
    if (!x) continue;
    if (x.r.offPath && opts.allLabels === false) continue;
    const w = chipWidth(x.l);
    const [mx, my] = x.g.mid;
    const tag = x.l.traffic === "ingress" ? "IN" : x.l.traffic === "egress" ? "OUT" : "";
    out.push(
      `<rect x="${mx - w / 2}" y="${my - 12}" width="${w}" height="24" fill="${th.bg}" stroke="${th["accent-dim"]}"/>`,
      `<text x="${mx + (tag ? 11 : 0)}" y="${my + 3.5}" text-anchor="middle" font-size="10" letter-spacing="0.6" font-family="${font("font-mono")}" fill="${th["text-dim"]}">${esc(x.l.label.toUpperCase())}</text>`,
      tag ? `<text x="${mx - w / 2 + 8}" y="${my + 3}" font-size="8" font-weight="700" font-family="${font("font-mono")}" fill="${th.accent}">${tag}</text>` : "",
    );
  }

  if (credit) out.push(`<text x="16" y="${H - 12}" font-size="11" font-family="${font("font-mono")}" fill="${th["text-dim"]}">${esc(credit)}</text>`);
  out.push("</svg>");
  return out.filter(Boolean).join("\n");
}
