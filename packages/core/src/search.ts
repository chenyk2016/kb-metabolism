import type Database from "better-sqlite3";
import type { Vault } from "./types.js";

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

type Ranked = {
  doc: Doc;
  score: number;
  /** 命中数 / 库内存在的单元数——检索排序用 */
  coverage: number;
  /** 命中数 / 原始单元总数——查重用：新内容有多少已在这篇旧笔记里 */
  rawCoverage: number;
  /** 命中单元 idf 和 / 全部有效单元 idf 和——hook 注入判相关用：常用字权重趋零，实词说了算 */
  idfCoverage: number;
  /** 在标题里命中的单元数——标题是主题声明，正文碰瓷（跨词边界 bigram）拦在这里 */
  titleHits: number;
  firstIdx: number;
};

/** 自动分词 + 全库评分（第 3 层检索与 kb_add 查重共用） */
function rankAll(db: Database.Database, query: string): Ranked[] {
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

  let liveIdfSum = 0;
  for (const u of live) liveIdfSum += Math.log(1 + N / df.get(u)!);

  const scored: Ranked[] = [];
  for (const d of lowered) {
    let score = 0;
    let hits = 0;
    let hitIdf = 0;
    let titleHits = 0;
    let firstIdx = -1;
    for (const u of live) {
      const idf = Math.log(1 + N / df.get(u)!);
      const inTitle = d.lt.includes(u);
      const idx = d.lb.indexOf(u);
      if (!inTitle && idx < 0) continue;
      hits++;
      hitIdf += idf;
      if (inTitle) titleHits++;
      let tf = 0;
      for (let p = idx; p >= 0 && tf < 8; p = d.lb.indexOf(u, p + u.length)) tf++;
      if (tf > 0) score += idf * (1 + Math.log(tf));
      if (inTitle) score += idf * 2;
      if (idx >= 0 && (firstIdx < 0 || idx < firstIdx)) firstIdx = idx;
    }
    if (hits === 0) continue;
    const coverage = hits / live.length;
    scored.push({
      doc: d.doc,
      score: score * (0.5 + coverage),
      coverage,
      rawCoverage: hits / units.length,
      idfCoverage: liveIdfSum === 0 ? 0 : hitIdf / liveIdfSum,
      titleHits,
      firstIdx,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

export type Similar = { path: string; title: string; snip: string; coverage: number };

/**
 * kb_add 的查重探测：标题+首段的检索单元有过半出现在同一篇旧笔记里，
 * 视为疑似同主题。系统只递证据，"是否合并"的判断留给调用方（agent/人）。
 */
export function similarNotes(
  db: Database.Database,
  text: string,
  limit = 3,
  minCoverage = 0.5
): Similar[] {
  return rankAll(db, text)
    .filter((r) => r.rawCoverage >= minCoverage)
    .sort((a, b) => b.rawCoverage - a.rawCoverage)
    .slice(0, limit)
    .map((r) => ({
      path: r.doc.path,
      title: r.doc.title,
      snip: snippetAround(r.doc.body, r.firstIdx),
      coverage: r.rawCoverage,
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
  return rankAll(db, q)
    .slice(0, limit)
    .map((s) => ({
      path: s.doc.path,
      title: s.doc.title,
      snip: snippetAround(s.doc.body, s.firstIdx),
    }));
}

/**
 * 双路召回 + RRF 融合：字面三层（上面的 searchNotes）+ 语义余弦（如果配置了 embedding）。
 * RRF 只看排名不看分数尺度，无参数可调：score = Σ 1/(60+rank)。
 * 语义路任何失败都静默降级回纯字面——检索永远可用。
 */
export async function hybridSearch(
  vault: Vault,
  db: Database.Database,
  query: string,
  limit = 8
): Promise<Hit[]> {
  const RECALL = Math.max(20, limit);
  const literal = searchNotes(db, query, RECALL);
  const cfg = vault.config.embedding;
  if (!cfg) return literal.slice(0, limit);

  let semantic: Hit[] = [];
  try {
    const { embedTexts, semanticSearch } = await import("./embedding.js");
    const { requireEmbeddingKey } = await import("./secrets.js");
    const [qv] = await embedTexts(cfg, [query.trim()], requireEmbeddingKey(vault.root, cfg));
    semantic = semanticSearch(db, qv, RECALL);
  } catch (err) {
    console.error(
      `语义检索不可用（已降级纯字面）：${err instanceof Error ? err.message : err}`
    );
    return literal.slice(0, limit);
  }

  const K = 60;
  const score = new Map<string, number>();
  const meta = new Map<string, Hit>();
  for (const [i, h] of literal.entries()) {
    score.set(h.path, (score.get(h.path) ?? 0) + 1 / (K + i + 1));
    meta.set(h.path, h);
  }
  for (const [i, h] of semantic.entries()) {
    score.set(h.path, (score.get(h.path) ?? 0) + 1 / (K + i + 1));
    if (!meta.has(h.path)) meta.set(h.path, h);
  }
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([p]) => meta.get(p)!);
}

/**
 * hooks 专用检索：只走字面（毫秒级零费用——hook 阻塞 prompt，不能付 embedding 延迟），
 * 且"不够相关就沉默"：phrase 命中算强相关；ranked 兜底须同时满足
 * idf 加权覆盖度 ≥0.5（高频单元灌不进来）与标题命中 ≥1（跨词边界的碎 bigram
 * 在正文碰瓷再多也不算主题相关），否则返回空。判准是注入续命（injectDays）的前提。
 */
export function hookSearch(db: Database.Database, prompt: string, limit = 3): Hit[] {
  const q = prompt.trim();
  if ([...q].length < 4) return [];
  const terms = q.split(/\s+/).filter(Boolean);

  let rows = phraseFts(db, terms, limit);
  if (rows.length === 0) rows = phraseLike(db, terms, limit);
  if (rows.length > 0) return rows;

  return rankAll(db, q)
    .filter((r) => r.idfCoverage >= 0.5 && r.titleHits > 0)
    .slice(0, limit)
    .map((s) => ({
      path: s.doc.path,
      title: s.doc.title,
      snip: snippetAround(s.doc.body, s.firstIdx),
    }));
}

/** 无结果时给用户的提示 */
export function noResultHint(_query: string): string {
  return "提示：已自动分词做过模糊匹配仍无结果——库里可能确实没有；若刚新增或修改过笔记，先跑 kb index 刷新索引";
}
