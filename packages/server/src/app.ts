import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Hono } from "hono";
import matter from "gray-matter";
import { z } from "zod";
import {
  addNote,
  appendSignal,
  applyDecision,
  approveLines,
  buildChewCandidates,
  createL0,
  digestReminder,
  executeReport,
  getStats,
  graveyardDir,
  hybridSearch,
  kbDir,
  latestKillList,
  loadVault,
  notePathIdMap,
  notePreview,
  openDb,
  parsePending,
  readSignals,
  signalNoteKey,
  reportsDir,
  resolveEmbeddingKey,
  runCoroner,
  runDoctor,
  runIndex,
  saveChewList,
  saveDoctorReport,
  similarNotes,
  type Signal,
  type Vault,
} from "@kb/core";
import {
  AddNoteSchema,
  ChewSchema,
  ConfigPatchSchema,
  GraveyardRestoreSchema,
  ReviewApproveSchema,
  ReviewExecuteSchema,
  TriageSchema,
  type KillListItem,
  type NoteListItem,
  type ReportInfo,
  type ReportKind,
} from "./schemas.js";

/**
 * /api/v1——薄封装 @kb/core，不产生第二套业务逻辑。
 * 信号纪律：UI 的浏览与检索一律记 kb_ui（法医只认 kb_read/kb_cite，不续命，只留审计痕迹）；
 * 过堂预览走 notePreview，不记任何信号。
 * 删除没有端点——唯一路径仍是 勾选名单 → execute。
 */

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function hostAllowed(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.replace(/:\d+$/, "");
  return LOCAL_HOSTS.has(name);
}

/** path 参数防线：resolve 后必须在 vault 内，且永远不进 .kb/（secrets 所在地） */
function safeRel(root: string, rel: string): string {
  const norm = path.relative(root, path.resolve(root, rel));
  if (!norm || norm.startsWith("..") || path.isAbsolute(norm)) {
    throw new HttpError(403, `路径越界：${rel}`);
  }
  if (norm === ".kb" || norm.startsWith(".kb" + path.sep)) {
    throw new HttpError(403, `拒绝访问 .kb/：${rel}`);
  }
  return norm;
}

class HttpError extends Error {
  constructor(
    public status: 400 | 403 | 404 | 409,
    message: string
  ) {
    super(message);
  }
}

async function parseBody<T extends z.ZodTypeAny>(
  req: Request,
  schema: T
): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new HttpError(400, "请求体不是合法 JSON");
  }
  const r = schema.safeParse(json);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => i.message).join("; "));
  return r.data;
}

function reportKind(file: string): ReportKind {
  if (file.startsWith("kill-list-")) return "kill-list";
  if (file.startsWith("health-")) return "health";
  if (file.startsWith("chew-list-")) return "chew-list";
  return "other";
}

function reportPath(root: string, file: string): string {
  const abs = path.join(reportsDir(root), file);
  if (!fs.existsSync(abs)) throw new HttpError(404, `报告不存在：${file}`);
  return abs;
}

