import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { openDb } from "../core/db.js";
import { searchNotes, noResultHint } from "../core/search.js";
import { appendSignal } from "../core/signals.js";
import { getStats, formatStats } from "../core/stats.js";
import type { Vault } from "../core/types.js";

/** The retrieval gate: every call leaves a metabolic signal in the log. */
export function buildServer(vault: Vault): McpServer {
  const server = new McpServer({ name: "kb-metabolism", version: "0.2.0" });
  const isManaged = picomatch(vault.config.managed, { ignore: vault.config.exclude });

  server.registerTool(
    "kb_search",
    {
      description:
        "检索知识库。这是唯一的检索门——每次查询都会记入访问日志（让笔记续命的使用信号）。多个关键词用空格分开（AND 语义）。返回路径、标题和摘要片段。",
      inputSchema: {
        query: z.string().describe("检索词，中英文均可；多个关键词用空格分开（AND）"),
        limit: z.number().optional().describe("最多返回条数，默认 8"),
      },
    },
    async ({ query, limit }) => {
      const db = openDb(vault.root);
      const hits = searchNotes(db, query, limit ?? 8);
      db.close();
      appendSignal(vault.root, { tool: "kb_search", query });
      const text =
        hits.length === 0
          ? `无结果：${query}\n${noResultHint(query)}`
          : hits.map((h) => `- ${h.path}\n  标题: ${h.title}\n  片段: ${h.snip}`).join("\n");
      return { content: [{ type: "text", text }] };
    }
  );

  server.registerTool(
    "kb_read",
    {
      description:
        "读取笔记全文（路径来自 kb_search，相对 vault 根目录）。读取是笔记'仍被使用'的核心证据——法医会赦免近期被读过的笔记。",
      inputSchema: {
        path: z.string().describe("笔记路径，相对 vault 根目录"),
      },
    },
    async ({ path: rel }) => {
      const abs = path.resolve(vault.root, rel);
      const relNorm = path.relative(vault.root, abs);
      if (relNorm.startsWith("..") || !isManaged(relNorm)) {
        return {
          content: [{ type: "text", text: `拒绝：${rel} 不在管理范围内` }],
          isError: true,
        };
      }
      if (!fs.existsSync(abs)) {
        return { content: [{ type: "text", text: `不存在：${rel}` }], isError: true };
      }
      appendSignal(vault.root, { tool: "kb_read", path: relNorm });
      return { content: [{ type: "text", text: fs.readFileSync(abs, "utf8") }] };
    }
  );

  server.registerTool(
    "kb_stats",
    {
      description:
        "知识库健康度：层级分布、L0 容量、未分诊数、孤儿笔记、近期走门流量。",
      inputSchema: {},
    },
    async () => {
      return { content: [{ type: "text", text: formatStats(getStats(vault)) }] };
    }
  );

  return server;
}

export async function serve(vault: Vault): Promise<void> {
  const server = buildServer(vault);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
