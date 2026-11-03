import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, THEMES, getTheme, themeStyle } from "../../src/index.ts";
import { themeContrastFailures, zoneContrastFailures } from "../../scripts/contrast.ts";

describe("themes", () => {
  const tokens = Object.keys(THEMES.find((t) => t.id === DEFAULT_THEME)!.vars).sort();

  it("has unique ids and includes the default", () => {
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    expect(THEMES.some((t) => t.id === DEFAULT_THEME)).toBe(true);
  });

  for (const theme of THEMES) {
    it(`${theme.id} defines the same tokens as the default`, () => {
      expect(Object.keys(theme.vars).sort()).toEqual(tokens);
    });

    it(`${theme.id} keeps every zone label and border readable`, () => {
      expect(zoneContrastFailures(theme).map((f) => `${f.fg}: ${f.ratio.toFixed(2)} < ${f.min}`)).toEqual([]);
    });

    it(`${theme.id} meets the contrast minimums`, () => {
      expect(themeContrastFailures(theme).map((f) => `${f.fg} on ${f.bg}: ${f.ratio.toFixed(2)} < ${f.min} (${f.use})`)).toEqual([]);
    });
  }

  it("falls back to the default for an unknown id, and accepts a theme object", () => {
    expect(getTheme("nope").id).toBe(DEFAULT_THEME);
    expect(getTheme(undefined).id).toBe(DEFAULT_THEME);
    const mine = { id: "mine", label: "Mine", vars: { bg: "#000" } };
    expect(getTheme(mine)).toBe(mine);
  });

  it("turns tokens into --adg-* custom properties", () => {
    const style = themeStyle("paper") as Record<string, string>;
    expect(style["--adg-bg"]).toBe(THEMES.find((t) => t.id === "paper")!.vars.bg);
    expect(Object.keys(style).every((k) => k.startsWith("--adg-"))).toBe(true);
  });
});