function killListItems(vault: Vault, abs: string): KillListItem[] {
  const { lines, items } = parsePending(abs);
  const all: KillListItem[] = items.map((it) => ({
    ...it,
    checked: false,
    preview: notePreview(vault, it.path),
    exists: fs.existsSync(path.join(vault.root, it.path)),
  }));
  // parsePending 只认未勾选的；已勾选的（上次中途放弃的会话）也要给 UI 看见
  lines.forEach((l, i) => {
    const m = l.match(/^- \[[xX]\] `([^`]+)`\s*—?\s*(.*)$/);
    if (m) {
      all.push({
        line: i,
        path: m[1],
        rest: m[2],
        checked: true,
        preview: notePreview(vault, m[1]),
        exists: fs.existsSync(path.join(vault.root, m[1])),
      });
    }
  });
  return all.sort((a, b) => a.line - b.line);
}

export type AppOptions = {
  /** 每请求重新 loadVault，config 修改即时生效 */
  root: string;
};

export function createApp(opts: AppOptions): Hono {
  const app = new Hono();
  const vault = () => loadVault(opts.root);

  // DNS rebinding / 跨站防线：Host 必须是本机；非 GET 再校验 Origin
  app.use("*", async (c, next) => {
    if (!hostAllowed(c.req.header("host"))) {
      return c.json({ error: "仅限本机访问" }, 403);
    }
    if (c.req.method !== "GET" && c.req.path.startsWith("/api/")) {
      const origin = c.req.header("origin");
      if (origin) {
        try {
          if (!LOCAL_HOSTS.has(new URL(origin).hostname)) {
            return c.json({ error: "拒绝跨站写操作" }, 403);
          }
        } catch {
          return c.json({ error: "拒绝跨站写操作" }, 403);
        }
      }
    }
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    return c.json({ error: err.message }, 500);
  });

  const api = new Hono();

  // ── 总览 ────────────────────────────────────────────
  api.get("/overview", async (c) => {
    const v = vault();
    await runIndex(v);
    const stats = getStats(v);
    const latest = latestKillList(v.root);
    return c.json({
      doctor: runDoctor(v),
      stats,
      reminder: digestReminder(v.root),
      todo: {
        untriaged: stats.tiers["未分诊"] ?? 0,
        pendingReview: latest ? parsePending(latest).items.length : 0,
        chewCandidates: buildChewCandidates(v).length,
      },
    });
  });

  // ── 笔记 ────────────────────────────────────────────
  api.get("/notes", (c) => {
    const v = vault();
    const tier = c.req.query("tier") ?? "all";
    const db = openDb(v.root);
    const rows =
      tier === "untriaged"
        ? db.prepare("SELECT * FROM notes WHERE tier IS NULL ORDER BY modified DESC").all()
        : tier === "all"
          ? db.prepare("SELECT * FROM notes ORDER BY modified DESC").all()
          : db.prepare("SELECT * FROM notes WHERE tier = ? ORDER BY modified DESC").all(tier);
    const backlinks = new Map(
      (
        db.prepare("SELECT dst, COUNT(*) AS c FROM links GROUP BY dst").all() as Array<{
          dst: string;
          c: number;
        }>
      ).map((r) => [r.dst, r.c])
    );
    const pathToId = notePathIdMap(db);
    db.close();

    // 键 = 笔记 id（历史 path 行经映射兜底），移动后的笔记仍能显示最后读取/引用
    const lastRead = new Map<string, string>();
    const lastCite = new Map<string, string>();
    for (const s of readSignals(v.root)) {
      const key = signalNoteKey(s, pathToId);
      if (!key) continue;
      if (s.tool === "kb_read") lastRead.set(key, s.ts);
      if (s.tool === "kb_cite") lastCite.set(key, s.ts);
    }
    const notes = (rows as NoteListItem[]).map((n) => ({
      ...n,
      backlinks: backlinks.get(n.path) ?? 0,
      lastRead: (n.id ? lastRead.get(n.id) : undefined) ?? null,
      lastCite: (n.id ? lastCite.get(n.id) : undefined) ?? null,
    }));
    return c.json({ notes });
  });

  api.get("/notes/detail", (c) => {
    const v = vault();
    const rel = safeRel(v.root, c.req.query("path") ?? "");
    const abs = path.join(v.root, rel);
    if (!fs.existsSync(abs)) throw new HttpError(404, `不存在：${rel}`);

    const parsed = matter(fs.readFileSync(abs, "utf8"));
    const db = openDb(v.root);
    const row = db.prepare("SELECT title FROM notes WHERE path = ?").get(rel) as
      | { title: string }
      | undefined;
    const backlinks = (
      db.prepare("SELECT src FROM links WHERE dst = ? ORDER BY src").all(rel) as Array<{
        src: string;
      }>
    ).map((r) => r.src);
    db.close();

    const noteId = typeof parsed.data?.kb_id === "string" ? parsed.data.kb_id : null;
    const signals: Signal[] = [];
    for (const s of readSignals(v.root).reverse()) {
      if ((noteId && s.id === noteId) || s.path === rel) signals.push(s);
      if (signals.length >= 50) break;
    }

    // 管理性浏览 ≠ 真实使用：记 kb_ui 留审计痕迹，法医不认，不给笔记续命
    appendSignal(v.root, { tool: "kb_ui", path: rel, id: noteId ?? undefined });

    const fm: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(parsed.data ?? {})) {
      fm[k] = val instanceof Date ? val.toISOString().slice(0, 10) : val;
    }
    return c.json({
      path: rel,
      title: row?.title ?? path.basename(rel, ".md"),
      frontmatter: fm,
      body: parsed.content,
      backlinks,
      signals,
    });
  });

  api.post("/notes", async (c) => {
    const v = vault();
    const body = await parseBody(c.req.raw, AddNoteSchema);
    if (!body.force) {
      const db = openDb(v.root);
      const similar = similarNotes(db, `${body.title} ${body.content.slice(0, 100)}`, 3, 0.5);
      db.close();
      if (similar.length > 0) return c.json({ created: null, similar });
    }
    let rel: string;
    try {
      rel = addNote(v, {
        title: body.title,
        content: body.content,
        tier: body.tier,
        useWhen: body.useWhen,
        dir: body.dir,
      });
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }
    await runIndex(v);
    return c.json({ created: rel, tier: body.tier ?? (body.useWhen ? "L1" : "inbox") });
  });

  // ── 检索（管理性检索记 kb_ui，不冒充 agent 的 kb_search） ──
  api.get("/search", async (c) => {
    const v = vault();
    const q = (c.req.query("q") ?? "").trim();
    if (!q) throw new HttpError(400, "缺少 q 参数");
    const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10) || 20, 50);
    const db = openDb(v.root);
    const hits = await hybridSearch(v, db, q, limit);
    db.close();
    appendSignal(v.root, { tool: "kb_ui", query: q });
    return c.json({ hits });
  });

  // ── 信号流水 ────────────────────────────────────────
  api.get("/signals", (c) => {
    const v = vault();
    const tool = c.req.query("tool");
    const p = c.req.query("path");
    const limit = Math.min(parseInt(c.req.query("limit") ?? "200", 10) || 200, 1000);
    const all = readSignals(v.root);
    const tools = [...new Set(all.map((s) => s.tool))].sort();
    const signals = all
      .reverse()
      .filter((s) => (!tool || s.tool === tool) && (!p || s.path === p))
      .slice(0, limit);
    return c.json({ signals, tools });
  });

  // ── 报告 ────────────────────────────────────────────
  api.get("/reports", (c) => {
    const v = vault();
    let files: string[] = [];
    try {
      files = fs.readdirSync(reportsDir(v.root)).filter((f) => f.endsWith(".md"));
    } catch {
      // 无 reports 目录 = 从未消化
    }
    const reports: ReportInfo[] = files
      .map((file) => {
        const kind = reportKind(file);
        const date = file.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";
        const info: ReportInfo = { file, kind, date };
        if (kind === "kill-list") {
          const raw = fs.readFileSync(path.join(reportsDir(v.root), file), "utf8");
          info.pending = (raw.match(/^- \[ \] /gm) ?? []).length;
          info.approved = (raw.match(/^- \[[xX]\] /gm) ?? []).length;
        }
        return info;
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    return c.json({ reports });
  });

  api.get("/reports/detail", (c) => {
    const v = vault();
    const file = c.req.query("file") ?? "";
    if (!/^[a-z-]+-\d{4}-\d{2}-\d{2}\.md$/.test(file)) throw new HttpError(400, "非法报告文件名");
    const abs = reportPath(v.root, file);
    const kind = reportKind(file);
    return c.json({
      file,
      kind,
      content: fs.readFileSync(abs, "utf8"),
      ...(kind === "kill-list" ? { items: killListItems(v, abs) } : {}),
    });
  });

  // ── 过堂（人的判决；AI 永远没有删除端点） ──────────
  api.post("/review/approve", async (c) => {
    const v = vault();
    const { file, lines } = await parseBody(c.req.raw, ReviewApproveSchema);
    approveLines(reportPath(v.root, file), lines);
    return c.json({ ok: true, approved: lines.length });
  });

  api.post("/review/execute", async (c) => {
    const v = vault();
    const { file } = await parseBody(c.req.raw, ReviewExecuteSchema);
    const result = await executeReport(v, reportPath(v.root, file));
    return c.json(result);
  });

  // ── 分诊（入口税服务端强制） ────────────────────────
  api.post("/triage", async (c) => {
    const v = vault();
    const { decisions } = await parseBody(c.req.raw, TriageSchema);
    for (const d of decisions) {
      if ((d.tier === "L0" || d.tier === "L1") && !d.useWhen?.trim()) {
        throw new HttpError(400, `${d.path}：${d.tier} 层必须提供 use_when——入口税`);
      }
      safeRel(v.root, d.path);
    }
    for (const d of decisions) {
      applyDecision(v, { path: d.path, tier: d.tier, useWhen: d.useWhen?.trim() || undefined });
    }
    const r = await runIndex(v);
    return c.json({ applied: decisions.length, tiers: r.tiers });
  });

  // ── 消化（AI 拆解在别处；这里只收人亲口说出的判断） ──
  api.get("/chew/candidates", (c) => {
    const v = vault();
    return c.json({ candidates: buildChewCandidates(v) });
  });

  api.post("/chew", async (c) => {
    const v = vault();
    const body = await parseBody(c.req.raw, ChewSchema);
    for (const p of body.evidencePaths) safeRel(v.root, p);
    let rel: string;
    try {
      rel = createL0(v, body.judgment, body.useWhen, body.evidencePaths);
    } catch (err) {
      // L0 满是业务冲突不是坏请求
      throw new HttpError(409, err instanceof Error ? err.message : String(err));
    }
    await runIndex(v);
    return c.json({ created: rel });
  });

  // ── 消化仪式（法医 + 体检留档 + 消化名单，无 LLM） ──
  api.post("/digest", async (c) => {
    const v = vault();
    await runIndex(v);
    const { report, candidates } = runCoroner(v);
    const health = saveDoctorReport(v, runDoctor(v));
    const chews = buildChewCandidates(v);
    const chewList = chews.length > 0 ? saveChewList(v, chews) : null;
    return c.json({
      report: path.basename(report),
      candidates,
      health: path.basename(health),
      chewList: chewList ? path.basename(chewList) : null,
    });
  });

  // ── 配置（白名单读写；secrets 永不经过 API） ────────
  api.get("/config", (c) => {
    const v = vault();
    return c.json({
      root: v.root,
      version: v.config.version ?? 1,
      config: v.config,
      embeddingKeyConfigured: v.config.embedding
        ? resolveEmbeddingKey(v.root, v.config.embedding) !== null
        : false,
    });
  });

  api.put("/config", async (c) => {
    const v = vault();
    const patch = await parseBody(c.req.raw, ConfigPatchSchema);
    const file = path.join(kbDir(v.root), "config.json");
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;

    const { judgment, embedding, ...scalars } = patch;
    Object.assign(raw, scalars);
    if (judgment) {
      raw.judgment = { ...(raw.judgment as object), ...judgment };
    }
    if (embedding === null) delete raw.embedding;
    else if (embedding) raw.embedding = embedding;
    raw.version = raw.version ?? 1;

    fs.writeFileSync(file, JSON.stringify(raw, null, 2) + "\n");
    const fresh = vault();
    return c.json({
      root: fresh.root,
      version: fresh.config.version ?? 1,
      config: fresh.config,
      embeddingKeyConfigured: fresh.config.embedding
        ? resolveEmbeddingKey(fresh.root, fresh.config.embedding) !== null
        : false,
    });
  });

  // ── 索引 ────────────────────────────────────────────
  api.post("/index", async (c) => c.json(await runIndex(vault())));

  // ── 墓地（只看和还魂；真删永远归人手动） ────────────
  api.get("/graveyard", (c) => {
    const v = vault();
    let items: Array<{ file: string; mtime: string }> = [];
    try {
      items = fs
        .readdirSync(graveyardDir(v.root))
        .filter((f) => f.endsWith(".md"))
        .map((file) => ({
          file,
          mtime: fs.statSync(path.join(graveyardDir(v.root), file)).mtime.toISOString(),
        }))
        .sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
    } catch {
      // 无墓地目录
    }
    return c.json({ items });
  });

  api.post("/graveyard/restore", async (c) => {
    const v = vault();
    const { file } = await parseBody(c.req.raw, GraveyardRestoreSchema);
    const src = path.join(graveyardDir(v.root), file);
    if (!fs.existsSync(src)) throw new HttpError(404, `墓地里没有：${file}`);
    let dest = path.join(v.root, file);
    if (fs.existsSync(dest)) dest = path.join(v.root, `restored-${file}`);
    try {
      execFileSync(
        "git",
        ["-C", v.root, "mv", path.relative(v.root, src), path.relative(v.root, dest)],
        { stdio: "ignore" }
      );
    } catch {
      fs.renameSync(src, dest);
    }
    await runIndex(v);
    return c.json({ restored: path.relative(v.root, dest) });
  });

  app.route("/api/v1", api);
  return app;
}
