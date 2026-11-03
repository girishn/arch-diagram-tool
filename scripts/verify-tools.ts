// The tool set shared by the CLI (scripts/verify.ts) and the MCP server (scripts/mcp.ts): each tool takes plain JSON and returns plain JSON.
// A spec is passed inline (`spec`) or by file path (`path`, read only). Nothing here writes a file or calls the network.
import { readFileSync } from "node:fs";
import { applyPatch, describeSpec, diffSpecs, verify } from "../src/verify.ts";
import type { DiagramSpec } from "../src/schema.ts";

export type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>) => unknown;
};

const specProps = {
  spec: { type: "object", description: "The diagram spec as JSON." },
  path: { type: "string", description: "Path to a spec .json file, read only. Use this or spec." },
};

/** A thrown message is the tool's error text, so keep it plain. */
export function loadSpec(args: Record<string, unknown>, key = "spec", pathKey = "path"): unknown {
  if (args[key] !== undefined) return args[key];
  const p = args[pathKey];
  if (typeof p !== "string") throw new Error(`give ${key} (the JSON) or ${pathKey} (a file path)`);
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    throw new Error(`cannot read or parse ${p}: ${(e as Error).message}`);
  }
}

function validSpec(args: Record<string, unknown>, key?: string, pathKey?: string): DiagramSpec {
  const spec = loadSpec(args, key, pathKey);
  const r = verify(spec);
  if (!r.ok) throw new Error(`the spec has ${r.errors} error${r.errors === 1 ? "" : "s"}; run validate first. First: ${r.issues.find((i) => i.severity === "error")!.pointer || "/"} ${r.issues.find((i) => i.severity === "error")!.message}`);
  return spec as DiagramSpec;
}

export const TOOLS: Tool[] = [
  {
    name: "validate",
    description: "Validate and lint a diagram spec. Returns ok, counts, and every issue with a rule id, a JSON Pointer to the exact location, and a message. Fix errors; warnings are gaps in what the diagram explains.",
    inputSchema: { type: "object", properties: specProps },
    run: (a) => verify(loadSpec(a)),
  },
  {
    name: "describe",
    description: "A compact summary of a valid spec: title, counts, lens ids, zones with their nesting, each component with its connections in words, and the trace. Cheaper to read than the spec.",
    inputSchema: { type: "object", properties: specProps },
    run: (a) => describeSpec(validSpec(a)),
  },
  {
    name: "diff",
    description: "What changed between two valid specs, matched by id (links by their id, or from>to:label), never by array position. Lists added, removed and changed nodes, links and zones, plus whether the trace and other top-level fields changed.",
    inputSchema: {
      type: "object",
      properties: { before: { type: "object" }, before_path: { type: "string" }, after: { type: "object" }, after_path: { type: "string" } },
    },
    run: (a) => diffSpecs(validSpec(a, "before", "before_path"), validSpec(a, "after", "after_path")),
  },
  {
    name: "patch",
    description:
      "Apply JSON Patch operations (RFC 6902: add, replace, remove, test) to a spec and return the new spec with its validation report. The patch is refused, and nothing is returned changed, if an operation does not apply or if it would leave a new error. Nothing is written to disk; the caller saves the returned spec.",
    inputSchema: {
      type: "object",
      properties: {
        ...specProps,
        ops: {
          type: "array",
          description: 'Operations such as {"op":"replace","path":"/nodes/0/label","value":"API"}. Use "-" as the last array index to append.',
          items: { type: "object", properties: { op: { enum: ["add", "replace", "remove", "test"] }, path: { type: "string" }, value: {} }, required: ["op", "path"] },
        },
      },
      required: ["ops"],
    },
    run: (a) => applyPatch(loadSpec(a), a.ops as never),
  },
];
