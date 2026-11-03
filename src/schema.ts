/**
 * Diagram spec v1 (DRAFT, awaiting confirmation).
 *
 * The diagram is a pure function of a `DiagramSpec`. Nothing here names a
 * vendor: icons are opaque keys resolved by an icon pack at render time.
 */

/** Grid position. One unit = one cell; landscape flows left to right. */
export type Cell = { col: number; row: number };

/** `[col, row]` pair, used for waypoints and label anchors (fractions allowed). */
export type Point = [number, number];

/** An icon key resolved by the active icon pack, with an optional caption for grouped cards. */
export type IconRef = string | { icon: string; label: string };

/** How a lens fact should be emphasised. The renderer pairs colour with an icon or text, never colour alone. */
export const LEVELS = ["good", "info", "warn", "risk"] as const;
export type Level = (typeof LEVELS)[number];

/** Per-lens content for one node or link. */
export type LensFact = {
  /** Emphasis for the badge. Defaults to `info`. */
  level?: Level;
  /** Short badge shown on the card while the lens is active. */
  badge: string;
  /** Longer text shown in the info strip while the node is hovered or selected. */
  text?: string;
};

/** Long-form explanation shown in the info strip. All parts optional. */
/** A link to something outside the diagram: a runbook, an ADR, a dashboard, the code. */
export type Reference = { label: string; url: string };

/** Where an element came from in the system it describes, so a generator can point back at it. */
export type SourceRef = {
  /** A resource address, e.g. a Terraform `aws_lambda_function.api`. */
  address?: string;
  file?: string;
  line?: number;
};

/**
 * Optional data a generator or an author can attach to a node, link or zone. None of it changes the picture; it appears in the text view.
 * Anything that is not listed here and does not start with `x-` is reported as an unknown field.
 */
export type Meta = {
  tags?: string[];
  properties?: Record<string, string | number | boolean>;
  references?: Reference[];
  source?: SourceRef;
  /** Your own data. Kept, never interpreted, never warned about. */
  [custom: `x-${string}`]: unknown;
};

export type NodeDetail = {
  /** Short descriptor under the name, e.g. "Python 3.12". */
  tag?: string;
  role?: string;
  why?: string;
  tradeoff?: string;
  /** Ids of other nodes this text talks about. Checked against the link graph. */
  mentions?: string[];
};

export type Scale = {
  min: number;
  max: number;
  /** What is counted, e.g. "instances", "tasks", "replicas". */
  unit?: string;
  /** What drives scaling, e.g. "CPU > 60%". */
  trigger?: string;
};

/** Control plane: configuration, policy and management. Data plane: the work the system does for its users. */
export const PLANES = ["control", "data"] as const;
export type Plane = (typeof PLANES)[number];

/** A tier of the system (golden path, control plane, runtime, tenants). Listed top to bottom; a node belongs to one. */
export type Layer = {
  id: string;
  label: string;
  /** What this layer is, shown when its band or floor is pointed at. */
  summary?: string;
};

export type DiagramNode = Meta & {
  id: string;
  label: string;
  /** Second line on the card. */
  sub?: string;
  at: Cell;
  /** One icon, or several for a grouped card (give each a caption). */
  icons: IconRef[];
  /**
   * Tooling around the system rather than part of it: CI/CD, observability, alerting. It is drawn lighter with a dashed
   * outline, can be hidden with the "Tooling" toggle, and is exempt from the "never visited by the trace" lint.
   */
  /** The id of the layer this node sits in (see `layers` on the spec). */
  layer?: string;
  /** Whether this component configures the system (control) or does its work (data). Shown by the Planes lens. */
  plane?: Plane;
  peripheral?: boolean;
  /** The card stands for a fleet (auto scaling group, tasks, replicas, concurrency); it is drawn stacked with a count badge. */
  scale?: Scale;
  detail?: NodeDetail;
  /** Keyed by lens id. */
  lenses?: Record<string, LensFact>;
};

/** Whether the caller waits for the other side. */
export const INTERACTIONS = ["sync", "async"] as const;
export type Interaction = (typeof INTERACTIONS)[number];

/**
 * The shape of the exchange on a link.
 * - request-response: HTTP, gRPC unary, SQL, DB reads and writes, polling
 * - event: a fact is announced to whoever cares (webhooks, pub/sub, cron triggers)
 * - message: a command or work item handed to one consumer (queues)
 * - stream: continuous flow (Kafka, Kinesis, websockets, SSE, replication)
 * - batch: bulk or scheduled transfer (ETL, backups, file drops)
 * - dependency: a relationship with no runtime data exchange (IAM trust, deploy, config, monitoring)
 */
export const PATTERNS = ["request-response", "event", "message", "stream", "batch", "dependency"] as const;
export type Pattern = (typeof PATTERNS)[number];

