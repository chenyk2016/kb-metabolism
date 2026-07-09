import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { openDb, notePathIdMap } from "./db.js";
import { reportsDir } from "./config.js";
import { lastByNoteId } from "./signals.js";
import type { NoteRow, Vault } from "./types.js";

/** last touched via git history (if the vault is a repo), else file mtime */
function lastTouched(root: string, rel: string): Date {
  try {
    const out = execFileSync(
      "git",
      ["-C", root, "log", "-1", "--format=%cI", "--", rel],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
    if (out) return new Date(out);
  } catch {
    // not a git repo or file untracked
  }
  return fs.statSync(path.join(root, rel)).mtime;
}

export type Candidate = {
  path: string;
  title: string;
  tier: string;
  reasons: string[];
};

export type CoronerResult = { report: string; candidates: Candidate[] };

/**
 * The coroner is pure data — it never deletes anything. It proposes; the
 * human is the judge. A note lands on the kill list when every usage signal
 * is dead, or when its inbox grace period has expired.
 */
export function runCoroner(vault: Vault): CoronerResult {
  const { root, config } = vault;
  const db = openDb(root);
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const days = (d: Date) => Math.floor((today.getTime() - d.getTime()) / 86400000);

  const notes = db
    .prepare("SELECT * FROM notes WHERE tier IS NULL OR tier != 'L0'")
    .all() as NoteRow[];
  const backlinkStmt = db.prepare("SELECT COUNT(*) AS c FROM links WHERE dst = ?");
  const pathToId = notePathIdMap(db);
  const lastRead = lastByNoteId(root, "kb_read", pathToId);
  const lastCite = lastByNoteId(root, "kb_cite", pathToId);
  const citeDays = config.citeDays ?? 180;

  const candidates: Candidate[] = [];
  for (const n of notes) {
    const tier = n.tier ?? "未分诊";
    const reasons: string[] = [];

    if (n.tier === "inbox" && n.expires && n.expires < todayStr) {
      reasons.push(`inbox 已过期（${n.expires}）`);
    } else {
      const backlinks = (backlinkStmt.get(n.path) as { c: number }).c;
      const read = n.id ? lastRead.get(n.id) : undefined;
      const readAlive = read && days(new Date(read)) <= config.decayDays;
      // 被引用进产出是最高等级存活证据——免死窗口是读取的两倍
      const cite = n.id ? lastCite.get(n.id) : undefined;
      const citeAlive = cite && days(new Date(cite)) <= citeDays;
      const age = days(lastTouched(root, n.path));
      if (backlinks === 0 && !readAlive && !citeAlive && age > config.decayDays) {
        reasons.push(
          "0 反链",
          read ? `最后读取已超 ${config.decayDays} 天` : "从未经门读取",
          cite ? `最后被引用已超 ${citeDays} 天` : "从未被引用进产出",
          `${age} 天未动`
        );
      }
    }
    if (reasons.length > 0) {
      candidates.push({ path: n.path, title: n.title, tier, reasons });
    }
  }
  db.close();

  const file = path.join(reportsDir(root), `kill-list-${todayStr}.md`);
  const lines = [
    `# 处决名单 ${todayStr}`,
    "",
    `> 勾选 \`[x]\` 表示批准处决（git mv 到 _graveyard/），然后运行：`,
    `> \`kb execute ${path.relative(process.cwd(), file) || file}\``,
    `> AI 只提案，人是法官。不勾选 = 赦免`,
    `> （除非它获得使用信号，否则下周会再上榜）。`,
    "",
  ];
  if (candidates.length === 0) {
    lines.push("本期无候选。代谢健康。");
  } else {
    for (const c of candidates) {
      lines.push(`- [ ] \`${c.path}\` — [${c.tier}] ${c.title} | ${c.reasons.join("; ")}`);
    }
  }
  lines.push("");
  fs.mkdirSync(reportsDir(root), { recursive: true });
  fs.writeFileSync(file, lines.join("\n"));
  return { report: file, candidates };
}
