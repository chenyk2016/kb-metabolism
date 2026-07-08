import type Database from "better-sqlite3";

export type Hit = { path: string; title: string; snip: string };

/**
 * 混合检索：
 * - 单个关键词：≥3 字符走 FTS5 trigram 短语匹配，否则/无结果时 LIKE 兜底
 * - 多个关键词（空格分开）：AND 语义——每个词都必须出现（标题或正文）
 *   trigram 的 MATCH 对 <3 字符的词无能为力，含短词时整体降级为 LIKE AND
 */
export function searchNotes(db: Database.Database, query: string, limit = 8): Hit[] {
  const q = query.trim();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  let rows: Hit[] = [];

  const allFtsable = terms.every((t) => [...t].length >= 3);
  if (allFtsable) {
    const match = terms.map((t) => `"${t.replaceAll('"', '""')}"`).join(" AND ");
    try {
      rows = db
        .prepare(
          `SELECT path, title, snippet(notes_fts, 2, '**', '**', '…', 16) AS snip
           FROM notes_fts WHERE notes_fts MATCH ? ORDER BY rank LIMIT ?`
        )
        .all(match, limit) as Hit[];
    } catch {
      rows = [];
    }
  }

  if (rows.length === 0) {
    const where = terms
      .map(() => `(title LIKE '%' || ? || '%' OR body LIKE '%' || ? || '%')`)
      .join(" AND ");
    const params: string[] = [];
    for (const t of terms) params.push(t, t);
    rows = db
      .prepare(
        `SELECT path, title,
                substr(body, max(1, instr(lower(body), lower(?)) - 30), 90) AS snip
         FROM notes_fts
         WHERE ${where}
         LIMIT ?`
      )
      .all(terms[0], ...params, limit) as Hit[];
  }
  return rows;
}

/** 无结果时给用户的检索建议 */
export function noResultHint(query: string): string {
  const hints = [];
  if (!/\s/.test(query.trim()) && [...query.trim()].length >= 5) {
    hints.push(`长词组是按"连续出现"匹配的——多个关键词请用空格分开（AND 语义），如：kb search "${[...query.trim()].slice(0, 2).join("")} ${[...query.trim()].slice(-2).join("")}"`);
  }
  hints.push("若刚新增或修改过笔记，先跑 kb index 刷新索引");
  return hints.map((h) => `提示：${h}`).join("\n");
}
