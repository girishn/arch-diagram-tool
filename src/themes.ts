import type { CSSProperties } from "react";
import type { ZoneKind } from "./schema.ts";

/**
 * A theme is a named set of `--adg-*` custom properties: colours and font stacks together.
 * Pass an id or a `Theme` object as the `theme` prop; nothing else in the renderer knows about themes.
 *
 * Keys are the token name without the `--adg-` prefix:
 *   bg bg2 bg3 border accent accent-dim accent-hover on-accent text text-dim
 *   good info warn risk hot shadow glyph-tile font-serif font-mono
 * `hot` is the bright highlight on an active cable and the trace pulse; `shadow` tints drop shadows;
 * `glyph-tile` is the light tile under icons that have no background of their own.
 */
export type Theme = {
  id: string;
  label: string;
  vars: Record<string, string>;
};

const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = 'system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO = 'ui-monospace, "Cascadia Code", "SFMono-Regular", Consolas, "Liberation Mono", monospace';

export const THEMES: Theme[] = [
  {
    id: "brass",
    label: "Brass (dark)",
    vars: {
      bg: "#0f1115", bg2: "#151922", bg3: "#1d2331", border: "#2a3142",
      accent: "#d4a24c", "accent-dim": "#836936", "accent-hover": "#f0c36a", "on-accent": "#0f1115",
      text: "#e9e6df", "text-dim": "#a2a39d",
      good: "#6fae7c", info: "#7fa6d6", warn: "#e0b04a", risk: "#e0715f",
      hot: "#fff1c9", shadow: "rgba(0, 0, 0, 0.5)", "glyph-tile": "#f4f1ea",
      "font-serif": SERIF, "font-mono": MONO,
    },
  },
  {
    id: "slate",
    label: "Slate (dark, sans)",
    vars: {
      bg: "#0b1220", bg2: "#101a2e", bg3: "#17233b", border: "#26344f",
      accent: "#5aa9e6", "accent-dim": "#3272a4", "accent-hover": "#8ccbff", "on-accent": "#0b1220",
      text: "#e6edf7", "text-dim": "#9fb0c7",
      good: "#6fcf97", info: "#7fb4f0", warn: "#f2c94c", risk: "#f2766b",
      hot: "#e6f4ff", shadow: "rgba(0, 0, 0, 0.55)", "glyph-tile": "#eef3fa",
      "font-serif": SANS, "font-mono": MONO,
    },
  },
  {
    id: "paper",
    label: "Paper (light)",
    vars: {
      bg: "#faf7f0", bg2: "#f1ece0", bg3: "#e8e1d1", border: "#d6cdb8",
      accent: "#8a5a12", "accent-dim": "#97793a", "accent-hover": "#a8650f", "on-accent": "#fffdf8",
      text: "#2a2418", "text-dim": "#5f5844",
      good: "#2a7544", info: "#27659b", warn: "#8f5a00", risk: "#a8382a",
      hot: "#5a3600", shadow: "rgba(60, 40, 10, 0.22)", "glyph-tile": "#ffffff",
      "font-serif": SERIF, "font-mono": MONO,
    },
  },
  {
    id: "terminal",
    label: "Terminal (dark, mono)",
    vars: {
      bg: "#0a0f0a", bg2: "#0f160f", bg3: "#152015", border: "#223322",
      accent: "#6fdc6f", "accent-dim": "#3a7d3a", "accent-hover": "#a6ffa6", "on-accent": "#0a0f0a",
      text: "#d6f5d6", "text-dim": "#8fb08f",
      good: "#6fdc6f", info: "#6fd0dc", warn: "#e6d36a", risk: "#f08a7a",
      hot: "#e9ffe9", shadow: "rgba(0, 0, 0, 0.6)", "glyph-tile": "#e9f5e9",
      "font-serif": MONO, "font-mono": MONO,
    },
  },
  {
    id: "contrast",
    label: "High contrast (dark)",
    vars: {
      bg: "#000000", bg2: "#0a0a0a", bg3: "#161616", border: "#8a8a8a",
      accent: "#ffd400", "accent-dim": "#b39500", "accent-hover": "#fff066", "on-accent": "#000000",
      text: "#ffffff", "text-dim": "#d4d4d4",
      good: "#4cff7a", info: "#6cc7ff", warn: "#ffd400", risk: "#ff7b6e",
      hot: "#ffffff", shadow: "rgba(0, 0, 0, 0.8)", "glyph-tile": "#ffffff",
      "font-serif": SANS, "font-mono": MONO,
    },
  },
];

export const DEFAULT_THEME = "brass";

/** A theme by id (falling back to the default), or the object itself. */
export function getTheme(theme: string | Theme | undefined): Theme {
  if (typeof theme === "object") return theme;
  return THEMES.find((t) => t.id === theme) ?? THEMES.find((t) => t.id === DEFAULT_THEME)!;
}

/** The theme as an inline style: every `--adg-*` property, ready for a wrapper's `style`. */
export function themeStyle(theme: string | Theme | undefined): CSSProperties {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(getTheme(theme).vars)) vars[`--adg-${k}`] = v;
  return vars as CSSProperties;
}

/**
 * How each kind of zone is drawn. `color` is a hex colour, or "accent-dim" to follow the theme. The CSS is generated from this, and the
 * contrast tests read it, so what is checked is what is drawn. A zone's label and border are the colour mixed towards the theme's text
 * (label 40% colour, border 60% colour) so both stay readable on every theme.
 */
export const ZONE_STYLE: Record<ZoneKind, { color: string; line: "solid" | "dashed" | "dotted" }> = {
  cloud: { color: "accent-dim", line: "solid" },
  account: { color: "accent-dim", line: "solid" },
  region: { color: "#8d9bb0", line: "dashed" },
  vpc: { color: "#6f9bd6", line: "solid" },
  subnet: { color: "#78b394", line: "dashed" },
  az: { color: "#8d9bb0", line: "dotted" },
  cluster: { color: "#b48ad6", line: "dashed" },
  "scaling-group": { color: "#b48ad6", line: "dashed" },
  boundary: { color: "#d0715f", line: "dashed" },
  tooling: { color: "#9aa86a", line: "dashed" },
  group: { color: "#8d9bb0", line: "dashed" },
};
export const ZONE_LABEL_MIX = 40; // percent of the zone colour in its label
export const ZONE_BORDER_MIX = 60; // percent of the zone colour in its border
