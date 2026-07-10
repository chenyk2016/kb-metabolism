import fs from "node:fs";
import path from "node:path";
import { openDb, notePathIdMap } from "./db.js";
import { reportsDir } from "./config.js";
import { contentAgeMap } from "./age.js";
import { lastByNoteId } from "./signals.js";
import type { NoteRow, Vault } from "./types.js";

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
 *
 * 存活证据（任一即赦免）：
 *   活反链（链接来源自身活着，或来自创作目录）> cite 180 天 > read 90 天 > inject 30 天
 * 年龄口径 = 最后真实内容变更（rename 与批量提交不算触碰，见 age.ts）。
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
  const linkRows = db
    .prepare("SELECT src, dst, from_output FROM links")
    .all() as Array<{ src: string; dst: string; from_output: number }>;
  const pathToId = notePathIdMap(db);
  db.close();

  const lastRead = lastByNoteId(root, "kb_read", pathToId);
  const lastCite = lastByNoteId(root, "kb_cite", pathToId);
  const lastInject = lastByNoteId(root, "kb_inject", pathToId);
  const citeDays = config.citeDays ?? 180;
  const injectDays = config.injectDays ?? 30;

  const ages = contentAgeMap(root, config.bulkCommitThreshold ?? 30);
  const lastTouched = (rel: string): Date => {
    const iso = ages?.get(rel);
    if (iso) return new Date(iso);
    try {
      return fs.statSync(path.join(root, rel)).mtime; // 非 git / 未跟踪文件
    } catch {
      return new Date(0);
    }
  };

  const signalAlive = (id: string | null): boolean => {
    if (!id) return false;
    const r = lastRead.get(id);
    if (r && days(new Date(r)) <= config.decayDays) return true;
    const c = lastCite.get(id);
    if (c && days(new Date(c)) <= citeDays) return true;
    const inj = lastInject.get(id);
    if (inj && days(new Date(inj)) <= injectDays) return true;
    return false;
  };

  // 活源担保：只有自身活着的来源（近期被编辑或有信号）发出的链接才豁免；
  // 创作目录的引用是铁证，永远算。只算一层——死簇互链同批上榜。
  const srcAliveCache = new Map<string, boolean>();
  const srcAlive = (src: string): boolean => {
    let alive = srcAliveCache.get(src);
    if (alive !== undefined) return alive;
    alive =
      days(lastTouched(src)) <= config.decayDays || signalAlive(pathToId.get(src) ?? null);
    srcAliveCache.set(src, alive);
    return alive;
  };
  const liveBacklinks = new Map<string, number>();
  const deadBacklinks = new Map<string, number>();
  for (const l of linkRows) {
    const target = l.from_output === 1 || srcAlive(l.src) ? liveBacklinks : deadBacklinks;
    target.set(l.dst, (target.get(l.dst) ?? 0) + 1);
  }

  const candidates: Candidate[] = [];
  for (const n of notes) {
    const tier = n.tier ?? "未分诊";
    const reasons: string[] = [];

    if (n.tier === "inbox" && n.expires && n.expires < todayStr) {
      reasons.push(`inbox 已过期（${n.expires}）`);
    } else {
      const live = liveBacklinks.get(n.path) ?? 0;
      const dead = deadBacklinks.get(n.path) ?? 0;
      const read = n.id ? lastRead.get(n.id) : undefined;
      const readAlive = read && days(new Date(read)) <= config.decayDays;
      // 被引用进产出是最高等级存活证据——免死窗口是读取的两倍
      const cite = n.id ? lastCite.get(n.id) : undefined;
      const citeAlive = cite && days(new Date(cite)) <= citeDays;
      // hook 注入且真相关（idf 加权判准）= 第三档存活证据
      const inject = n.id ? lastInject.get(n.id) : undefined;
      const injectAlive = inject && days(new Date(inject)) <= injectDays;
      const age = days(lastTouched(n.path));
      if (live === 0 && !readAlive && !citeAlive && !injectAlive && age > config.decayDays) {
        reasons.push(
          dead > 0 ? `0 活反链（另有 ${dead} 条链接来自死源）` : "0 反链",
          read ? `最后读取已超 ${config.decayDays} 天` : "从未经门读取",
          cite ? `最后被引用已超 ${citeDays} 天` : "从未被引用进产出",
          inject ? `最后注入已超 ${injectDays} 天` : "从未被注入",
          `${age} 天未动`
        );
      }
    }
    if (reasons.length > 0) {
      candidates.push({ path: n.path, title: n.title, tier, reasons });
    }
  }

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
