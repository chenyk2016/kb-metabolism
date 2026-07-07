/** 冒烟测试：以 MCP client 连自己的 server，走一遍 search→read→stats，验证日志落库 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { DB_PATH } from "./config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(here, "server.js")],
});
const client = new Client({ name: "smoke", version: "0.0.1" });
await client.connect(transport);

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));

const search = await client.callTool({
  name: "kb_search",
  arguments: { query: "browser-use", limit: 3 },
});
const searchText = (search.content as Array<{ type: string; text: string }>)[0].text;
console.log("--- kb_search(browser-use) ---\n" + searchText);

const firstPath = searchText.match(/^- (.+)$/m)?.[1];
if (firstPath) {
  const read = await client.callTool({ name: "kb_read", arguments: { path: firstPath } });
  const body = (read.content as Array<{ type: string; text: string }>)[0].text;
  console.log(`--- kb_read(${firstPath}) → ${body.length} 字符 ---`);
}

const stats = await client.callTool({ name: "kb_stats", arguments: {} });
console.log("--- kb_stats ---\n" + (stats.content as Array<{ type: string; text: string }>)[0].text);

await client.close();

const db = new Database(DB_PATH, { readonly: true });
const logs = db
  .prepare("SELECT tool, query, path FROM access_log ORDER BY id DESC LIMIT 5")
  .all();
console.log("--- access_log 最近 5 条 ---");
for (const l of logs as Array<{ tool: string; query: string | null; path: string | null }>) {
  console.log(`${l.tool} ${l.query ?? ""} ${l.path ?? ""}`);
}
db.close();
