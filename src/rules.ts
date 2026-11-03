import type { Severity } from "./schema.ts";

/**
 * Every lint rule the validator can report, with a stable id. Ids never change meaning and are never reused; they are what `lintIgnore`,
 * the CLI and SARIF output refer to. Errors make a spec unsafe to render and cannot be suppressed; warnings flag gaps and can be.
 */
export const RULES = {
  // structure of the spec
  "spec-not-object": { severity: "error", summary: "The spec must be a JSON object." },
  "spec-version": { severity: "error", summary: "`version` must be 1." },
  "title-required": { severity: "error", summary: "The spec needs a title." },
  "nodes-required": { severity: "error", summary: "The spec needs at least one node." },
  "links-required": { severity: "error", summary: "The spec needs a `links` array (it may be empty)." },
  "unknown-field": { severity: "warning", summary: "A field this version does not know. It is ignored; prefix your own data with `x-`." },
  // optional data
  "meta-tags": { severity: "error", summary: "`tags` must be an array of non-empty strings." },
  "meta-properties": { severity: "error", summary: "`properties` must hold only strings, numbers and booleans." },
  "meta-references": { severity: "error", summary: "`references` must be an array." },
  "meta-reference-shape": { severity: "error", summary: "A reference needs a label and a url." },
  "meta-reference-url": { severity: "error", summary: "A reference url must be http(s), mailto, or a path on the same site." },
  "meta-source": { severity: "error", summary: "`source` must be { address?, file?, line? } with line a whole number from 1." },
  // lenses
  "lens-id-required": { severity: "error", summary: "A lens needs an id." },
  "lens-id-reserved": { severity: "error", summary: '"flow" is built in and cannot be declared.' },
  "lens-duplicate": { severity: "error", summary: "A lens id is declared twice." },
  "lens-label-required": { severity: "error", summary: "A lens needs a label unless its id is a preset." },
  "lens-undeclared": { severity: "error", summary: "A node or link carries facts for a lens that is not declared in `lenses`." },
  "level-invalid": { severity: "error", summary: "A lens fact level must be good, info, warn or risk." },
  // nodes
  "node-id-required": { severity: "error", summary: "A node needs an id." },
  "node-id-duplicate": { severity: "error", summary: "Two nodes share an id." },
  "node-label-required": { severity: "error", summary: "A node needs a label." },
  "node-position-required": { severity: "error", summary: "A node needs `at` with numeric col and row." },
  "node-cell-shared": { severity: "error", summary: "Two nodes sit in the same grid cell." },
  "node-icons-required": { severity: "error", summary: "A node needs at least one icon key." },
  "icons-grouped-unlabelled": { severity: "warning", summary: "A card with several icons should give each a label." },
  "scale-invalid": { severity: "error", summary: "`scale` needs numbers with 0 <= min <= max." },
  "node-no-explanation": { severity: "warning", summary: "A node has no `detail`, so the info strip has nothing to say about it." },
  "node-missing-role-why": { severity: "warning", summary: "A node's detail lacks a role or a why." },
  "node-orphan": { severity: "warning", summary: "A node has no links." },
  // links
  "link-id-invalid": { severity: "error", summary: "A link id must start with a letter and use letters, digits, _ . -." },
  "link-id-duplicate": { severity: "error", summary: "Two links share an id." },
  "link-unknown-node": { severity: "error", summary: "A link points at a node that does not exist." },
  "link-self": { severity: "error", summary: "A link joins a node to itself." },
  "link-label-required": { severity: "error", summary: "A link needs a label." },
  "link-via-invalid": { severity: "error", summary: "Waypoints must be [col, row] pairs." },
  "link-label-at-invalid": { severity: "error", summary: "`labelAt` must be a [col, row] pair." },
  "link-no-explanation": { severity: "warning", summary: "A link has no `detail`, so clicking its arrow explains nothing." },
  "pattern-invalid": { severity: "error", summary: "`pattern` is not one of the known patterns." },
  "interaction-invalid": { severity: "error", summary: "`interaction` must be sync or async." },
  "interaction-unusual": { severity: "warning", summary: "An event, message, stream or batch is explicitly marked sync." },
  "dependency-interaction-ignored": { severity: "warning", summary: "`interaction` and `twoWay` do not apply to a dependency." },
  "two-way-event": { severity: "warning", summary: "An event has no response, so `twoWay` is wrong." },
  "traffic-invalid": { severity: "error", summary: "`traffic` must be ingress, egress or internal." },
  "traffic-untagged": { severity: "warning", summary: "A link crosses a vpc or boundary edge without a `traffic` tag." },
  "traffic-mismatch": { severity: "warning", summary: "A link's `traffic` tag points the wrong way for the boundary it crosses." },
  // trace and prose
  "trace-unknown-node": { severity: "error", summary: "A trace step names a node that does not exist." },
  "trace-unreachable": { severity: "error", summary: "No path on the link graph between two consecutive trace steps." },
  "trace-unvisited-node": { severity: "warning", summary: "A non-peripheral node is never visited by the trace." },
  "mention-unknown-node": { severity: "error", summary: "A `mentions` entry names a node that does not exist." },
  "mention-not-linked": { severity: "warning", summary: "A node's text leans on a node it is not linked to." },
  "prose-invalid": { severity: "error", summary: "A prose block needs an id and text." },
  "prose-uncovered-node": { severity: "warning", summary: "Prose is given but no block mentions this node." },
  // zones
  "zone-invalid": { severity: "error", summary: "A zone needs an id and a label." },
  "zone-duplicate": { severity: "error", summary: "Two zones share an id." },
  "zone-kind-invalid": { severity: "error", summary: "A zone `kind` is not a known kind." },
  "zone-unknown-member": { severity: "error", summary: "A zone lists a member node that does not exist." },
  "zone-member-twice": { severity: "error", summary: "A node is a member of two zones." },
  "zone-bounds-invalid": { severity: "error", summary: "Zone `bounds` need c0<c1 and r0<r1." },
  "zone-own-parent": { severity: "error", summary: "A zone cannot be its own parent." },
  "zone-unknown-parent": { severity: "error", summary: "A zone's parent does not exist." },
  "zone-cycle": { severity: "error", summary: "Zone parents form a cycle." },
  "zone-empty": { severity: "error", summary: "A zone has no members, child zones or bounds." },
  "zone-overlaps-node": { severity: "warning", summary: "A node's card overlaps a zone it is not a member of." },
  "zone-overlaps-zone": { severity: "warning", summary: "Two zones overlap without being nested." },
  // layers and planes
  "layer-invalid": { severity: "error", summary: "A layer needs an id and a label." },
  "layer-duplicate": { severity: "error", summary: "Two layers share an id." },
  "layer-unknown": { severity: "error", summary: "A node names a layer that is not declared in `layers`." },
  "node-layer-missing": { severity: "warning", summary: "Layers are declared but this node is in none." },
  "layer-rows-overlap": { severity: "warning", summary: "Two layers use some of the same grid rows, so their bands overlap." },
  "layer-zone-mixed": { severity: "warning", summary: "A zone holds nodes from more than one layer, so it cannot sit on one floor." },
  "plane-invalid": { severity: "error", summary: "`plane` must be control or data." },
  // suppressions
  "lint-ignore-invalid": { severity: "error", summary: "A `lintIgnore` entry needs a rule and a reason." },
  "lint-ignore-unknown-rule": { severity: "warning", summary: "A `lintIgnore` entry names a rule that does not exist, or one that is an error and cannot be suppressed." },
  "lint-ignore-unused": { severity: "warning", summary: "A `lintIgnore` entry matched nothing, so it can be deleted." },
} as const satisfies Record<string, { severity: Severity; summary: string }>;

export type RuleId = keyof typeof RULES;
export const isRuleId = (id: string): id is RuleId => Object.prototype.hasOwnProperty.call(RULES, id);
