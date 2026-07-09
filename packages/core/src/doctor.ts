import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { openDb } from "./db.js";
import { reportsDir } from "./config.js";
import { readSignals } from "./signals.js";
import { resolveEmbeddingKey, secretsTrackedByGit } from "./secrets.js";
import type { NoteRow, Vault } from "./types.js";

/**
 * 考古+健康诊断：不依赖访问日志，纯用 git 历史/mtime + 反链 + 层级——
 * 新库 init 后的第一分钟就能给出"你的库有多少在沉睡"的结论（冷启动 aha），
 * 老库随时可跑当体检（负向价值可视化）。
 */

/** 一次 git log 全仓扫描建立"文件 → 最后提交时间"映射（逐文件调 git 在大库上太慢） */
function lastCommitMap(root: string): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const out = execFileSync(
      "git",
      ["-C", root, "log", "--pretty=format:%cI", "--name-only", "--no-renames"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }
    );
    let current = "";
    for (const line of out.split("\n")) {
      if (/^\d{4}-\d{2}-\d{2}T/.test(line)) current = line;
      else if (line.trim() && !map.has(line)) map.set(line, current); // log 新→旧，首见即最新
    }
  } catch {
    // 非 git 仓库——全部走 mtime
  }
  return map;
}

export type DoctorReport = {
  total: number;
  untriaged: number;
  orphans: number;
  l0: number;
  l0Cap: number;
  dormant: NoteRow[]; // >365 天未动 且 0 反链
  decaying: NoteRow[]; // >90 天未动 且 0 反链（不含沉睡）
  active: number;
  oldest: Array<{ path: string; days: number }>;
  reads7d: number;
  searches7d: number;
  /** 近 30 天被 kb_cite 引用进产出的独立笔记数（吸收） */
  cited30d: number;
  /** 被创作目录（outputDirs）引用的独立笔记数（铁证级吸收） */
  outputRefs: number;
  hasSignals: boolean;
  /** 语义层健康（未配置 embedding 时为 undefined） */
  embedding?: {
    keySource: "env" | "file" | null;
    vectors: number;
    /** secrets.json 被 git 跟踪 = key 已进历史，事故 */
    secretsTracked: boolean;
  };
};

export function runDoctor(vault: Vault): DoctorReport {
  const { root, config } = vault;
  const db = openDb(root);
  const notes = db.prepare("SELECT * FROM notes").all() as NoteRow[];
  const backlinked = new Set(
    (db.prepare("SELECT DISTINCT dst FROM links").all() as Array<{ dst: string }>).map((r) => r.dst)
  );
  const vectors = (db.prepare("SELECT COUNT(*) AS c FROM embeddings").get() as { c: number }).c;
  db.close();

  const commits = lastCommitMap(root);
  const now = Date.now();
  const ageDays = (n: NoteRow): number => {
    const iso = commits.get(n.path);
    const t = iso ? new Date(iso).getTime() : new Date(n.modified).getTime();
    return Math.floor((now - t) / 86400000);
  };

  const dormant: NoteRow[] = [];
  const decaying: NoteRow[] = [];
  let active = 0;
  const withAge = notes.map((n) => ({ n, days: ageDays(n) }));
  for (const { n, days } of withAge) {
    const orphan = !backlinked.has(n.path);
    if (days > 365 && orphan) dormant.push(n);
    else if (days > config.decayDays && orphan) decaying.push(n);
    else active++;
  }

  let reads7d = 0;
  let searches7d = 0;
  const weekAgo = new Date(now - 7 * 86400000).toISOString();
  const monthAgo = new Date(now - 30 * 86400000).toISOString();
  const cited30d = new Set<string>();
  const signals = readSignals(root);
  for (const s of signals) {
    if (s.tool === "kb_cite" && s.path && s.ts >= monthAgo) cited30d.add(s.path);
    if (s.ts < weekAgo) continue;
    if (s.tool === "kb_read") reads7d++;
    if (s.tool === "kb_search") searches7d++;
  }
  const db2 = openDb(root);
  const outputRefs = (
    db2.prepare("SELECT COUNT(DISTINCT dst) AS c FROM links WHERE from_output = 1").get() as {
      c: number;
    }
  ).c;
  db2.close();

  return {
    total: notes.length,
    untriaged: notes.filter((n) => !n.tier).length,
    orphans: notes.filter((n) => !backlinked.has(n.path)).length,
    l0: notes.filter((n) => n.tier === "L0").length,
    l0Cap: config.l0Cap,
    dormant,
    decaying,
    active,
    oldest: withAge
      .sort((a, b) => b.days - a.days)
      .slice(0, 5)
      .map(({ n, days }) => ({ path: n.path, days })),
    reads7d,
    searches7d,
    cited30d: cited30d.size,
    outputRefs,
    hasSignals: signals.length > 0,
    embedding: config.embedding
      ? {
          keySource: resolveEmbeddingKey(root, config.embedding)?.source ?? null,
          vectors,
          secretsTracked: secretsTrackedByGit(root),
        }
      : undefined,
  };
}

