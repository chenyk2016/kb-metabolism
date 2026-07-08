import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { openDb } from "../core/db.js";
import { hybridSearch, similarNotes, noResultHint } from "../core/search.js";
import { appendSignal } from "../core/signals.js";
import { getStats, formatStats } from "../core/stats.js";
import { addNote } from "../core/capture.js";
import { runIndex } from "../core/indexer.js";
import type { Vault } from "../core/types.js";

/** 门规：随 MCP initialize 注入接入方 agent 的上下文——规则跟着门走，不依赖客户端配置 */
const GATE_INSTRUCTIONS = `这是个人知识库的代谢检索门。使用规则：
1. 查个人积累的知识（账号、流程、踩坑记录、项目背景）先 kb_search 再回答，读笔记用 kb_read——读取是笔记的续命信号，不要绕过门直接读库内文件。
2. 存知识用 kb_add。返回"疑似同主题"时，先 kb_read 候选：同主题就直接编辑该文件补充（一个主题一篇笔记，宁可长文不要碎片），确认新主题才带 force 重试。
3. 编辑已有笔记直接改文件即可，改完可跑 \`kb index\` 刷新索引。
4. 永远不要替用户勾选处决名单、删除或移动笔记——AI 只提案，人是法官。`;

/** The retrieval gate: every call leaves a metabolic signal in the log. */
export function buildServer(vault: Vault): McpServer {
  const server = new McpServer(
    { name: "kb-metabolism", version: "0.2.0" },
    { instructions: GATE_INSTRUCTIONS }
  );
  const isManaged = picomatch(vault.config.managed, { ignore: vault.config.exclude });

  server.registerTool(
    "kb_search",
    {
      description:
        "检索知识库。这是唯一的检索门——每次查询都会记入访问日志（让笔记续命的使用信号）。直接用自然语言查询：整串精确命中优先，无果时自动分词按相关度排序。返回路径、标题和摘要片段。",
      inputSchema: {
        query: z.string().describe("自然语言检索词，中英文均可"),
        limit: z.number().optional().describe("最多返回条数，默认 8"),
      },
    },
    async ({ query, limit }) => {
      const db = openDb(vault.root);
      const hits = await hybridSearch(vault, db, query, limit ?? 8);
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
    "kb_add",
    {
      description:
        "捕捉新笔记进知识库。两道税由系统强制执行：入口税——不给 use_when（什么时候会再用到）只能进 inbox 层并在 30 天后过期；查重税——发现疑似同主题的已有笔记时不会写入，而是返回候选，请先 kb_read 查看并优先编辑该文件补充（一个主题一篇笔记），确认是新主题再带 force=true 重新调用。编辑已有笔记直接改文件，删除永远走处决名单由人审批。",
      inputSchema: {
        title: z.string().describe("笔记标题"),
        content: z.string().optional().describe("笔记正文（Markdown）"),
        tier: z
          .enum(["L0", "L1", "inbox"])
          .optional()
          .describe("层级；L0/L1 必须同时提供 use_when，否则会被拒绝"),
        use_when: z.string().optional().describe("一句话：什么时候会再用到"),
        dir: z.string().optional().describe("写入的子目录，默认为配置的 captureDir"),
        force: z
          .boolean()
          .optional()
          .describe("跳过查重强制新增（仅在确认与已有笔记不是同一主题后使用）"),
      },
    },
    async ({ title, content, tier, use_when, dir, force }) => {
      try {
        if (!force) {
          const db = openDb(vault.root);
          const probe = `${title} ${(content ?? "").slice(0, 100)}`;
          const similar = similarNotes(db, probe, 3, 0.5);
          db.close();
          if (similar.length > 0) {
            const list = similar
              .map(
                (s) =>
                  `- ${s.path}（${s.title}，相似度 ${(s.coverage * 100).toFixed(0)}%）\n  ${s.snip}`
              )
              .join("\n");
            return {
              content: [
                {
                  type: "text",
                  text: `未写入——发现 ${similar.length} 篇疑似同主题的已有笔记：\n${list}\n\n请先 kb_read 查看：属于同一主题就直接编辑该文件补充（一个主题一篇笔记）；确认是新主题，再带 force=true 重新调用。`,
                },
              ],
            };
          }
        }
        const rel = addNote(vault, {
          title,
          content: content ?? "",
          tier,
          useWhen: use_when,
          dir,
        });
        await runIndex(vault);
        const note = use_when
          ? `已入 ${tier ?? "L1"} 层`
          : `未提供 use_when，已按入口税进 inbox 层（30 天后过期，除非升级）`;
        return { content: [{ type: "text", text: `已添加：${rel}\n${note}` }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        };
      }
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
