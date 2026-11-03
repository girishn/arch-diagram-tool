import { ZONE_BORDER_MIX, ZONE_LABEL_MIX, ZONE_STYLE } from "../src/themes.ts";
import type { Theme } from "../src/themes.ts";

// WCAG contrast. Text on a surface needs 4.5:1; the accent as text and as a fill needs 4.5:1 too, since it carries small caps labels;
// graphics (cables, outlines) need 3:1.

const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const contrastRatio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** [foreground token, background token, minimum ratio, where it is used] */
export const PAIRS: [string, string, number, string][] = [
  ["text", "bg", 4.5, "body text"],
  ["text", "bg2", 4.5, "text on toolbar and info strip"],
  ["text", "bg3", 4.5, "text on cards"],
  ["text-dim", "bg", 4.5, "secondary text"],
  ["text-dim", "bg2", 4.5, "secondary text on toolbar and info strip"],
  ["accent", "bg", 4.5, "accent labels and tags"],
  ["accent", "bg2", 4.5, "accent labels on the info strip"],
  ["on-accent", "accent", 4.5, "selected button and name plate"],
  ["on-accent", "accent-hover", 4.5, "hovered chip and lit name plate"],
  ["good", "bg", 4.5, "good level"],
  ["info", "bg", 4.5, "info level"],
  ["warn", "bg", 4.5, "warn level"],
  ["risk", "bg", 4.5, "risk level"],
  ["good", "bg2", 4.5, "good level on the info strip"],
  ["info", "bg2", 4.5, "info level on the info strip"],
  ["warn", "bg2", 4.5, "warn level on the info strip"],
  ["risk", "bg2", 4.5, "risk level on the info strip"],
  ["hot", "bg", 3, "active cable and pulse (graphic)"],
  ["accent-dim", "bg", 3, "cable and outline (graphic)"],
  ["accent-dim", "bg2", 3, "peripheral outline on the plane (graphic)"],
  ["accent-dim", "bg3", 3, "peripheral outline on a card (graphic)"],
  ["accent-hover", "bg", 3, "focus ring (graphic)"],
  ["accent-hover", "bg2", 3, "focus ring on the toolbar and info strip (graphic)"],
  ["accent-hover", "bg3", 3, "focus ring on a card (graphic)"],
  ["accent", "bg3", 3, "selected outline on a card (graphic)"],
];

export type ContrastFailure = { fg: string; bg: string; ratio: number; min: number; use: string };

/** The pairs of a theme that fall short of their minimum. */
export function themeContrastFailures(theme: Theme): ContrastFailure[] {
  return PAIRS.map(([fg, bg, min, use]) => ({ fg, bg, min, use, ratio: contrastRatio(theme.vars[fg]!, theme.vars[bg]!) })).filter((p) => p.ratio < p.min);
}

const toRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
/** CSS color-mix(in srgb, a pct%, b): a straight blend in sRGB, as the browser does it. */
export const mix = (a: string, b: string, pct: number) => {
  const [ra, rb] = [toRgb(a), toRgb(b)];
  const c = ra.map((v, i) => Math.round((v * pct) / 100 + rb[i]! * (1 - pct / 100)));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

/** Zone labels need 4.5:1 and zone borders 3:1 against the plane (with the zone's faint tint on it), in every theme. */
export function zoneContrastFailures(theme: Theme): ContrastFailure[] {
  const out: ContrastFailure[] = [];
  for (const [kind, z] of Object.entries(ZONE_STYLE)) {
    const zc = z.color === "accent-dim" ? theme.vars["accent-dim"]! : z.color;
    const ground = mix(zc, theme.vars.bg2!, 8); // the zone fills 8% of its colour over the plane
    const label = mix(zc, theme.vars.text!, ZONE_LABEL_MIX);
    const border = mix(zc, theme.vars.text!, ZONE_BORDER_MIX);
    const l = contrastRatio(label, ground);
    const b = contrastRatio(border, ground);
    if (l < 4.5) out.push({ fg: `${kind} label`, bg: "zone", ratio: l, min: 4.5, use: "zone label text" });
    if (b < 3) out.push({ fg: `${kind} border`, bg: "zone", ratio: b, min: 3, use: "zone border (graphic)" });
  }
  return out;
}