function bar(part: number, total: number, width = 20): string {
  const filled = total === 0 ? 0 : Math.round((part / total) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function formatDoctor(r: DoctorReport): string {
  const pct = (n: number) => (r.total === 0 ? "0%" : `${Math.round((n / r.total) * 100)}%`);
  const lines = [
    `# 知识库体检`,
    ``,
    `总量 ${r.total} 条 · 未分诊 ${r.untriaged}（${pct(r.untriaged)}） · 孤儿 ${r.orphans}（${pct(r.orphans)}） · L0 ${r.l0}/${r.l0Cap}`,
    ``,
    `年龄分层（按最后触碰 + 反链）`,
    `  🟢 活跃/被引用   ${bar(r.active, r.total)} ${r.active} 条（${pct(r.active)}）`,
    `  🟡 衰退 >90 天   ${bar(r.decaying.length, r.total)} ${r.decaying.length} 条（${pct(r.decaying.length)}）`,
    `  ⚫ 沉睡 >1 年    ${bar(r.dormant.length, r.total)} ${r.dormant.length} 条（${pct(r.dormant.length)}）`,
  ];
  if (r.oldest.length > 0) {
    lines.push(``, `最久未动 top ${r.oldest.length}`);
    for (const o of r.oldest) lines.push(`  ${o.days} 天 — ${o.path}`);
  }
  lines.push(
    ``,
    r.hasSignals
      ? `门流量（近 7 天）：读取 ${r.reads7d} 次 · 检索 ${r.searches7d} 次`
      : `门流量：尚无信号——从现在起检索走 kb_search/kb_read，90 天后法医就有读取证据可用`
  );
  const absorbed = r.cited30d + r.outputRefs;
  lines.push(
    absorbed > 0
      ? `吸收：近 30 天 ${r.cited30d} 条被引用进产出${r.outputRefs > 0 ? `，另有 ${r.outputRefs} 条被创作库长期引用` : ""}（吸收率 ${pct(absorbed)}）——喂养了创造的部分`
      : `吸收：还没有笔记被引用进产出——存了不用，就只是图书管理员不是创作者`
  );
  if (r.embedding) {
    const e = r.embedding;
    const src =
      e.keySource === "env" ? "env（临时）" : e.keySource === "file" ? ".kb/secrets.json" : "❌ 未配置";
    lines.push(``, `语义层：向量覆盖 ${e.vectors}/${r.total} · key 来源 ${src}`);
    if (e.keySource === null)
      lines.push(`  ⚠️ 无 key，检索一直是纯字面——跑 \`kb key set\` 一次配好（CLI/MCP 共用）`);
    else if (e.vectors < r.total)
      lines.push(`  ${r.total - e.vectors} 条笔记还没有向量——跑 \`kb index\` 增量补齐`);
    if (e.secretsTracked)
      lines.push(`  🚨 .kb/secrets.json 被 git 跟踪，key 已进历史——立即 git rm --cached 并轮换 key`);
  }

  const deadWeight = r.dormant.length + r.decaying.length;
  lines.push(
    ``,
    deadWeight === 0
      ? `诊断：代谢健康，没有明显死重。`
      : `诊断：${deadWeight} 条（${pct(deadWeight)}）长期无人问津——它们让检索更吵、让你更不敢删。跑 kb triage 定层、kb digest 出名单，让代谢开始工作。`
  );
  return lines.join("\n");
}

/** digest 时留档：.kb/reports/health-YYYY-MM-DD.md */
export function saveDoctorReport(vault: Vault, r: DoctorReport): string {
  const file = path.join(reportsDir(vault.root), `health-${new Date().toISOString().slice(0, 10)}.md`);
  fs.mkdirSync(reportsDir(vault.root), { recursive: true });
  fs.writeFileSync(file, formatDoctor(r) + "\n");
  return file;
}
