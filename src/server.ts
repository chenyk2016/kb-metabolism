import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { openDb, logAccess } from "./db.js";
import { searchNotes } from "./search.js";
import { VAULT_ROOT, MANAGED_DIR, L0_CAP } from "./config.js";

const db = openDb();

const server = new McpServer({ name: "kb-metabolism", version: "0.1.0" });

server.registerTool(
  "kb_search",
  {
    description:
      "检索个人知识库（00-my-inbox）。这是知识库的唯一检索入口，自动记录访问日志（代谢信号）。返回匹配笔记的路径、标题和摘要片段。",
    inputSchema: {
      query: z.string().describe("检索词，中英文均可"),
      limit: z.number().optional().describe("最多返回条数，默认 8"),
    },
  },
  async ({ query, limit }) => {
    const hits = searchNotes(db, query, limit ?? 8);
    logAccess(db, "kb_search", { query });
    const text =
      hits.length === 0
        ? `无结果：${query}`
        : hits
            .map((h) => `- ${h.path}\n  标题: ${h.title}\n  片段: ${h.snip}`)
            .join("\n");
    return { content: [{ type: "text", text }] };
  }
);

server.registerTool(
  "kb_read",
  {
    description:
      "读取知识库笔记全文（路径来自 kb_search 结果，相对 vault 根目录）。读取会记入访问日志——这是笔记'仍被使用'的核心证据，法医据此判定衰减。",
    inputSchema: {
      path: z.string().describe("笔记路径，如 00-my-inbox/博客/xxx.md"),
    },
  },
  async ({ path: rel }) => {
    const abs = path.resolve(VAULT_ROOT, rel);
    if (!abs.startsWith(MANAGED_DIR + path.sep) && abs !== MANAGED_DIR) {
      return {
        content: [{ type: "text", text: `拒绝：${rel} 不在管理范围（00-my-inbox）内` }],
        isError: true,
      };
    }
    if (!fs.existsSync(abs)) {
      return { content: [{ type: "text", text: `不存在：${rel}` }], isError: true };
    }
    logAccess(db, "kb_read", { path: path.relative(VAULT_ROOT, abs) });
    return { content: [{ type: "text", text: fs.readFileSync(abs, "utf8") }] };
  }
);

server.registerTool(
  "kb_stats",
  {
    description:
      "知识库健康度：层级分布、L0 容量、未分诊数、孤儿笔记数、近期访问量。",
    inputSchema: {},
  },
  async () => {
    const tiers = db
      .prepare("SELECT COALESCE(tier, '未分诊') AS t, COUNT(*) AS c FROM notes GROUP BY t")
      .all() as Array<{ t: string; c: number }>;
    const total = tiers.reduce((s, r) => s + r.c, 0);
    const l0 = tiers.find((r) => r.t === "L0")?.c ?? 0;
    const orphans = (
      db
        .prepare(
          "SELECT COUNT(*) AS c FROM notes WHERE path NOT IN (SELECT DISTINCT dst FROM links)"
        )
        .get() as { c: number }
    ).c;
    const reads7 = (
      db
        .prepare(
          "SELECT COUNT(*) AS c FROM access_log WHERE tool='kb_read' AND ts >= datetime('now','localtime','-7 days')"
        )
        .get() as { c: number }
    ).c;
    const lines = [
      `总计 ${total} 条（管理范围 00-my-inbox）`,
      ...tiers.map((r) => `- ${r.t}: ${r.c}`),
      `L0 容量: ${l0}/${L0_CAP}`,
      `孤儿笔记（0 反链）: ${orphans}`,
      `近 7 天读取: ${reads7} 次`,
    ];
    if (total === 0) lines.push("索引为空——先运行 npm run index");
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
