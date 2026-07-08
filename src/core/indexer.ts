import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import matter from "gray-matter";
import picomatch from "picomatch";
import { openDb } from "./db.js";
import type { Vault } from "./types.js";

const ALWAYS_SKIP = new Set([".kb", ".git", ".obsidian", "node_modules"]);

function* walkMd(dir: string, root: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (ALWAYS_SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walkMd(full, root);
    } else if (e.isFile() && e.name.endsWith(".md")) {
      yield full;
    }
  }
}

function extractTitle(fm: Record<string, unknown>, body: string, file: string): string {
  if (typeof fm.title === "string" && fm.title.trim()) return fm.title.trim();
  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  return path.basename(file, ".md");
}

/** targets of [[wiki links]] and markdown links, as basenames without .md */
function extractLinkTargets(body: string): string[] {
  const targets = new Set<string>();
  for (const m of body.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const name = m[1].split("#")[0].split("|")[0].trim();
    if (name) targets.add(path.basename(name, ".md"));
  }
  for (const m of body.matchAll(/\]\(([^)]+\.md)[^)]*\)/g)) {
    try {
      targets.add(path.basename(decodeURIComponent(m[1]), ".md"));
    } catch {
      targets.add(path.basename(m[1], ".md"));
    }
  }
  return [...targets];
}

export type IndexResult = {
  notes: number;
  links: number;
  tiers: Record<string, number>;
  /** 本次增量计算的向量数（未配置 embedding 时恒为 0） */
  embedded: number;
};

export async function runIndex(vault: Vault): Promise<IndexResult> {
  const { root, config } = vault;
  const isManaged = picomatch(config.managed, { ignore: config.exclude });
  const isExcluded = picomatch(config.exclude);

  type Managed = {
    rel: string;
    title: string;
    tier: string | null;
    use_when: string | null;
    triaged: string | null;
    expires: string | null;
    created: string;
    modified: string;
    hash: string;
    body: string;
  };

  const managed: Managed[] = [];
  const allFiles: string[] = [];
  for (const file of walkMd(root, root)) {
    const rel = path.relative(root, file);
    if (isExcluded(rel)) continue;
    allFiles.push(file);
    if (!isManaged(rel)) continue;

    const raw = fs.readFileSync(file, "utf8");
    let fm: Record<string, unknown> = {};
    let body = raw;
    try {
      const parsed = matter(raw);
      fm = parsed.data ?? {};
      body = parsed.content;
    } catch {
      // broken frontmatter is treated as no frontmatter
    }
    const stat = fs.statSync(file);
    const str = (v: unknown) => {
      if (v == null) return null;
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      return String(v);
    };
    managed.push({
      rel,
      title: extractTitle(fm, body, file),
      tier: str(fm.kb_tier),
      use_when: str(fm.kb_use_when),
      triaged: str(fm.kb_triaged),
      expires: str(fm.kb_expires),
      created: str(fm.created ?? fm.date) ?? stat.birthtime.toISOString(),
      modified: stat.mtime.toISOString(),
      hash: crypto.createHash("sha1").update(raw).digest("hex"),
      body,
    });
  }

  const byBasename = new Map<string, string>();
  for (const n of managed) byBasename.set(path.basename(n.rel, ".md"), n.rel);

  // backlink scan covers the whole vault — a daily note referencing a managed
  // note counts as a usage signal
  const linkRows: Array<{ src: string; dst: string }> = [];
  for (const file of allFiles) {
    const rel = path.relative(root, file);
    const raw = fs.readFileSync(file, "utf8");
    for (const target of extractLinkTargets(raw)) {
      const dst = byBasename.get(target);
      if (dst && dst !== rel) linkRows.push({ src: rel, dst });
    }
  }

  const db = openDb(root);
  const rebuild = db.transaction(() => {
    db.prepare("DELETE FROM notes").run();
    db.prepare("DELETE FROM links").run();
    db.prepare("DELETE FROM notes_fts").run();
    const insNote = db.prepare(
      `INSERT INTO notes (path, title, tier, use_when, triaged, expires, created, modified, hash)
       VALUES (@rel, @title, @tier, @use_when, @triaged, @expires, @created, @modified, @hash)`
    );
    const insFts = db.prepare(
      "INSERT INTO notes_fts (path, title, body) VALUES (?, ?, ?)"
    );
    const insLink = db.prepare(
      "INSERT OR IGNORE INTO links (src, dst) VALUES (?, ?)"
    );
    for (const n of managed) {
      insNote.run(n);
      insFts.run(n.rel, n.title, n.body);
    }
    for (const l of linkRows) insLink.run(l.src, l.dst);
  });
  rebuild();

  const tiers: Record<string, number> = {};
  for (const r of db
    .prepare("SELECT COALESCE(tier, '未分诊') AS t, COUNT(*) AS c FROM notes GROUP BY t")
    .all() as Array<{ t: string; c: number }>) {
    tiers[r.t] = r.c;
  }
  const linkCount = (db.prepare("SELECT COUNT(*) AS c FROM links").get() as { c: number }).c;

  // 语义层增量同步；失败只降级警告，不影响索引主体
  let embedded = 0;
  if (vault.config.embedding) {
    try {
      const { syncEmbeddings } = await import("./embedding.js");
      embedded = (await syncEmbeddings(vault, db)).embedded;
    } catch (err) {
      console.error(
        `向量同步失败（已跳过，检索降级纯字面）：${err instanceof Error ? err.message : err}`
      );
    }
  }

  db.close();
  return { notes: managed.length, links: linkCount, tiers, embedded };
}
