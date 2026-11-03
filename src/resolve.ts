import type { DiagramLink, Interaction, Pattern } from "./schema.ts";

export type ResolvedLink = {
  pattern: Pattern;
  /** `undefined` for a dependency, which exchanges no runtime data. */
  interaction: Interaction | undefined;
  twoWay: boolean;
  offPath: boolean;
  protocol: string | undefined;
};

/** The one place link defaults live: request-response is sync, every other pattern is async, a dependency has no interaction. */
export function resolveLink(l: DiagramLink): ResolvedLink {
  const pattern = l.pattern ?? "request-response";
  const dependency = pattern === "dependency";
  return {
    pattern,
    interaction: dependency ? undefined : (l.interaction ?? (pattern === "request-response" ? "sync" : "async")),
    twoWay: !dependency && !!l.twoWay,
    offPath: !!l.offPath,
    protocol: l.protocol,
  };
}
