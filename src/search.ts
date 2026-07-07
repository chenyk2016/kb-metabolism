import type Database from "better-sqlite3";

export type Hit = { path: string; title: string; snip: string };

/** hybrid：≥3 字符走 FTS5 trigram，否则/无结果时 LIKE 兜底 */
export function searchNotes(db: Database.Database, query: string, limit = 8): Hit[] {
  const q = query.trim();
  if (!q) return [];
  let rows: Hit[] = [];

  if ([...q].length >= 3) {
    try {
      rows = db
        .prepare(
          `SELECT path, title, snippet(notes_fts, 2, '**', '**', '…', 16) AS snip
           FROM notes_fts WHERE notes_fts MATCH ? ORDER BY rank LIMIT ?`
        )
        .all(`"${q.replaceAll('"', '""')}"`, limit) as Hit[];
    } catch {
      rows = [];
    }
  }

  if (rows.length === 0) {
    rows = db
      .prepare(
        `SELECT path, title,
                substr(body, max(1, instr(lower(body), lower(?)) - 30), 90) AS snip
         FROM notes_fts
         WHERE title LIKE '%' || ? || '%' OR body LIKE '%' || ? || '%'
         LIMIT ?`
      )
      .all(q, q, q, limit) as Hit[];
  }
  return rows;
}
