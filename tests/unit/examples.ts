import { readFileSync, readdirSync } from "node:fs";
import type { DiagramSpec } from "../../src/index.ts";

const dir = new URL("../../examples/", import.meta.url);

/** Every spec in examples/, as parsed JSON. These double as the golden fixtures: they must keep validating. */
export const EXAMPLES: { file: string; spec: DiagramSpec }[] = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((file) => ({ file: file.replace(/\.json$/, ""), spec: JSON.parse(readFileSync(new URL(file, dir), "utf8")) as DiagramSpec }));
