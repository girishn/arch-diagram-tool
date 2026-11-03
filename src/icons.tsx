import type { ReactNode } from "react";
import type { ZoneKind } from "./schema.ts";

/**
 * An icon pack maps the opaque icon keys in a spec to something drawable.
 * Supply your own to use a vendor set; the generic pack below is the default and needs no files.
 */
export type IconDef = {
  /**
   * `service` icons fill their own rounded tile. `glyph` icons have no background, so the renderer
   * puts them on a light tile with padding.
   */
  tile: "service" | "glyph";
  /** URL of an image, e.g. `/icons/lambda.svg`. Takes precedence over `svg`. */
  src?: string;
  /** Contents of a 64x64 SVG viewBox. */
  svg?: ReactNode;
};

export type IconPack = {
  /** Shown in the diagram's legend (and under a static SVG) whenever one of this pack's icons is drawn. Use it for a vendor's trademark and "not affiliated" wording. */
  attribution?: string;
  /**
   * Draw this pack's icons exactly as supplied: no rounded corners, no dimming on peripheral cards, no light tile or padding behind a
   * glyph. Set it for any vendor set whose terms say the icons must not be altered.
   */
  unmodified?: boolean;
  /** Return `undefined` for an unknown key; the renderer then draws the generic "unknown" icon. */
  resolve: (key: string) => IconDef | undefined;
  /** Optional emblem drawn beside a zone's label. */
  zone?: (kind: ZoneKind, size: number) => ReactNode;
};

// ── Generic pack ─────────────────────────────────────────────────────────────

type Category = "client" | "compute" | "storage" | "data" | "network" | "external" | "tooling" | "security" | "ai" | "integration" | "observe" | "unknown";

const COLOR: Record<Category, string> = {
  client: "#5b6b7f",
  compute: "#cf7a22",
  storage: "#3f8f5a",
  data: "#3b6fd4",
  network: "#8a5ad6",
  external: "#4d7f9e",
  tooling: "#7f8f3f",
  security: "#c8483f",
  ai: "#1f9d9a",
  integration: "#c64f8b",
  observe: "#7d8591",
  unknown: "#6b7280",
};

