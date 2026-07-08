import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { openDb } from "../core/db.js";
import { searchNotes } from "../core/search.js";
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
        "Search the knowledge vault. This is the single retrieval gate — every query is logged as a usage signal that keeps notes alive. Returns paths, titles, and snippets.",
      inputSchema: {
        query: z.string().describe("search terms, any language"),
        limit: z.number().optional().describe("max results, default 8"),
      },
    },
    async ({ query, limit }) => {
      const db = openDb(vault.root);
      const hits = searchNotes(db, query, limit ?? 8);
      db.close();
      appendSignal(vault.root, { tool: "kb_search", query });
      const text =
        hits.length === 0
          ? `no results for: ${query}`
          : hits.map((h) => `- ${h.path}\n  title: ${h.title}\n  snippet: ${h.snip}`).join("\n");
      return { content: [{ type: "text", text }] };
    }
  );

  server.registerTool(
    "kb_read",
    {
      description:
        "Read a note's full content (path from kb_search, relative to the vault root). Reads are the core evidence that a note is still alive — the coroner spares notes with recent reads.",
      inputSchema: {
        path: z.string().describe("note path relative to the vault root"),
      },
    },
    async ({ path: rel }) => {
      const abs = path.resolve(vault.root, rel);
      const relNorm = path.relative(vault.root, abs);
      if (relNorm.startsWith("..") || !isManaged(relNorm)) {
        return {
          content: [{ type: "text", text: `refused: ${rel} is outside the managed scope` }],
          isError: true,
        };
      }
      if (!fs.existsSync(abs)) {
        return { content: [{ type: "text", text: `not found: ${rel}` }], isError: true };
      }
      appendSignal(vault.root, { tool: "kb_read", path: relNorm });
      return { content: [{ type: "text", text: fs.readFileSync(abs, "utf8") }] };
    }
  );

  server.registerTool(
    "kb_stats",
    {
      description:
        "Vault health: tier distribution, L0 capacity, untriaged count, orphan notes, recent gate traffic.",
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
