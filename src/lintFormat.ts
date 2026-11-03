import { RULES } from "./rules.ts";
import type { Issue } from "./schema.ts";

type Suppressed = Issue & { reason: string };

/** `nodes[2].detail` and `nodes.api` as a JSON-Pointer-like location, `/nodes/2/detail` and `/nodes/api`. The id form is a logical location, not a literal pointer. */
export const pointerOf = (path: string) => (path ? "/" + path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean).join("/") : "");

/** One line per issue: `file: error rule-id at path: message`, then a count. */
export function formatText(file: string, issues: Issue[], suppressed: Suppressed[] = []): string {
  const lines = issues.map((i) => `${file}: ${i.severity} ${i.rule}${i.path ? ` at ${i.path}` : ""}: ${i.message}`);
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  lines.push(`${file}: ${errors} ${errors === 1 ? "error" : "errors"}, ${warnings} ${warnings === 1 ? "warning" : "warnings"}${suppressed.length ? `, ${suppressed.length} suppressed` : ""}`);
  return lines.join("\n");
}

const escapeData = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProp = (s: string) => escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");

/** GitHub Actions workflow commands, which show up as annotations on the run. */
export function toGithubAnnotations(file: string, issues: Issue[]): string {
  return issues
    .map((i) => `::${i.severity} file=${escapeProp(file)},title=${escapeProp(i.rule)}::${escapeData(`${i.path ? `${i.path}: ` : ""}${i.message}`)}`)
    .join("\n");
}

type SarifResult = {
  ruleId: string;
  level: "error" | "warning";
  message: { text: string };
  locations: { physicalLocation: { artifactLocation: { uri: string } }; logicalLocations: { fullyQualifiedName: string; kind: "member" }[] }[];
  suppressions?: { kind: "inSource"; justification: string }[];
};

/** SARIF 2.1.0, for code-scanning tools. Suppressed warnings are included with their justification, as the format intends. */
export function toSarif(results: { file: string; issues: Issue[]; suppressed?: Suppressed[] }[]) {
  const one = (file: string, i: Issue, reason?: string): SarifResult => ({
    ruleId: i.rule,
    level: i.severity,
    message: { text: i.message },
    locations: [{ physicalLocation: { artifactLocation: { uri: file.replaceAll("\\", "/") } }, logicalLocations: [{ fullyQualifiedName: pointerOf(i.path), kind: "member" }] }],
    ...(reason === undefined ? {} : { suppressions: [{ kind: "inSource" as const, justification: reason }] }),
  });
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "arch-diagram-tool",
            rules: Object.entries(RULES).map(([id, r]) => ({ id, shortDescription: { text: r.summary }, defaultConfiguration: { level: r.severity } })),
          },
        },
        results: results.flatMap((r) => [...r.issues.map((i) => one(r.file, i)), ...(r.suppressed ?? []).map((i) => one(r.file, i, i.reason))]),
      },
    ],
  };
}
