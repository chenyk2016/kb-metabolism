import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { openDb, type NoteRow } from "./db.js";
import { VAULT_ROOT, REPORTS_DIR, DECAY_DAYS } from "./config.js";

/** git 最后修改时间（vault 仓库），fallback 文件 mtime */
function lastTouched(rel: string): Date {
  try {
    const out = execFileSync(
      "git",
      ["-C", VAULT_ROOT, "log", "-1", "--format=%cI", "--", rel],
      { encoding: "utf8" }
    ).trim();
    if (out) return new Date(out);
  } catch {
    // vault 非 git 仓库或文件未跟踪
  }
  return fs.statSync(path.join(VAULT_ROOT, rel)).mtime;
}

type Candidate = { path: string; title: string; tier: string; reasons: string[] };

export function runCoroner(): { report: string; candidates: number } {
  const db = openDb();
  const today = new Date();
  const days = (d: Date) => Math.floor((today.getTime() - d.getTime()) / 86400000);

  const notes = db
    .prepare("SELECT * FROM notes WHERE tier IS NULL OR tier != 'L0'")
    .all() as NoteRow[];

  const backlinkStmt = db.prepare("SELECT COUNT(*) AS c FROM links WHERE dst = ?");
  const lastReadStmt = db.prepare(
    "SELECT MAX(ts) AS t FROM access_log WHERE tool='kb_read' AND path = ?"
  );

  const candidates: Candidate[] = [];
  for (const n of notes) {
    const tier = n.tier ?? "未分诊";
    const reasons: string[] = [];

    // inbox 层：过期即候选
    if (n.tier === "inbox" && n.expires && n.expires < today.toISOString().slice(0, 10)) {
      reasons.push(`inbox 已过期（${n.expires}）`);
    } else {
      // L1 / 未分诊：三信号全零
      const backlinks = (backlinkStmt.get(n.path) as { c: number }).c;
      const lastRead = (lastReadStmt.get(n.path) as { t: string | null }).t;
      const touched = lastTouched(n.path);
      const age = days(touched);
      const readOk = lastRead && days(new Date(lastRead)) <= DECAY_DAYS;
      if (backlinks === 0 && !readOk && age > DECAY_DAYS) {
        reasons.push(
          `0 反链`,
          lastRead ? `最后读取已超 ${DECAY_DAYS} 天` : `访问日志零读取`,
          `git ${age} 天未动`
        );
      }
    }
    if (reasons.length > 0) {
      candidates.push({ path: n.path, title: n.title, tier, reasons });
    }
  }
  db.close();

  const date = today.toISOString().slice(0, 10);
  const file = path.join(REPORTS_DIR, `kill-list-${date}.md`);
  const lines = [
    `# 处决名单 ${date}`,
    "",
    `> 判定规则见 docs/protocol.md。勾选 \`[x]\` 表示批准处决（git mv 到 _graveyard/），`,
    `> 然后运行：\`npm run execute -- reports/kill-list-${date}.md\``,
    `> AI 只提案，人是法官。不勾选 = 赦免（下周会再上榜，除非它获得使用信号）。`,
    "",
  ];
  if (candidates.length === 0) {
    lines.push("本周无候选。代谢健康。");
  } else {
    for (const c of candidates) {
      lines.push(`- [ ] \`${c.path}\` — [${c.tier}] ${c.title}｜${c.reasons.join("；")}`);
    }
  }
  lines.push("");
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(file, lines.join("\n"));
  return { report: file, candidates: candidates.length };
}

const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) {
  const r = runCoroner();
  console.log(`处决名单：${r.candidates} 条候选 → ${r.report}`);
}