const stroke = { fill: "none", stroke: "#fff", strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const GLYPHS: Record<string, { cat: Category; glyph: ReactNode }> = {
  client: {
    cat: "client",
    glyph: (
      <g {...stroke}>
        <rect x="13" y="16" width="38" height="25" rx="3" />
        <path d="M26 49h12M32 41v8" />
      </g>
    ),
  },
  user: {
    cat: "client",
    glyph: (
      <g {...stroke}>
        <circle cx="32" cy="23" r="8" />
        <path d="M15 50c0-12 34-12 34 0" />
      </g>
    ),
  },
  gateway: {
    cat: "network",
    glyph: (
      <g {...stroke}>
        <path d="M32 14v36M10 32h16M20 26l6 6-6 6M38 32h16M48 26l6 6-6 6" />
      </g>
    ),
  },
  loadbalancer: {
    cat: "network",
    glyph: (
      <g {...stroke}>
        <circle cx="32" cy="16" r="5" />
        <circle cx="14" cy="48" r="5" />
        <circle cx="32" cy="48" r="5" />
        <circle cx="50" cy="48" r="5" />
        <path d="M32 21v22M30 20L16 43M34 20l14 23" />
      </g>
    ),
  },
  cdn: {
    cat: "network",
    glyph: (
      <g {...stroke}>
        <circle cx="32" cy="32" r="17" />
        <ellipse cx="32" cy="32" rx="7" ry="17" />
        <path d="M15 32h34" />
      </g>
    ),
  },
  registry: {
    cat: "compute",
    glyph: (
      <g {...stroke} strokeWidth={2.5}>
        <rect x="15" y="26" width="10" height="9" />
        <rect x="26" y="26" width="10" height="9" />
        <rect x="37" y="26" width="10" height="9" />
        <rect x="26" y="16" width="10" height="9" />
        <rect x="15" y="36" width="10" height="9" />
        <rect x="26" y="36" width="10" height="9" />
        <path d="M11 50c6 5 30 5 42-6" />
      </g>
    ),
  },
  dns: {
    cat: "network",
    glyph: (
      <g {...stroke}>
        <path d="M32 12v40M32 18h14l5 5-5 5H32M32 33H18l-5 5 5 5h14" />
      </g>
    ),
  },
  iac: {
    cat: "tooling",
    glyph: (
      <g {...stroke}>
        <path d="M32 14l20 10-20 10-20-10zM12 33l20 10 20-10M12 42l20 10 20-10" />
      </g>
    ),
  },
  audit: {
    cat: "security",
    glyph: (
      <g {...stroke}>
        <path d="M20 12h18l8 8v32H20zM38 12v8h8M26 34l5 5 9-10" />
      </g>
    ),
  },
  pipeline: {
    cat: "tooling",
    glyph: (
      <g {...stroke}>
        <circle cx="13" cy="32" r="5" />
        <circle cx="32" cy="32" r="5" />
        <circle cx="51" cy="32" r="5" />
        <path d="M18 32h9M37 32h9M43 26l5 6-5 6" />
      </g>
    ),
  },
  repo: {
    cat: "tooling",
    glyph: (
      <g {...stroke}>
        <circle cx="22" cy="17" r="5" />
        <circle cx="22" cy="47" r="5" />
        <circle cx="43" cy="27" r="5" />
        <path d="M22 22v20M43 32c0 9-21 5-21 10" />
      </g>
    ),
  },
  dashboard: {
    cat: "observe",
    glyph: (
      <g {...stroke}>
        <rect x="11" y="14" width="42" height="36" rx="3" />
        <path d="M11 23h42M20 43v-8M30 43V29M40 43v-11" />
      </g>
    ),
  },
  alert: {
    cat: "observe",
    glyph: (
      <g {...stroke}>
        <path d="M18 41V30a14 14 0 0 1 28 0v11l4 4H14zM27 51a5 5 0 0 0 10 0" />
      </g>
    ),
  },
  logs: {
    cat: "observe",
    glyph: (
      <g {...stroke}>
        <path d="M14 18h6M25 18h25M14 28h6M25 28h25M14 38h6M25 38h17M14 48h6M25 48h21" />
      </g>
    ),
  },
  internet: {
    cat: "external",
    glyph: (
      <g {...stroke}>
        <circle cx="28" cy="37" r="14" />
        <ellipse cx="28" cy="37" rx="6" ry="14" />
        <path d="M14 37h28M41 25l11-11M43 14h9v9" />
      </g>
    ),
  },
  function: {
    cat: "compute",
    glyph: (
      <g {...stroke}>
        <path d="M22 14h7l13 36M32 34L19 50" />
      </g>
    ),
  },
  compute: {
    cat: "compute",
    glyph: (
      <g {...stroke}>
        <rect x="14" y="16" width="36" height="13" rx="3" />
        <rect x="14" y="35" width="36" height="13" rx="3" />
        <path d="M21 22.5h.01M21 41.5h.01" />
      </g>
    ),
  },
  container: {
    cat: "compute",
    glyph: (
      <g {...stroke}>
        <path d="M32 12l18 10v20L32 52 14 42V22zM32 32l18-10M32 32L14 22M32 32v20" />
      </g>
    ),
  },
  database: {
    cat: "data",
    glyph: (
      <g {...stroke}>
        <ellipse cx="32" cy="20" rx="16" ry="6" />
        <path d="M16 20v24c0 3.3 7.2 6 16 6s16-2.7 16-6V20M16 32c0 3.3 7.2 6 16 6s16-2.7 16-6" />
      </g>
    ),
  },
  cache: {
    cat: "data",
    glyph: (
      <g {...stroke}>
        <path d="M36 12L20 36h12l-4 16 16-24H32z" />
      </g>
    ),
  },
  search: {
    cat: "data",
    glyph: (
      <g {...stroke}>
        <circle cx="28" cy="28" r="12" />
        <path d="M37 37l11 11" />
      </g>
    ),
  },
  storage: {
    cat: "storage",
    glyph: (
      <g {...stroke}>
        <ellipse cx="32" cy="22" rx="16" ry="5" />
        <path d="M16 22l4 26h24l4-26" />
      </g>
    ),
  },
  backup: {
    cat: "storage",
    glyph: (
      <g {...stroke}>
        <path d="M44 25a14 14 0 1 0 2 9M44 15v10H34M32 24v9l6 3" />
      </g>
    ),
  },
  queue: {
    cat: "integration",
    glyph: (
      <g {...stroke}>
        <rect x="9" y="26" width="12" height="12" rx="2" />
        <rect x="26" y="26" width="12" height="12" rx="2" />
        <rect x="43" y="26" width="12" height="12" rx="2" />
      </g>
    ),
  },
  topic: {
    cat: "integration",
    glyph: (
      <g {...stroke}>
        <circle cx="32" cy="32" r="3" />
        <path d="M23 23a13 13 0 0 0 0 18M41 23a13 13 0 0 1 0 18M16 16a22 22 0 0 0 0 32M48 16a22 22 0 0 1 0 32" />
      </g>
    ),
  },
  stream: {
    cat: "integration",
    glyph: (
      <g {...stroke}>
        <path d="M10 22q11-10 22 0t22 0M10 34q11-10 22 0t22 0M10 46q11-10 22 0t22 0" />
      </g>
    ),
  },
  auth: {
    cat: "security",
    glyph: (
      <g {...stroke}>
        <path d="M32 12l16 6v14c0 10-8 16-16 20-8-4-16-10-16-20V18zM25 32l5 5 10-11" />
      </g>
    ),
  },
  secret: {
    cat: "security",
    glyph: (
      <g {...stroke}>
        <circle cx="23" cy="32" r="8" />
        <path d="M31 32h21M44 32v8M50 32v6" />
      </g>
    ),
  },
  config: {
    cat: "observe",
    glyph: (
      <g {...stroke}>
        <path d="M13 22h38M13 32h38M13 42h38" />
        <circle cx="24" cy="22" r="4" fill="#7d8591" />
        <circle cx="40" cy="32" r="4" fill="#7d8591" />
        <circle cx="28" cy="42" r="4" fill="#7d8591" />
      </g>
    ),
  },
  monitor: {
    cat: "observe",
    glyph: (
      <g {...stroke}>
        <path d="M12 50h40M16 40l10-10 8 6 14-16" />
      </g>
    ),
  },
  model: {
    cat: "ai",
    glyph: (
      <g {...stroke}>
        <path d="M32 12l5 15 15 5-15 5-5 15-5-15-15-5 15-5z" />
      </g>
    ),
  },
  unknown: {
    cat: "unknown",
    glyph: (
      <g {...stroke}>
        <path d="M24 25a8 8 0 1 1 11 7c-2 1-3 2-3 5" />
        <circle cx="32" cy="47" r="1.5" fill="#fff" />
      </g>
    ),
  },
};

/** Friendly names and common service names that map to a generic glyph. Matched case-insensitively. */
const ALIASES: Record<string, string> = {
  users: "user",
  docker: "registry",
  ecr: "registry",
  "container-registry": "registry",
  route53: "dns",
  terraform: "iac",
  cloudformation: "iac",
  pulumi: "iac",
  prometheus: "monitor",
  metrics: "monitor",
  tracing: "monitor",
  jaeger: "monitor",
  opentelemetry: "monitor",
  otel: "monitor",
  grafana: "dashboard",
  dashboards: "dashboard",
  alertmanager: "alert",
  alerts: "alert",
  pagerduty: "alert",
  loki: "logs",
  logging: "logs",
  elk: "logs",
  ci: "pipeline",
  cd: "pipeline",
  "ci-cd": "pipeline",
  jenkins: "pipeline",
  "github-actions": "pipeline",
  "gitlab-ci": "pipeline",
  argocd: "pipeline",
  codepipeline: "pipeline",
  git: "repo",
  github: "repo",
  gitlab: "repo",
  source: "repo",
  external: "internet",
  saas: "internet",
  "third-party": "internet",
  www: "internet",
  nat: "gateway",
  firewall: "auth",
  browser: "client",
  web: "client",
  api: "gateway",
  "api-gateway": "gateway",
  apigw: "gateway",
  lb: "loadbalancer",
  "load-balancer": "loadbalancer",
  edge: "cdn",
  cloudfront: "cdn",
  lambda: "function",
  fn: "function",
  server: "compute",
  vm: "compute",
  ec2: "compute",
  kubernetes: "container",
  k8s: "container",
  db: "database",
  sql: "database",
  table: "database",
  dynamodb: "database",
  redis: "cache",
  vector: "search",
  "s3-vectors": "search",
  s3: "storage",
  bucket: "storage",
  blob: "storage",
  sqs: "queue",
  mq: "queue",
  sns: "topic",
  events: "topic",
  eventbridge: "topic",
  kafka: "stream",
  kinesis: "stream",
  iam: "auth",
  identity: "auth",
  cognito: "auth",
  guardrails: "auth",
  security: "auth",
  kms: "secret",
  key: "secret",
  ssm: "secret",
  "parameter-store": "secret",
  settings: "config",
  cloudwatch: "monitor",
  cloudtrail: "audit",
  budgets: "monitor",
  observability: "monitor",
  llm: "model",
  bedrock: "model",
  ai: "model",
};

const cache = new Map<string, IconDef>();

function build(name: string): IconDef {
  const g = GLYPHS[name] ?? GLYPHS.unknown!;
  return {
    tile: "service",
    svg: (
      <>
        <rect width="64" height="64" rx="10" fill={COLOR[g.cat]} />
        {g.glyph}
      </>
    ),
  };
}

/** The default pack: category-coloured tiles with simple white glyphs, drawn inline. No files, no vendor marks. */
export const genericPack: IconPack = {
  resolve(key) {
    const name = GLYPHS[key.toLowerCase()] ? key.toLowerCase() : ALIASES[key.toLowerCase()];
    if (!name) return undefined;
    let def = cache.get(name);
    if (!def) cache.set(name, (def = build(name)));
    return def;
  },
};

/** Resolve a key against a pack, falling back to the generic pack and then the "unknown" glyph, so a bad key never crashes. */
export function resolveIcon(pack: IconPack, key: string): IconDef {
  return pack.resolve(key) ?? genericPack.resolve(key) ?? build("unknown");
}

/** Keys the generic pack knows, for docs and tests. */
export const GENERIC_ICON_KEYS: string[] = [...Object.keys(GLYPHS).filter((k) => k !== "unknown"), ...Object.keys(ALIASES)];
