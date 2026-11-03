import { PAD, TILE } from "./layout.ts";
import { ZONE_BORDER_MIX, ZONE_LABEL_MIX, ZONE_STYLE } from "./themes.ts";

const ZONE_RULES = Object.entries(ZONE_STYLE)
  .map(([kind, z]) => `.adg-zone.k-${kind} { --zc: ${z.color === "accent-dim" ? "var(--adg-accent-dim)" : z.color}; --zs: ${z.line}; }`)
  .join("\n");

/**
 * All colours and fonts are CSS custom properties with defaults on `.adg`, so a host restyles the diagram by
 * setting `--adg-*` on the wrapper (or the `style` prop). The CSS ships inside a <style> tag, so a Next.js
 * static export needs no CSS loader.
 *
 * Tokens: --adg-bg --adg-bg2 --adg-bg3 --adg-border --adg-accent --adg-accent-dim --adg-accent-hover
 *         --adg-text --adg-text-dim --adg-on-accent --adg-good --adg-info --adg-warn --adg-risk
 *         --adg-hot (active cable, trace pulse) --adg-shadow --adg-glyph-tile
 * The built-in themes (src/themes.ts) are sets of these.
 *         --adg-font-serif --adg-font-mono --adg-name-size
 */
export const DIAGRAM_CSS = `
:where(.adg) {
  --adg-bg: #0f1115; --adg-bg2: #151922; --adg-bg3: #1d2331; --adg-border: #2a3142;
  --adg-accent: #d4a24c; --adg-accent-dim: #7a6232; --adg-accent-hover: #f0c36a; --adg-on-accent: #0f1115;
  --adg-text: #e9e6df; --adg-text-dim: #a2a39d;
  --adg-hot: #fff1c9; --adg-shadow: rgba(0, 0, 0, 0.5); --adg-glyph-tile: #f4f1ea;
  --adg-good: #6fae7c; --adg-info: #7fa6d6; --adg-warn: #e0b04a; --adg-risk: #e0715f;
  --adg-name-size: 14px; /* the name plate above each component */
  --adg-font-serif: Georgia, "Times New Roman", serif;
  --adg-font-mono: ui-monospace, "Cascadia Code", "SFMono-Regular", Consolas, "Liberation Mono", monospace;
}
.adg { border: 1px solid var(--adg-border); background: var(--adg-bg); color: var(--adg-text); position: relative; font-family: var(--adg-font-serif); }
.adg *, .adg *::before, .adg *::after { box-sizing: border-box; }
.adg-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.adg-bar { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; padding: 0.7rem 0.9rem; border-bottom: 1px solid var(--adg-border); background: var(--adg-bg2); }
.adg-seg { display: inline-flex; flex-wrap: wrap; max-width: 100%; /* a font that runs a little wide wraps the buttons instead of pushing the page sideways */ border: 1px solid var(--adg-accent-dim); }
.adg-btn { font-family: var(--adg-font-mono); font-size: 0.62rem; letter-spacing: 0.16em; text-transform: uppercase; padding: 0.55rem 0.9rem; min-height: 36px; background: transparent; color: var(--adg-text-dim); border: none; cursor: pointer; }
.adg-btn[aria-pressed="true"] { background: var(--adg-accent); color: var(--adg-on-accent); }
.adg-btn:hover:not([aria-pressed="true"]), .adg-btn:focus-visible { color: var(--adg-text); }
.adg-btn.icon { min-width: 36px; padding: 0.55rem 0.4rem; font-size: 0.85rem; letter-spacing: 0; }
.adg-btn[disabled] { opacity: 0.4; cursor: default; }
.adg-tool { border: 1px solid var(--adg-accent-dim); }
.adg-cap { font-family: var(--adg-font-mono); font-size: 0.56rem; letter-spacing: 0.2em; text-transform: uppercase; color: var(--adg-text-dim); }
.adg-select { font-family: var(--adg-font-mono); font-size: 0.62rem; letter-spacing: 0.12em; text-transform: uppercase; min-height: 36px; padding: 0 0.6rem; background: var(--adg-bg); color: var(--adg-text); border: 1px solid var(--adg-accent-dim); }
.adg-grow { flex: 1; }
.adg-hint { font-family: var(--adg-font-mono); font-size: 0.58rem; letter-spacing: 0.1em; color: var(--adg-text-dim); }
.adg-view { position: relative; overflow: hidden; overflow: clip; /* clip, not hidden: a clipped box that is not a scroll container cannot be scrolled by focus */ touch-action: pan-y; -webkit-user-select: none; user-select: none; background: radial-gradient(ellipse at 50% 45%, var(--adg-bg3), var(--adg-bg) 78%); }
.adg-view.pan { cursor: grab; }
.adg-view.drag { cursor: grabbing; }
.adg-plane { position: absolute; left: 50%; top: 50%; transform-style: preserve-3d; transition: transform 0.9s cubic-bezier(0.2, 0.7, 0.2, 1); }
.adg-plane.nt, .adg-plane.nt .adg-anchor { transition: none; }
.adg-flat { position: absolute; inset: 0; transform-style: flat; border: 1px solid var(--adg-accent-dim); background-color: var(--adg-bg2); background-image: linear-gradient(var(--adg-border) 1px, transparent 1px), linear-gradient(90deg, var(--adg-border) 1px, transparent 1px); background-size: 44px 44px; }
.adg-zone { --zc: var(--adg-accent-dim); --zs: solid; position: absolute; border-radius: 6px; border: 1.5px var(--zs) color-mix(in srgb, var(--zc) ${ZONE_BORDER_MIX}%, var(--adg-text)); background: color-mix(in srgb, var(--zc) 8%, transparent); }
${ZONE_RULES}
.adg-band { position: absolute; pointer-events: none; border-top: 1px dashed var(--adg-accent-dim); border-bottom: 1px dashed var(--adg-accent-dim); background: color-mix(in srgb, var(--adg-accent) 5%, transparent); }
.adg-band.alt { background: color-mix(in srgb, var(--adg-accent) 10%, transparent); }
.adg-band.floor { border: 1.5px solid var(--adg-accent-dim); border-radius: 6px; background: color-mix(in srgb, var(--adg-bg3) 55%, transparent); box-shadow: 0 14px 30px var(--adg-shadow); }
.adg-band-label { position: absolute; left: 14px; top: 10px; font-family: var(--adg-font-mono); font-size: 13px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--adg-text-dim); }
.adg-floor { position: absolute; inset: 0; transform-style: flat; pointer-events: none; }
.adg-plane.flat2d { transform-style: flat; }
/* Floors: every title is drawn in a layer above all the cards, so no icon can cover one. The card keeps its own title only for layout and for assistive tech (it has an aria-label). */
.adg-plane.flat2d .adg-card .adg-label { visibility: hidden; }
.adg-ghost { position: absolute; left: 0; bottom: 0; width: max-content; transform: translateX(-50%) translateY(var(--ty, 0px)); display: flex; flex-direction: column; align-items: center; gap: 6px; pointer-events: none; color: var(--adg-text); font: inherit; }
.adg-ghost .adg-frame { visibility: hidden; }
.adg-ghost .adg-name { transition: background 0.3s, color 0.3s, border-color 0.3s; } /* the same easing as the card's own plate and its pad, so a click changes them together */
.adg-ghost.hov .adg-name { border-color: var(--adg-accent-hover); border-top-color: var(--adg-accent-hover); }
.adg-ghost.sel .adg-name::before { content: "▸"; margin-right: 6px; }
.adg-ghost.sel .adg-name { background: var(--adg-accent); color: var(--adg-on-accent); border-color: var(--adg-accent); }
.adg-ghost.lit .adg-name { background: var(--adg-accent-hover); color: var(--adg-on-accent); border-color: var(--adg-accent-hover); }
.adg-ghost.dim .adg-name { background: transparent; border-color: transparent; }
.adg-ghost.dim .adg-scale { background: transparent; color: var(--adg-text-dim); box-shadow: inset 0 0 0 1px var(--adg-border); }
.adg-ghost.periph .adg-name { border-style: dashed; }
/* In the floors view the card stands on its pad, so the pad is only a plinth a little wider than the icon, not the 106 px square the flat view uses. Size only: its glow when selected or lit is untouched. */
.adg-plane.flat2d .adg-pad { width: ${TILE + 8}px; height: ${TILE + 8}px; border-radius: 10px; }
.adg-plane.flat2d .adg-pad.wide { width: ${TILE * 2 + 24}px; }
.adg-cross, .adg-heads { pointer-events: none; }
.adg-head { fill: var(--adg-accent); stroke: none; transition: fill 0.3s, opacity 0.3s; }
.adg-head.hot { fill: var(--adg-hot); }
.adg-head.async { fill: var(--adg-bg); stroke: var(--adg-accent); stroke-width: 1.6; stroke-linejoin: round; }
.adg-head.hot.async { stroke: var(--adg-hot); }
.adg-head.quiet { opacity: 0.4; }
.adg-head.dim { opacity: 0.18; }
.adg-cross .adg-hit { pointer-events: stroke; }
.adg-zone-label { position: absolute; left: 12px; bottom: 8px; display: flex; align-items: center; gap: 8px; height: 26px; white-space: nowrap; font-style: italic; font-size: 18px; color: color-mix(in srgb, var(--zc) ${ZONE_LABEL_MIX}%, var(--adg-text)); }
/* The label is a button when the container holds components: pressing it lights them, the arrows in and out, and their far ends. */
button.adg-zone-label { pointer-events: auto; /* floors switch pointer events off for everything on them */ z-index: 2; /* above the cable layer, which is drawn after the zones, so the button can be pressed */ cursor: pointer; background: none; border: none; padding: 0; margin: 0; font: inherit; font-style: italic; font-size: 18px; min-height: calc(24px * var(--adg-k, 1)); text-decoration: underline dotted transparent; text-underline-offset: 4px; transition: text-decoration-color 0.2s; }
button.adg-zone-label:hover, button.adg-zone-label[aria-pressed="true"] { text-decoration-color: currentColor; }
.adg-zone-head { position: absolute; z-index: 2; display: flex; align-items: center; gap: 6px; pointer-events: none; }
.adg-zone-head > .adg-zone-label { position: static; }
.adg-zone-fold { pointer-events: auto; cursor: pointer; display: grid; place-items: center; min-width: calc(24px * var(--adg-k, 1)); min-height: calc(24px * var(--adg-k, 1)); padding: 0; font: 600 18px/1 var(--adg-font-mono); color: var(--adg-text-dim); background: color-mix(in srgb, var(--adg-bg) 85%, transparent); border: 1px solid var(--adg-border); }
.adg-zone-fold:hover, .adg-zone-fold:focus-visible { color: var(--adg-on-accent); background: var(--adg-accent-hover); border-color: var(--adg-accent-hover); }
.adg-zone.sel { border-width: 2.5px; border-color: var(--zc); background: color-mix(in srgb, var(--zc) 16%, transparent); }
.adg-svg { position: absolute; inset: 0; overflow: visible; }
.adg-edge { transition: opacity 0.3s; }
/* With a lens on, an arrow takes the colour of its level (good, info, warn, risk), so arrows of different kinds can be told apart without reading their labels. */
.adg-edge[class*="lv-"] .adg-edge-base, .adg-edge[class*="lv-"] .adg-edge-flow { stroke: var(--lv); }
.adg-head.lv-good { fill: var(--adg-good); } .adg-head.lv-info { fill: var(--adg-info); } .adg-head.lv-warn { fill: var(--adg-warn); } .adg-head.lv-risk { fill: var(--adg-risk); }
.adg-head.async[class*="lv-"] { fill: var(--adg-bg); }
.adg-head.lv-good.async { stroke: var(--adg-good); } .adg-head.lv-info.async { stroke: var(--adg-info); } .adg-head.lv-warn.async { stroke: var(--adg-warn); } .adg-head.lv-risk.async { stroke: var(--adg-risk); }
.adg-edge.quiet { opacity: 0.4; } /* off-path cables step back until they are pointed at, selected, traced or next to the component in focus */
.adg-edge.dim { opacity: 0.18; }
/* Hidden by the isolate and declutter options: gone from sight and from the pointer, back the moment the component or arrow is pointed at. */
.adg-edge.hid, .adg-head.hid { opacity: 0; pointer-events: none; }
.adg-edge.hid * { pointer-events: none; }
.adg-edge-base { fill: none; stroke: var(--adg-accent-dim); stroke-width: 3.5; transition: stroke 0.3s, stroke-width 0.3s; }
.adg-edge-base.off { stroke-dasharray: 10 8; stroke-width: 2.5; opacity: 0.85; }
.adg-edge-base.dep { stroke-dasharray: 6 6; stroke-width: 2; opacity: 0.9; }
.adg-edge-base.async { stroke-dasharray: 1 9; stroke-linecap: round; stroke-width: 4; }
.adg-edge-base.sel { stroke: var(--adg-accent); stroke-width: 5; filter: drop-shadow(0 0 3px color-mix(in srgb, var(--adg-accent) 55%, transparent)); }
.adg-edge-base.hot { stroke: var(--adg-accent-hover); stroke-width: 5; }
.adg-edge-flow { fill: none; stroke: var(--adg-accent); stroke-width: 3.5; stroke-dasharray: 8 16; opacity: 0; animation: none; /* not animated until it is lit: a hidden but running animation repaints the whole cable layer every frame, which made zoom and rotate crawl */ pointer-events: none; }
/* Calm by default: the marching dashes run only on an arrow that is pointed at, selected or traced, not on every arrow at once. */
.adg-edge-flow.hot, .adg-edge-flow.sel { opacity: 0.95; animation: adg-march 1.2s linear infinite; }
.adg-edge-flow.async { stroke-dasharray: 1 15; stroke-linecap: round; stroke-width: 4.5; }
.adg-edge-flow.hot { stroke: var(--adg-hot); stroke-width: 4.5; animation-duration: 0.5s; }
.adg-hit { fill: none; stroke: transparent; stroke-width: 26; pointer-events: stroke; cursor: pointer; }
.adg-pulse-core { fill: var(--adg-hot); }
.adg-pulse-halo { fill: var(--adg-accent-hover); opacity: 0.4; }
.adg-pulse { transition: opacity 0.3s; filter: drop-shadow(0 0 8px var(--adg-accent-hover)); pointer-events: none; }
@keyframes adg-march { to { stroke-dashoffset: -24; } }
.adg-pad { position: absolute; width: ${PAD}px; height: ${PAD}px; transform: translate(-50%, -50%); border-radius: 12px; border: 1px solid var(--adg-border); background: var(--adg-bg3); box-shadow: 0 8px 16px var(--adg-shadow); transition: border-color 0.3s, box-shadow 0.3s, opacity 0.3s; }
.adg-pad.wide { width: ${TILE * 2 + 44}px; }
.adg-pad.sel { border-color: var(--adg-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--adg-accent) 40%, transparent), 0 8px 16px var(--adg-shadow); }
.adg-pad.lit { border-color: var(--adg-accent-hover); box-shadow: 0 0 24px color-mix(in srgb, var(--adg-accent-hover) 65%, transparent), 0 8px 16px var(--adg-shadow); }
.adg-pad.dim { opacity: 0.25; }
.adg-anchor { position: absolute; width: 0; height: 0; transform-origin: 0 0; transition: transform 0.9s cubic-bezier(0.2, 0.7, 0.2, 1); }
.adg-anchor.chipa { z-index: 5; }
.adg-card { position: absolute; left: 0; bottom: 0; width: max-content; transform: translateX(-50%) translateY(var(--ty, 0px)); display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 0; background: none; border: none; cursor: pointer; color: var(--adg-text); font: inherit; transition: transform 0.5s cubic-bezier(0.2, 0.7, 0.2, 1), opacity 0.3s; }
/* Unrelated cards fade their picture and plate but keep their words at full contrast (WCAG 1.4.3). */
.adg-card.dim .adg-frame, .adg-card.dim .adg-pad { opacity: 0.3; }
.adg-card.dim .adg-name { background: transparent; border-color: transparent; }
.adg-card.dim .adg-scale { background: transparent; color: var(--adg-text-dim); box-shadow: inset 0 0 0 1px var(--adg-border); }
.adg-label { display: flex; flex-direction: column; align-items: center; gap: 4px; margin-bottom: 6px; }
.adg-name { font-weight: 600; font-size: var(--adg-name-size); line-height: 1; letter-spacing: 0.02em; padding: 5px 9px 6px; background: color-mix(in srgb, var(--adg-bg) 95%, transparent); border: 1px solid var(--adg-accent-dim); border-top: 2px solid var(--adg-accent-dim); white-space: nowrap; color: var(--adg-text); transition: background 0.3s, color 0.3s, border-color 0.3s; }
.adg-sub { font-family: var(--adg-font-mono); font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--adg-text-dim); white-space: nowrap; }
.adg-badge { --lv: var(--adg-info); display: inline-flex; gap: 5px; align-items: baseline; font-family: var(--adg-font-mono); font-size: 10.5px; letter-spacing: 0.06em; padding: 2px 8px; white-space: nowrap; background: var(--adg-bg); color: var(--adg-text); border: 1px solid var(--lv); border-left-width: 3px; }
.adg-badge i { font-style: normal; color: var(--lv); }
.lv-good { --lv: var(--adg-good); } .lv-info { --lv: var(--adg-info); } .lv-warn { --lv: var(--adg-warn); } .lv-risk { --lv: var(--adg-risk); }
.adg-tr { display: inline-block; font-family: var(--adg-font-mono); font-size: 8px; font-weight: 700; letter-spacing: 0.1em; line-height: 1.5; padding: 0 4px; margin-right: 5px; text-transform: uppercase; border: 1px solid currentColor; color: var(--adg-accent); vertical-align: 1px; }
.adg-tr[data-tag]::before { content: attr(data-tag); } /* drawn from CSS, so it is not part of the chip's text: the name stays the label the visitor reads */
.adg-chip.hot .adg-tr, .adg-chip:hover .adg-tr, .adg-chip:focus-visible .adg-tr { color: var(--adg-on-accent); }
.adg-pad.periph, .adg-card.periph .adg-frame, .adg-card.periph .adg-name { border-style: dashed; }
.adg-card.periph .adg-icon { opacity: 0.88; }
.adg-key.box { width: 16px; height: 10px; border: 1px dashed var(--adg-accent-dim); border-top-width: 1px; }
.adg-scale { font-family: var(--adg-font-mono); font-size: 10px; letter-spacing: 0.08em; padding: 1px 7px; color: var(--adg-on-accent); background: var(--adg-accent); white-space: nowrap; }
.adg-frame { position: relative; display: flex; gap: 8px; padding: 7px; border: 1px solid var(--adg-accent-dim); border-radius: 6px; background: linear-gradient(180deg, var(--adg-bg3), var(--adg-bg2)); box-shadow: 0 10px 16px var(--adg-shadow), inset 0 0 0 1px rgba(255,255,255,0.035); transition: border-color 0.3s, box-shadow 0.3s; }
.adg-frame[data-step]::after { content: attr(data-step); position: absolute; top: -10px; left: -10px; z-index: 2; min-width: 22px; height: 22px; padding: 0 5px; display: grid; place-items: center; border-radius: 11px; background: var(--adg-accent); color: var(--adg-on-accent); font-family: var(--adg-font-mono); font-size: 11px; font-weight: 700; box-shadow: 0 0 0 2px var(--adg-bg); }
.adg-frame.stack { box-shadow: 5px -5px 0 -1px var(--adg-bg3), 5px -5px 0 0 var(--adg-accent-dim), 10px -10px 0 -1px var(--adg-bg3), 10px -10px 0 0 var(--adg-accent-dim), 0 10px 16px var(--adg-shadow); }
.adg-ic { display: flex; flex-direction: column; align-items: center; gap: 5px; }
.adg-icon { width: ${TILE}px; height: ${TILE}px; min-width: ${TILE}px; flex: none; display: block; border-radius: 6px; }
.adg-attrib { margin: 0; padding: 0.4rem 0.9rem; font-family: var(--adg-font-mono); font-size: 0.56rem; letter-spacing: 0.04em; color: var(--adg-text-dim); background: var(--adg-bg2); border-top: 1px solid var(--adg-border); }
.adg.unmod .adg-icon { border-radius: 0; }
.adg.unmod .adg-card.periph .adg-icon { opacity: 1; }
.adg.unmod .adg-icon.glyph { background: none; padding: 0; }
.adg-icon.glyph { background: var(--adg-glyph-tile); padding: 12px; }
.adg-cap2 { font-family: var(--adg-font-mono); font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--adg-text-dim); white-space: nowrap; }
.adg-card:hover .adg-frame, .adg-card:focus-visible .adg-frame { border-color: var(--adg-accent-hover); box-shadow: 0 0 18px color-mix(in srgb, var(--adg-accent-hover) 40%, transparent), 0 10px 16px var(--adg-shadow); }
.adg-card:hover .adg-name, .adg-card:focus-visible .adg-name { border-color: var(--adg-accent-hover); border-top-color: var(--adg-accent-hover); }
.adg-card.sel .adg-name::before { content: "▸"; margin-right: 6px; } /* a marker as well as the fill, so selection is not colour alone; CSS content, so it is not part of the button's text */
.adg-card.sel .adg-name { background: var(--adg-accent); color: var(--adg-on-accent); border-color: var(--adg-accent); }
.adg-card.sel .adg-frame { border-color: var(--adg-accent); }
.adg-card.lit .adg-name { background: var(--adg-accent-hover); color: var(--adg-on-accent); border-color: var(--adg-accent-hover); }
.adg-chip { --lv: var(--adg-accent-dim); display: inline-flex; align-items: center; justify-content: center; min-height: calc(24.6px * var(--adg-k, 1)); min-width: calc(24.6px * var(--adg-k, 1)); /* the target stays 24 px on screen whatever the plane is scaled to (WCAG 2.5.8); what is drawn inside it is smaller */ box-sizing: border-box; position: absolute; left: 0; bottom: 0; width: max-content; max-width: 220px; transform: translateX(-50%) translateY(var(--ty, 0px)); font-family: var(--adg-font-mono); font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; padding: 0; background: none; border: none; color: var(--adg-text-dim); cursor: pointer; opacity: 0; pointer-events: none; transition: opacity 0.25s; }
/* The visible label: a slim strip with no outline. Its fill keeps the cable from running through the words; it fills in on hover, focus and when lit. */
.adg-chip-in { display: inline-flex; align-items: center; box-sizing: border-box; padding: 1px 7px; background: color-mix(in srgb, var(--adg-bg) 92%, transparent); border: 1px solid transparent; transition: color 0.25s, background 0.25s, border-color 0.25s; }
.adg-chip.lens { color: var(--adg-text); }
.adg-chip.lens .adg-chip-in { border-color: var(--lv); border-left-width: 3px; }
.adg-chip.show { opacity: 0.95; pointer-events: auto; }
.adg-chip.dim:focus-visible { opacity: 1; pointer-events: auto; }
.adg-chip.hot, .adg-chip:hover, .adg-chip:focus-visible { opacity: 1; pointer-events: auto; }
.adg-chip.hot .adg-chip-in, .adg-chip:hover .adg-chip-in, .adg-chip:focus-visible .adg-chip-in { color: var(--adg-on-accent); background: var(--adg-accent-hover); border-color: var(--adg-accent-hover); }
.adg-chip.dim { opacity: 0; pointer-events: none; } /* unrelated labels step aside; keyboard focus still shows one */
.adg-tracebar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; box-sizing: border-box; padding: 7px 12px; border-top: 1px solid var(--adg-accent-dim); background: var(--adg-bg2); color: var(--adg-text); } /* a row of its own under the viewport, so it never covers a card */
.adg-co-step { font-family: var(--adg-font-mono); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--adg-accent); white-space: nowrap; }
.adg-co-text { flex: 1 1 200px; min-width: 0; font-size: 14px; line-height: 1.3; }
.adg-co-ctl { display: inline-flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-left: auto; }
.adg-co-btn, .adg-co-speed { font-family: var(--adg-font-mono); font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; min-height: 24px; min-width: 24px; box-sizing: border-box; padding: 2px 8px; border: 1px solid var(--adg-accent-dim); background: transparent; color: var(--adg-text-dim); cursor: pointer; }
.adg-co-speed { text-transform: none; background: var(--adg-bg); }
.adg-co-btn:hover:not([disabled]), .adg-co-btn:focus-visible { color: var(--adg-on-accent); background: var(--adg-accent-hover); border-color: var(--adg-accent-hover); }
.adg-co-btn.primary:not([disabled]), .adg-co-btn[aria-pressed="true"] { color: var(--adg-on-accent); background: var(--adg-accent); border-color: var(--adg-accent); }
.adg-co-btn[disabled] { opacity: 0.45; cursor: default; }
.adg-co-text.dim { color: var(--adg-text-dim); font-size: 13px; }
.adg-co-close { padding: 2px 6px; }
.adg-tracebar :focus-visible { outline: 2px solid var(--adg-accent-hover); outline-offset: 2px; }
.adg-legend { display: flex; flex-wrap: wrap; gap: 0.3rem 1.2rem; padding: 0.5rem 0.9rem; border-top: 1px solid var(--adg-border); background: var(--adg-bg2); font-family: var(--adg-font-mono); font-size: 0.58rem; letter-spacing: 0.08em; color: var(--adg-text-dim); }
.adg-legend span { display: inline-flex; gap: 6px; align-items: center; }
.adg-key { display: inline-block; width: 26px; height: 0; border-top: 3px solid var(--adg-accent-dim); }
.adg-key.async { border-top-style: dotted; } .adg-key.off { border-top-style: dashed; } .adg-key.dep { border-top-width: 2px; border-top-style: dashed; }
.adg-info { display: grid; grid-template-columns: minmax(220px, 0.8fr) 2fr; gap: 0.4rem 2rem; align-items: start; min-height: 118px; padding: 16px 20px; border-top: 1px solid var(--adg-accent-dim); background: var(--adg-bg2); }
.adg-info-head { display: flex; flex-direction: column; gap: 4px; }
.adg-info-tag { font-family: var(--adg-font-mono); font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--adg-accent); }
.adg-info h3 { font-weight: 400; font-size: 26px; line-height: 1.15; margin: 0; color: var(--adg-text); }
.adg-info p { font-size: 16px; line-height: 1.6; color: var(--adg-text-dim); font-weight: 300; margin: 0; }
.adg-info p + p { margin-top: 6px; }
.adg-info b { font-family: var(--adg-font-mono); font-weight: 400; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--adg-accent); margin-right: 8px; }
.adg-info .lvtxt { color: var(--lv); font-family: var(--adg-font-mono); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; margin-right: 8px; }
.adg-text { border-top: 1px solid var(--adg-border); background: var(--adg-bg2); padding: 0 20px; }
.adg-text summary { display: flex; align-items: center; min-height: 40px; cursor: pointer; font-family: var(--adg-font-mono); font-size: 0.62rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--adg-text-dim); }
.adg-text summary:hover, .adg-text[open] summary { color: var(--adg-text); }
.adg-text-body { max-width: 78ch; padding: 4px 0 18px; font-size: 14.5px; line-height: 1.6; color: var(--adg-text-dim); }
.adg-text-body h3 { margin: 18px 0 6px; font-family: var(--adg-font-mono); font-size: 0.7rem; font-weight: 400; letter-spacing: 0.16em; text-transform: uppercase; color: var(--adg-accent); }
.adg-text-body ul, .adg-text-body ol { margin: 0; padding-left: 1.3em; }
.adg-text-body li { margin: 3px 0; }
.adg-text-body strong { color: var(--adg-text); font-weight: 600; }
.adg :focus-visible { outline: 2px solid var(--adg-accent-hover); outline-offset: 3px; }
@media (max-width: 800px) { .adg-info { grid-template-columns: 1fr; min-height: 0; } .adg-info h3 { font-size: 22px; } }
@media (forced-colors: active) {
  /* The system palette replaces ours: keep shape, borders and text carrying the meaning, and use system colours where we draw. */
  .adg-card .adg-name, .adg-chip, .adg-badge, .adg-scale, .adg-btn, .adg-select { border: 1px solid ButtonText; }
  .adg-card.sel .adg-name, .adg-btn[aria-pressed="true"], .adx-btn[aria-pressed="true"], .adg-co-btn[aria-pressed="true"] { outline: 2px solid Highlight; outline-offset: 1px; }
  .adg-edge-base { stroke: CanvasText; }
  .adg-edge-base.hot, .adg-edge-base.sel, .adg-edge-flow { stroke: Highlight; }
  .adg-zone { border-color: CanvasText; }
  .adg-frame[data-step]::after { border: 2px solid CanvasText; }
  .adg :focus-visible { outline: 3px solid Highlight; }
}
@media (prefers-reduced-motion: reduce) {
  .adg-plane, .adg-anchor, .adg-card { transition: none; }
  .adg-edge-flow, .adg-edge-flow.hot, .adg-edge-flow.sel { animation: none; }
}
`;

