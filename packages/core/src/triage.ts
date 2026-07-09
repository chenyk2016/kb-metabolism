import fs from "node:fs";
import path from "node:path";
import { openDb } from "./db.js";
import type { Vault } from "./types.js";
import type { UntriagedNote } from "./judgment/human.js";

/** 未分诊清单（含开头 400 字预览）——CLI 与 MCP prompts 共用 */
export function listUntriaged(v: Vault, limit?: number): UntriagedNote[] {
  const db = openDb(v.root);
  const rows = db
    .prepare("SELECT path, title FROM notes WHERE tier IS NULL ORDER BY path" + (limit ? " LIMIT ?" : ""))
    .all(...(limit ? [limit] : [])) as Array<{ path: string; title: string }>;
  db.close();
  return rows.map((r) => {
    let head = "";
    try {
      head = fs
        .readFileSync(path.join(v.root, r.path), "utf8")
        .replace(/^---[\s\S]*?---/, "")
        .trim()
        .slice(0, 400);
    } catch {
      // 文件读不了就只凭标题分诊
    }
    return { path: r.path, title: r.title, head };
  });
}
