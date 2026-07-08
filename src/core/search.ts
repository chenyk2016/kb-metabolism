import type Database from "better-sqlite3";

export type Hit = { path: string; title: string; snip: string };

/**
 * 检索的第一性：责任在系统，不在查询者。用户输入自然语言，系统负责理解。
 *
 * 三层逐级降级，用户零学习成本：
 *   1. 整串连续命中（意图最明确，直接返回）
 *   2. 空格显式分词的 AND（全部命中）
 *   3. 自动分词模糊排序——中文切 bigram（中文词的最小语义单元）、英文按词，
 *      全库从未出现的单元（跨词边界噪音）自动剔除，按 idf×tf×标题加权×覆盖度打分。
 *      命中一部分也给结果：排序的容错取代布尔 AND 的脆性。
 *
 * 个人库规模（万条以内）是真实约束——JS 端全量评分毫秒级，
 * FTS5 只是第 1、2 层的加速器，检索质量不被它的 tokenizer 绑架。
 */

const CJK_RE = /[㐀-䶿一-鿿]/;
const SEG_RE = /[㐀-䶿一-鿿]+|[^㐀-䶿一-鿿\s]+/g;

/** 查询 → 检索单元：中文长串切 bigram，英文/数字按词 */
export function queryUnits(query: string): string[] {
  const units: string[] = [];
  for (const seg of query.trim().toLowerCase().match(SEG_RE) ?? []) {
    if (CJK_RE.test(seg)) {
      const chars = [...seg];
      if (chars.length <= 2) units.push(seg);
      else for (let i = 0; i < chars.length - 1; i++) units.push(chars[i] + chars[i + 1]);
    } else {
      const w = seg.replace(/[^\p{L}\p{N}_-]+/gu, "");
      if (w) units.push(w);
    }
  }
  return [...new Set(units)];
}

type Doc = { path: string; title: string; body: string };

function phraseFts(db: Database.Database, terms: string[], limit: number): Hit[] {
  if (!terms.every((t) => [...t].length >= 3)) return [];
  const match = terms.map((t) => `"${t.replaceAll('"', '""')}"`).join(" AND ");
  try {
    return db
      .prepare(
        `SELECT path, title, snippet(notes_fts, 2, '**', '**', '…', 16) AS snip
         FROM notes_fts WHERE notes_fts MATCH ? ORDER BY rank LIMIT ?`
      )
      .all(match, limit) as Hit[];
  } catch {
    return [];
  }
}

function phraseLike(db: Database.Database, terms: string[], limit: number): Hit[] {
  const where = terms
    .map(() => `(title LIKE '%' || ? || '%' OR body LIKE '%' || ? || '%')`)
    .join(" AND ");
  const params: string[] = [];
  for (const t of terms) params.push(t, t);
  return db
    .prepare(
      `SELECT path, title,
              substr(body, max(1, instr(lower(body), lower(?)) - 30), 90) AS snip
       FROM notes_fts WHERE ${where} LIMIT ?`
    )
    .all(terms[0], ...params, limit) as Hit[];
}

function snippetAround(body: string, idx: number): string {
  if (idx < 0) return body.replace(/\s+/g, " ").slice(0, 90);
  const start = Math.max(0, idx - 30);
  return (start > 0 ? "…" : "") + body.slice(start, idx + 60).replace(/\s+/g, " ");
}

/** 第 3 层：自动分词 + 全库评分排序 */
function rankedSearch(db: Database.Database, query: string, limit: number): Hit[] {
  const units = queryUnits(query);
  if (units.length === 0) return [];

  const docs = db.prepare("SELECT path, title, body FROM notes_fts").all() as Doc[];
  if (docs.length === 0) return [];
  const N = docs.length;
  const lowered = docs.map((d) => ({
    doc: d,
    lt: d.title.toLowerCase(),
    lb: d.body.toLowerCase(),
  }));

  // 文档频率；全库从未出现的单元是查询噪音（多为跨词边界的 bigram），剔除
  const df = new Map<string, number>();
  for (const u of units) {
    let c = 0;
    for (const d of lowered) if (d.lt.includes(u) || d.lb.includes(u)) c++;
    if (c > 0) df.set(u, c);
  }
  const live = [...df.keys()];
  if (live.length === 0) return [];

  const scored: Array<{ doc: Doc; score: number; firstIdx: number }> = [];
  for (const d of lowered) {
    let score = 0;
    let hits = 0;
    let firstIdx = -1;
    for (const u of live) {
      const idf = Math.log(1 + N / df.get(u)!);
      const inTitle = d.lt.includes(u);
      const idx = d.lb.indexOf(u);
      if (!inTitle && idx < 0) continue;
      hits++;
      let tf = 0;
      for (let p = idx; p >= 0 && tf < 8; p = d.lb.indexOf(u, p + u.length)) tf++;
      if (tf > 0) score += idf * (1 + Math.log(tf));
      if (inTitle) score += idf * 2;
      if (idx >= 0 && (firstIdx < 0 || idx < firstIdx)) firstIdx = idx;
    }
    if (hits === 0) continue;
    const coverage = hits / live.length;
    scored.push({ doc: d.doc, score: score * (0.5 + coverage), firstIdx });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => ({
    path: s.doc.path,
    title: s.doc.title,
    snip: snippetAround(s.doc.body, s.firstIdx),
  }));
}

export function searchNotes(db: Database.Database, query: string, limit = 8): Hit[] {
  const q = query.trim();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);

  // 第 1/2 层：整串或显式空格分词的精确命中
  let rows = phraseFts(db, terms, limit);
  if (rows.length === 0) rows = phraseLike(db, terms, limit);
  if (rows.length > 0) return rows;

  // 第 3 层：自然语言降级——自动分词 + 评分排序
  return rankedSearch(db, q, limit);
}

/** 无结果时给用户的提示 */
export function noResultHint(_query: string): string {
  return "提示：已自动分词做过模糊匹配仍无结果——库里可能确实没有；若刚新增或修改过笔记，先跑 kb index 刷新索引";
}