/** Which way a link crosses the edge of the system or of a `vpc`/`boundary` zone. `internal` stays inside. */
export const TRAFFIC = ["ingress", "egress", "internal"] as const;
export type Traffic = (typeof TRAFFIC)[number];

export type DiagramLink = Meta & {
  /** Optional stable id, unique among links, for tools that refer to a link across edits. */
  id?: string;
  /** Whether this flow configures the system (control: policy, provisioning, config) or carries its work (data). Shown by the Planes lens. */
  plane?: Plane;
  from: string;
  to: string;
  label: string;
  /** Shown when the arrow is clicked. */
  detail?: string;
  /** Ids of nodes the detail text talks about besides the two endpoints. */
  mentions?: string[];
  /** Orthogonal waypoints between the endpoints. */
  via?: Point[];
  /** Not on the main request path (audit, backup, monitoring). */
  offPath?: boolean;
  /** Defaults to `request-response`. */
  pattern?: Pattern;
  /** Defaults to `sync` for request-response and `async` for every other pattern. Ignored for `dependency`. */
  interaction?: Interaction;
  /**
   * `ingress` enters, `egress` leaves. Shown as an IN / OUT tag on the arrow and in the legend.
   * A link that crosses a `vpc` or `boundary` zone edge should be tagged; the validator warns when it is not.
   */
  traffic?: Traffic;
  /** Free text shown in the info strip, e.g. "HTTPS", "gRPC", "SQS", "Kafka". */
  protocol?: string;
  /** The response returns on the same cable, so both ends get an arrowhead. */
  twoWay?: boolean;
  /** Keyed by lens id. `badge` replaces the label chip while the lens is active. */
  lenses?: Record<string, LensFact>;
  /** Where the label chip sits; defaults to the middle of the cable. */
  labelAt?: Point;
};

/**
 * What a zone represents; the renderer picks its look from this. `group` is the neutral fallback.
 * `cloud` is a provider or cloud boundary, `boundary` a trust boundary, `tooling` a group of peripherals (CI/CD, observability).
 */
export const ZONE_KINDS = [
  "cloud",
  "account",
  "region",
  "az",
  "vpc",
  "subnet",
  "cluster",
  "scaling-group",
  "boundary",
  "tooling",
  "group",
] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

/** Bounds in grid units, inclusive. */
export type Bounds = { c0: number; r0: number; c1: number; r1: number };

export type DiagramZone = Meta & {
  id: string;
  label: string;
  /** Defaults to `group`. */
  kind?: ZoneKind;
  /** Nodes directly inside this zone (not those inside child zones). A node belongs to one zone only. */
  members?: string[];
  /** The enclosing zone. A parent grows to contain its children. */
  parent?: string;
  /** Overrides the bounds that would be computed from members and child zones. */
  bounds?: Bounds;
};

export type TraceStep = {
  node: string;
  label: string;
};

export type LensDef = {
  id: string;
  /** Required unless `id` is a preset (see `LENS_PRESETS`), in which case it defaults to the preset's label. */
  label?: string;
  /** Overview shown in the info strip while this lens is active and nothing is hovered or selected. */
  summary?: string;
};

/** Long-form text that accompanies the diagram (e.g. a page section). Every component it describes must be tagged. */
export type ProseBlock = {
  id: string;
  text: string;
  mentions: string[];
};

/** Silences one warning on purpose. The reason is required so that a suppression is a decision someone can read later, not a way to make a warning go away. */
export type LintIgnore = {
  rule: string;
  /** Only this location, as the issue reports it (e.g. `nodes.registry`). Without it the rule is silenced everywhere. */
  path?: string;
  reason: string;
};

export type DiagramSpec = {
  [custom: `x-${string}`]: unknown;
  /** Where the JSON Schema for this spec lives; editors use it, the renderer ignores it. */
  $schema?: string;
  version: 1;
  title: string;
  description?: string;
  nodes: DiagramNode[];
  links: DiagramLink[];
  /** Tiers from top to bottom. Nodes name theirs with `layer`. Drawn as bands in the flat view, and as stacked floors in the isometric one. */
  layers?: Layer[];
  zones?: DiagramZone[];
  /** Ordered request walk-through. The route between steps is found on the link graph. */
  trace?: TraceStep[];
  /** Long-form descriptions; drives the "every described component has a node" lint. */
  prose?: ProseBlock[];
  /** Extra lenses beyond the built-in Flow view. Defaults to none. */
  lenses?: LensDef[];
  /** Warnings the author has decided to accept, each with a reason. Errors cannot be silenced. */
  lintIgnore?: LintIgnore[];
};

export type Severity = "error" | "warning";

export type Issue = {
  severity: Severity;
  /** Stable id of the lint rule that reported this (see `RULES`). */
  rule: string;
  /** JSON-path-like location, e.g. `links[3].to`. */
  path: string;
  message: string;
};
