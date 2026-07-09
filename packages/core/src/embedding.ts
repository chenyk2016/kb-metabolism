import type Database from "better-sqlite3";
import type { EmbeddingConfig, Vault } from "./types.js";

/**
 * 语义层是插件，不是地基：
 * - 协议选业界事实标准（OpenAI 兼容 /v1/embeddings），一份 fetch 实现通吃
 *   硅基流动 / Voyage / OpenAI / Ollama，零新增 SDK 依赖
 * - 向量存 kb.db（派生物，删库可重建）；按内容 hash 增量，没改过不重算
 * - API key 解析链见 secrets.ts：env 覆盖 → .kb/secrets.json（0600、gitignored），永不进 git
 * - 任何失败都降级回纯字面检索——语义只是增强，检索永远可用
 */

const BATCH = 16;
/** 送去 embedding 的文本长度上限（标题+正文前段足以表达主题） */
const EMBED_CHARS = 2000;

export async function embedTexts(
  cfg: EmbeddingConfig,
  texts: string[],
  key: string
): Promise<Float32Array[]> {
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const res = await fetch(cfg.baseUrl.replace(/\/+$/, "") + "/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        input: batch,
        ...(cfg.dimensions ? { dimensions: cfg.dimensions } : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(`embedding API ${res.status}：${(await res.text()).slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      data: Array<{ index: number; embedding: number[] }>;
    };
    for (const d of [...json.data].sort((a, b) => a.index - b.index)) {
      out.push(Float32Array.from(d.embedding));
    }
  }
  return out;
}

export function vecToBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

export function blobToVec(b: Buffer): Float32Array {
  // 拷贝一份，规避 Buffer 池的字节对齐问题
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** 增量同步向量：只算新增/内容变化的笔记，清理已消失笔记的向量 */
export async function syncEmbeddings(
  vault: Vault,
  db: Database.Database
): Promise<{ embedded: number; total: number }> {
  const cfg = vault.config.embedding;
  if (!cfg) return { embedded: 0, total: 0 };

  const notes = db
    .prepare(
      `SELECT n.path AS path, n.title AS title, n.hash AS hash, f.body AS body
       FROM notes n JOIN notes_fts f ON f.path = n.path`
    )
    .all() as Array<{ path: string; title: string; hash: string; body: string }>;

  const have = new Map(
    (db.prepare("SELECT path, hash FROM embeddings").all() as Array<{ path: string; hash: string }>).map(
      (r) => [r.path, r.hash]
    )
  );

  // 身份复用：路径变了但内容没变（纯移动/改名）→ 旧向量行改绑新路径，零重算
  const notePaths = new Set(notes.map((n) => n.path));
  const orphansByHash = new Map<string, string[]>();
  for (const [p, h] of have) {
    if (notePaths.has(p)) continue;
    const list = orphansByHash.get(h) ?? [];
    list.push(p);
    orphansByHash.set(h, list);
  }
  const rebind = db.prepare("UPDATE embeddings SET path = ? WHERE path = ?");
  for (const n of notes) {
    if (have.has(n.path)) continue;
    const old = orphansByHash.get(n.hash)?.pop();
    if (old) {
      rebind.run(n.path, old);
      have.set(n.path, n.hash);
      have.delete(old);
    }
  }
  db.prepare("DELETE FROM embeddings WHERE path NOT IN (SELECT path FROM notes)").run();
  const stale = notes.filter((n) => have.get(n.path) !== n.hash);
  if (stale.length > 0) {
    const { requireEmbeddingKey } = await import("./secrets.js");
    const vecs = await embedTexts(
      cfg,
      stale.map((n) => `${n.title}\n${n.body}`.slice(0, EMBED_CHARS)),
      requireEmbeddingKey(vault.root, cfg)
    );
    const ins = db.prepare(
      "INSERT OR REPLACE INTO embeddings (path, hash, dim, vec) VALUES (?, ?, ?, ?)"
    );
    const tx = db.transaction(() => {
      stale.forEach((n, i) => ins.run(n.path, n.hash, vecs[i].length, vecToBlob(vecs[i])));
    });
    tx();
  }
  return { embedded: stale.length, total: notes.length };
}

export type SemanticHit = { path: string; title: string; snip: string };

/** 查询向量 vs 全库余弦——个人库规模下 JS 暴力扫描毫秒级，无需向量数据库 */
export function semanticSearch(
  db: Database.Database,
  queryVec: Float32Array,
  limit: number
): SemanticHit[] {
  const rows = db
    .prepare(
      `SELECT e.path AS path, e.vec AS vec, n.title AS title, f.body AS body
       FROM embeddings e
       JOIN notes n ON n.path = e.path
       JOIN notes_fts f ON f.path = e.path`
    )
    .all() as Array<{ path: string; vec: Buffer; title: string; body: string }>;

  return rows
    .map((r) => ({
      path: r.path,
      title: r.title,
      snip: r.body.replace(/\s+/g, " ").trim().slice(0, 90),
      score: cosine(queryVec, blobToVec(r.vec)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
