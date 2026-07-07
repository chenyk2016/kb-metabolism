import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import matter from "gray-matter";
import { openDb } from "./db.js";
import { VAULT_ROOT, MANAGED_DIR, GRAVEYARD_DIR } from "./config.js";

const SKIP_DIRS = new Set([".obsidian", ".git", "node_modules", "_graveyard", "assets"]);

function* walkMd(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      yield* walkMd(full);
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

/** 提取 [[wiki链接]] 与 markdown 链接的目标名（basename，不含扩展名） */
function extractLinkTargets(body: string): string[] {
  const targets = new Set<string>();
  for (const m of body.matchAll(/\[\[([^\]]+)\]\]/g)) {
    // [[名字#标题|别名]] → 名字
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

export function runIndex(): { notes: number; links: number; tiers: Record<string, number> } {
  const db = openDb();

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
  for (const file of walkMd(MANAGED_DIR)) {
    const raw = fs.readFileSync(file, "utf8");
    let fm: Record<string, unknown> = {};
    let body = raw;
    try {
      const parsed = matter(raw);
      fm = parsed.data ?? {};
      body = parsed.content;
    } catch {
      // frontmatter 解析失败按无 frontmatter 处理
    }
    const stat = fs.statSync(file);
    const str = (v: unknown) => {
      if (v == null) return null;
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      return String(v);
    };
    managed.push({
      rel: path.relative(VAULT_ROOT, file),
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

  // basename → 被管理笔记路径（用于反链解析）
  const byBasename = new Map<string, string>();
  for (const n of managed) byBasename.set(path.basename(n.rel, ".md"), n.rel);

  // 全 vault 扫反链（daily 等目录引用 inbox 笔记也是使用信号）
  const linkRows: Array<{ src: string; dst: string }> = [];
  for (const file of walkMd(VAULT_ROOT)) {
    const rel = path.relative(VAULT_ROOT, file);
    const raw = fs.readFileSync(file, "utf8");
    for (const target of extractLinkTargets(raw)) {
      const dst = byBasename.get(target);
      if (dst && dst !== rel) linkRows.push({ src: rel, dst });
    }
  }

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
  db.close();
  return { notes: managed.length, links: linkCount, tiers };
}

const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) {
  fs.mkdirSync(GRAVEYARD_DIR, { recursive: true });
  const r = runIndex();
  console.log(`索引完成：${r.notes} 条笔记，${r.links} 条反链`);
  console.log("层级分布：", r.tiers);
}
