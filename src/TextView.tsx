import type { DiagramNode, DiagramSpec, LensDef } from "./schema.ts";
import { connectionsOf, zonePath } from "./describe.ts";

const LEVEL_WORD = { good: "Good", info: "Note", warn: "Warning", risk: "Risk" } as const;
const scaleWords = (s: { min: number; max: number; unit?: string; trigger?: string }) =>
  `${s.min === s.max ? s.min : `${s.min} to ${s.max}`}${s.unit ? ` ${s.unit}` : ""}${s.trigger ? `, scaling on ${s.trigger}` : ""}`;

/**
 * The whole diagram as text: every component with its explanation, lens facts and connections, the zones, and the trace.
 * Built from the same spec as the picture, so it never drifts from it, and it is the way to read a diagram without seeing it.
 */
const hasMeta = (n: DiagramNode) => Boolean(n.tags?.length || (n.properties && Object.keys(n.properties).length) || n.references?.length || n.source);

/** The tags, properties, references and source of a component, as list items. */
function MetaItems({ n }: { n: DiagramNode }) {
  const props = Object.entries(n.properties ?? {});
  const src = n.source;
  return (
    <>
      {n.tags?.length ? <li>Tags: {n.tags.join(", ")}.</li> : null}
      {props.length ? <li>Properties: {props.map(([k, v]) => `${k} = ${String(v)}`).join("; ")}.</li> : null}
      {src ? (
        <li>
          Source: {[src.address, src.file && `${src.file}${src.line ? `:${src.line}` : ""}`].filter(Boolean).join(", ")}.
        </li>
      ) : null}
      {n.references?.length ? (
        <li>
          References:{" "}
          {n.references.map((r, i) => (
            <span key={`${r.url}-${i}`}>
              {i > 0 ? ", " : ""}
              <a href={r.url} rel="noopener noreferrer">
                {r.label}
              </a>
            </span>
          ))}
          .
        </li>
      ) : null}
    </>
  );
}

export function TextView({ spec, lenses }: { spec: DiagramSpec; lenses: Required<Pick<LensDef, "id" | "label">>[] }) {
  const label = (id: string) => spec.nodes.find((n) => n.id === id)?.label ?? id;
  return (
    <details className="adg-text">
      <summary>Diagram as text</summary>
      <div className="adg-text-body">
        <p>
          <strong>{spec.title}.</strong> {spec.description}
        </p>

        <h3>Components</h3>
        <ul>
          {spec.nodes.map((n) => {
            const zones = zonePath(spec, n.id);
            const { outgoing, incoming } = connectionsOf(spec, n.id);
            const facts = lenses.flatMap((l) => {
              const f = n.lenses?.[l.id];
              return f ? [`${l.label}, ${LEVEL_WORD[f.level ?? "info"]}: ${f.badge}${f.text ? `. ${f.text}` : ""}`] : [];
            });
            return (
              <li key={n.id}>
                <strong>{n.label}</strong>
                {n.sub ? `, ${n.sub}` : ""}
                {n.peripheral ? " (peripheral tooling)" : ""}.
                {zones.length ? ` In ${zones.join(", inside ")}.` : ""}
                {n.scale ? ` A fleet of ${scaleWords(n.scale)}.` : ""}
                {n.detail?.role ? ` ${n.detail.role}` : ""}
                {n.detail?.why ? ` Why: ${n.detail.why}` : ""}
                {n.detail?.tradeoff ? ` Trade-off: ${n.detail.tradeoff}` : ""}
                {(facts.length > 0 || outgoing.length > 0 || incoming.length > 0 || hasMeta(n)) && (
                  <ul>
                    <MetaItems n={n} />
                    {facts.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                    {outgoing.map((c) => (
                      <li key={`o-${c.link.from}-${c.link.to}-${c.link.label}`}>
                        Outgoing: {c.text}.{c.link.detail ? ` ${c.link.detail}` : ""}
                      </li>
                    ))}
                    {incoming.map((c) => (
                      <li key={`i-${c.link.from}-${c.link.to}-${c.link.label}`}>Incoming: {c.text}.</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>

        {(spec.zones?.length ?? 0) > 0 && (
          <>
            <h3>Zones</h3>
            <ul>
              {spec.zones!.map((z) => (
                <li key={z.id}>
                  <strong>{z.label}</strong> ({z.kind ?? "group"}){z.parent ? `, inside ${spec.zones!.find((q) => q.id === z.parent)?.label ?? z.parent}` : ""}
                  {z.members?.length ? `: ${z.members.map(label).join(", ")}` : ""}.
                </li>
              ))}
            </ul>
          </>
        )}

        {(spec.trace?.length ?? 0) > 0 && (
          <>
            <h3>Request trace</h3>
            <ol>
              {spec.trace!.map((t, i) => (
                <li key={`${t.node}-${i}`}>
                  {t.label} ({label(t.node)})
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </details>
  );
}
