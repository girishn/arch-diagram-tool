// The parts that need no React: types, validation and lint, layout geometry, themes, text descriptions and metrics.
// Safe to import from a server component, a build script or a CLI (the main entry carries "use client").
export * from "./schema.ts";
export { validateSpec, lintSpec } from "./validate.ts";
export { RULES, isRuleId } from "./rules.ts";
export type { RuleId } from "./rules.ts";
export { formatText, toGithubAnnotations, toSarif, pointerOf } from "./lintFormat.ts";
export { LENS_PRESETS, RISKS_LENS, WELL_ARCHITECTED_LENSES, resolveLenses } from "./presets.ts";
export { resolveZones, zoneExtents } from "./zones.ts";
export type { ResolvedZone } from "./zones.ts";
export { resolveLink } from "./resolve.ts";
export type { ResolvedLink } from "./resolve.ts";
export { computeLayout, findRoute, linkGeometry, zoneRects } from "./layout.ts";
export type { ZoneRect } from "./layout.ts";
export { THEMES, DEFAULT_THEME, getTheme, themeStyle } from "./themes.ts";
export type { Theme } from "./themes.ts";
export { collapseLevels, collapseZones, collapsedId, withoutPeripherals } from "./view.ts";
export { connectionsOf, describeConnections, linkTraits, zonePath } from "./describe.ts";
export { measure } from "./measure.ts";
export { routeLinks } from "./route.ts";
export type { RouteInput } from "./route.ts";
export type { LayoutMetrics, LinkMetric } from "./measure.ts";
export { packFromSvgMap, packFromIconify, svgDataUri } from "./packs.ts";
export type { PackOptions, IconifyJson } from "./packs.ts";
export { verify, describeSpec, diffSpecs, applyPatch, linkKey } from "./verify.ts";
export type { VerifyIssue, VerifyReport, SpecDiff, PatchOp, PatchResult } from "./verify.ts";
export { generateFromPlan, generateFromPlans, stripPlan, checkSpec, canonical } from "./terraform.ts";
export type { Overlay, TfReport } from "./terraform.ts";
export { TF_MAPPING } from "./tfMapping.ts";
