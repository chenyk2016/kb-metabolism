/** MCP smoke test: connect a client to `kb serve`, run search→read→stats, verify signals. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const vaultRoot = process.env.KB_SMOKE_VAULT;
if (!vaultRoot) {
  console.error("set KB_SMOKE_VAULT to a vault root (a dir with .kb/config.json)");
  process.exit(1);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const logFile = path.join(vaultRoot, ".kb", "access.log.jsonl");
const linesBefore = fs.existsSync(logFile)
  ? fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).length
  : 0;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(here, "cli.js"), "serve", "--vault", vaultRoot],
});
const client = new Client({ name: "smoke", version: "0.0.1" });
await client.connect(transport);

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));

const query = process.env.KB_SMOKE_QUERY ?? "test";
const search = await client.callTool({ name: "kb_search", arguments: { query, limit: 3 } });
const searchText = (search.content as Array<{ type: string; text: string }>)[0].text;
console.log(`--- kb_search(${query}) ---\n${searchText}`);

const firstPath = searchText.match(/^- (.+)$/m)?.[1];
if (firstPath) {
  const read = await client.callTool({ name: "kb_read", arguments: { path: firstPath } });
  const body = (read.content as Array<{ type: string; text: string }>)[0].text;
  console.log(`--- kb_read(${firstPath}) → ${body.length} chars ---`);
}

const stats = await client.callTool({ name: "kb_stats", arguments: {} });
console.log("--- kb_stats ---\n" + (stats.content as Array<{ type: string; text: string }>)[0].text);

await client.close();

const linesAfter = fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).length;
console.log(`--- signals: ${linesBefore} → ${linesAfter} ---`);
if (linesAfter <= linesBefore) {
  console.error("FAIL: no signals were logged");
  process.exit(1);
}
console.log("smoke OK");
