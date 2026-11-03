import type { LensDef, DiagramSpec } from "./schema.ts";

/**
 * Ready-made lens definitions. List one in `spec.lenses` by id alone (`{ "id": "reliability" }`)
 * and its label and summary are filled in; set either field yourself to override.
 */
export const WELL_ARCHITECTED_LENSES: Required<LensDef>[] = [
  {
    id: "operational-excellence",
    label: "Operations",
    summary: "How the system is deployed, observed and changed safely: automation, monitoring, runbooks and learning from incidents.",
  },
  {
    id: "security",
    label: "Security",
    summary: "How data and access are protected: identity, encryption, network boundaries, detection and least privilege.",
  },
  {
    id: "reliability",
    label: "Reliability",
    summary: "How the system keeps working and recovers: failure isolation, redundancy, backups, and recovery time and point objectives.",
  },
  {
    id: "performance",
    label: "Performance",
    summary: "How resources are matched to the workload: latency, throughput, scaling behaviour and the choice of service.",
  },
  {
    id: "cost",
    label: "Cost",
    summary: "What drives spend and how it scales: pricing model, idle cost and the controls that cap it.",
  },
  {
    id: "sustainability",
    label: "Sustainability",
    summary: "How the workload limits its environmental footprint: right-sizing, managed and serverless services, and avoiding idle capacity.",
  },
];

/**
 * Captures the outputs of an architecture trade-off review (ATAM-style), not the review itself.
 * Convention: start the badge with the kind and map it to a level:
 * "Risk" -> risk, "Sensitivity point" and "Trade-off point" -> warn, "Non-risk" -> good.
 */
export const RISKS_LENS: Required<LensDef> = {
  id: "risks",
  label: "Risks & trade-offs",
  summary: "Where the design is exposed or has traded one quality for another: risks, sensitivity points, trade-off points and deliberate non-risks.",
};

/** Ingress and egress paths, ports, protocols, NAT and firewalls. Pairs with the `traffic` tag on links. */
export const NETWORK_LENS: Required<LensDef> = {
  id: "network",
  label: "Network",
  summary: "How traffic enters, moves through and leaves the system: ingress and egress paths, ports, protocols, NAT and firewalls.",
};

/** Control plane (configures and governs) against data plane (does the work). Needs no facts: it reads each node's and link's `plane`. */
export const PLANES_LENS: Required<LensDef> = {
  id: "planes",
  label: "Planes",
  summary: "Which components and flows configure the system (the control plane) and which carry its work (the data plane). A component that is neither is left unmarked.",
};

export const LENS_PRESETS: Record<string, Required<LensDef>> = Object.fromEntries(
  [...WELL_ARCHITECTED_LENSES, RISKS_LENS, NETWORK_LENS, PLANES_LENS].map((l) => [l.id, l]),
);

/** The spec's lenses with preset labels and summaries filled in. */
export function resolveLenses(spec: Pick<DiagramSpec, "lenses">): Required<LensDef>[] {
  return (spec.lenses ?? []).map((l) => {
    const preset = LENS_PRESETS[l.id];
    return { id: l.id, label: l.label ?? preset?.label ?? l.id, summary: l.summary ?? preset?.summary ?? "" };
  });
}