export const EXPLORER_CSS = `
.adx { color: var(--adg-text, #e9e6df); font-family: var(--adg-font-serif, Georgia, serif); }
.adx-btn { font-family: var(--adg-font-mono, monospace); font-size: 0.65rem; letter-spacing: 0.18em; text-transform: uppercase; padding: 0.7rem 1.2rem; min-height: 40px; border: 1px solid var(--adg-accent, #d4a24c); background: transparent; color: var(--adg-accent, #d4a24c); cursor: pointer; }
.adx-btn:hover, .adx-btn:focus-visible { background: var(--adg-accent, #d4a24c); color: var(--adg-on-accent, #0f1115); }
.adx-btn[disabled] { opacity: 0.4; cursor: default; }
.adx-btn[aria-pressed="true"] { background: var(--adg-accent, #d4a24c); color: var(--adg-on-accent, #0f1115); }
.adx-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.adx-trace { margin-top: 1.5rem; border-top: 1px solid var(--adg-border, #2a3142); padding-top: 1rem; }
.adx-trace h2 { font-family: var(--adg-font-mono, monospace); font-size: 0.63rem; letter-spacing: 0.3em; text-transform: uppercase; color: var(--adg-accent, #d4a24c); font-weight: 400; margin: 0; }
.adx-trace ol { margin: 0.8rem 0 0; padding: 0; list-style: none; display: grid; gap: 0.3rem; }
.adx-trace button { width: 100%; text-align: left; background: transparent; border: none; border-left: 2px solid var(--adg-border, #2a3142); padding: 0.45rem 0.9rem; color: var(--adg-text-dim, #a2a39d); cursor: pointer; font-size: 0.95rem; font-family: inherit; }
.adx-trace button:hover, .adx-trace button:focus-visible { color: var(--adg-text, #e9e6df); border-left-color: var(--adg-accent-dim, #7a6232); }
.adx-trace button[aria-current="step"] { color: var(--adg-text, #e9e6df); border-left-color: var(--adg-accent, #d4a24c); }
.adx-errors { border: 1px solid var(--adg-risk, #e0715f); padding: 1rem 1.2rem; background: var(--adg-bg2, #151922); }
.adx-errors h2 { margin: 0 0 0.5rem; font-size: 1.1rem; font-weight: 600; }
.adx-errors ul { margin: 0; padding-left: 1.2rem; font-family: var(--adg-font-mono, monospace); font-size: 0.8rem; line-height: 1.7; }
.adx-lint { margin-top: 0.8rem; font-family: var(--adg-font-mono, monospace); font-size: 0.7rem; color: var(--adg-text-dim, #a2a39d); }
.adx-lint summary { cursor: pointer; }
.adx-lint ul { margin: 0.5rem 0 0; padding-left: 1.2rem; line-height: 1.7; }
.adx :focus-visible { outline: 2px solid var(--adg-accent-hover, #f0c36a); outline-offset: 2px; }
`;
