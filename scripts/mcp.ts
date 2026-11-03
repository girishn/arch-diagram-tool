// A minimal MCP server over stdio (newline-delimited JSON-RPC 2.0), exposing the verifier tools. Run: `node scripts/mcp.ts`.
// Hand-written so the repo takes no SDK dependency; it implements only initialize, tools/list, tools/call and ping.
// It reads spec files named by the caller and never writes, never opens the network, and holds no keys.
import { createInterface } from "node:readline";
import { TOOLS } from "./verify-tools.ts";

const PROTOCOL = "2025-06-18";
const send = (m: unknown) => process.stdout.write(JSON.stringify(m) + "\n");
const fail = (id: unknown, code: number, message: string) => send({ jsonrpc: "2.0", id, error: { code, message } });

/** Handles one parsed message; returns nothing for notifications. Exported for tests. */
export function handle(msg: any): unknown | undefined {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return { jsonrpc: "2.0", id: msg?.id ?? null, error: { code: -32600, message: "invalid request" } };
  const { id, method, params } = msg;
  if (id === undefined) return undefined; // a notification such as notifications/initialized
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  if (method === "initialize") return ok({ protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "arch-diagram-verify", version: "0.0.0" } });
  if (method === "ping") return ok({});
  if (method === "tools/list") return ok({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  if (method === "tools/call") {
    const tool = TOOLS.find((t) => t.name === params?.name);
    if (!tool) return { jsonrpc: "2.0", id, error: { code: -32602, message: `unknown tool ${String(params?.name)}` } };
    try {
      const out = tool.run(params.arguments ?? {});
      return ok({ content: [{ type: "text", text: JSON.stringify(out, null, 2) }], structuredContent: out, isError: false });
    } catch (e) {
      return ok({ content: [{ type: "text", text: (e as Error).message }], isError: true });
    }
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } };
}

if (process.argv[1]?.endsWith("mcp.ts")) {
  createInterface({ input: process.stdin }).on("line", (line) => {
    if (!line.trim()) return;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return fail(null, -32700, "parse error");
    }
    const r = handle(msg);
    if (r !== undefined) send(r);
  });
}
