import type { DiagramLink, DiagramNode, DiagramSpec } from "./schema.ts";
import { resolveLink } from "./resolve.ts";

/** Plain-language descriptions of a spec: the words behind the text view and each card's spoken connections. Pure, no DOM. */

const byId = (spec: Pick<DiagramSpec, "nodes">) => new Map(spec.nodes.map((n) => [n.id, n]));

/** What is worth saying about a link beyond its label: protocol, pattern, async, reply, direction across a boundary. */
export function linkTraits(l: DiagramLink): string[] {
  const r = resolveLink(l);
  return [
    r.protocol,
    r.pattern === "request-response" ? undefined : r.pattern === "dependency" ? "dependency, no data flows" : r.pattern,
    r.interaction === "async" ? "asynchronous" : undefined,
    r.twoWay ? "the reply returns on the same path" : undefined,
    l.traffic && l.traffic !== "internal" ? l.traffic : undefined,
    r.offPath ? "off the request path" : undefined,
  ].filter((t): t is string => !!t);
}

const withTraits = (text: string, l: DiagramLink) => {
  const traits = linkTraits(l);
  return traits.length ? `${text} (${traits.join(", ")})` : text;
};

export type Connections = {
  /** Links this node starts: "Invoke to Function (sync)". */
  outgoing: { link: DiagramLink; other: DiagramNode; text: string }[];
  /** Links that end here: "POST /items from Browser". */
  incoming: { link: DiagramLink; other: DiagramNode; text: string }[];
};

/** Every link a node starts or receives, each already worded. Links to unknown nodes are skipped. */
export function connectionsOf(spec: Pick<DiagramSpec, "nodes" | "links">, id: string): Connections {
  const nodes = byId(spec);
  const out: Connections = { outgoing: [], incoming: [] };
  for (const link of spec.links) {
    if (link.from === id && nodes.has(link.to)) out.outgoing.push({ link, other: nodes.get(link.to)!, text: withTraits(`${link.label} to ${nodes.get(link.to)!.label}`, link) });
    if (link.to === id && nodes.has(link.from)) out.incoming.push({ link, other: nodes.get(link.from)!, text: withTraits(`${link.label} from ${nodes.get(link.from)!.label}`, link) });
  }
  return out;
}

/** One sentence for a screen reader: what this component sends and receives. Used as each card's description. */
export function describeConnections(spec: Pick<DiagramSpec, "nodes" | "links">, id: string): string {
  const { outgoing, incoming } = connectionsOf(spec, id);
  const parts = [
    outgoing.length ? `Outgoing: ${outgoing.map((c) => c.text).join("; ")}.` : "",
    incoming.length ? `Incoming: ${incoming.map((c) => c.text).join("; ")}.` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : "No connections.";
}

/** The zones a node sits in, outermost first: ["Cloud", "VPC", "Private subnet"]. */
export function zonePath(spec: Pick<DiagramSpec, "zones">, id: string): string[] {
  const zones = spec.zones ?? [];
  const owner = zones.find((z) => z.members?.includes(id));
  const path: string[] = [];
  const seen = new Set<string>();
  for (let z = owner; z && !seen.has(z.id); z = z.parent ? zones.find((q) => q.id === z!.parent) : undefined) {
    seen.add(z.id);
    path.unshift(z.label);
  }
  return path;
}
