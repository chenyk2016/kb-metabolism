import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { openDb, notePathIdMap } from "./db.js";
import { reportsDir } from "./config.js";
import { readSignals, signalNoteKey } from "./signals.js";
import { addNote } from "./capture.js";
import type { NoteRow, Vault } from "./types.js";

/**
 * 消化：把反复被使用的 L1 资料提炼成 L0 判断。
 * 铁律：AI 是消化酶不是胃——拆解和提问可以自动，合成判断的最后一步必须是人。
 * 闭环：消化完的源 L1 标记 kb_digested，营养已进入 L0，之后自然衰亡让位。
 */

export type ChewCandidate = {
  path: string;
  title: string;
  useWhen: string | null;
  reads90d: number;
  head: string;
};

const MIN_READS = 2;

export function buildChewCandidates(vault: Vault): ChewCandidate[] {
  const db = openDb(vault.root);
  const notes = db
    .prepare("SELECT * FROM notes WHERE tier = 'L1'")
    .all() as NoteRow[];
  const pathToId = notePathIdMap(db);
  db.close();

  const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
  const reads = new Map<string, number>(); // 键 = 笔记 id
  for (const s of readSignals(vault.root)) {
    if (s.tool !== "kb_read" || s.ts < cutoff) continue;
    const key = signalNoteKey(s, pathToId);
    if (key) reads.set(key, (reads.get(key) ?? 0) + 1);
  }

  const candidates: ChewCandidate[] = [];
  for (const n of notes) {
    const r = (n.id ? reads.get(n.id) : undefined) ?? 0;
    if (r < MIN_READS) continue;
    let digested = false;
    let head = "";
    try {
      const raw = fs.readFileSync(path.join(vault.root, n.path), "utf8");
      const parsed = matter(raw);
      digested = parsed.data?.kb_digested === true;
      head = parsed.content.replace(/\s+/g, " ").trim().slice(0, 300);
    } catch {
      continue;
    }
    if (digested) continue; // 已消化过的不再上桌
    candidates.push({ path: n.path, title: n.title, useWhen: n.use_when, reads90d: r, head });
  }
  return candidates.sort((a, b) => b.reads90d - a.reads90d);
}

export function saveChewList(vault: Vault, candidates: ChewCandidate[]): string {
  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(reportsDir(vault.root), `chew-list-${date}.md`);
  const lines = [
    `# 消化名单 ${date}`,
    ``,
    `> 近 90 天被反复读取（≥${MIN_READS} 次）的 L1 资料——被使用说明有营养，`,
    `> 值得提炼成一句可复述的 L0 判断。运行 \`kb chew\` 逐条消化。`,
    ``,
  ];
  if (candidates.length === 0) lines.push("本期没有达到消化阈值的资料。");
  for (const c of candidates) {
    lines.push(`- \`${c.path}\` — ${c.title}｜近 90 天读 ${c.reads90d} 次${c.useWhen ? `｜${c.useWhen}` : ""}`);
  }
  fs.mkdirSync(reportsDir(vault.root), { recursive: true });
  fs.writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

/** 人合成判断后落成 L0 笔记：一句判断 + use_when + 证据链（行内 code，不产生反链） */
export function createL0(
  vault: Vault,
  judgment: string,
  useWhen: string,
  evidencePaths: string[]
): string {
  const db = openDb(vault.root);
  const l0Count = (
    db.prepare("SELECT COUNT(*) AS c FROM notes WHERE tier = 'L0'").get() as { c: number }
  ).c;
  db.close();
  if (l0Count >= vault.config.l0Cap) {
    throw new Error(
      `L0 已满（${l0Count}/${vault.config.l0Cap}）——硬上限。先在 kb digest 的挤位提案里淘汰一条，再收新判断。`
    );
  }

  const body =
    `${judgment.trim()}\n\n## 证据\n` +
    evidencePaths.map((p) => `- \`${p}\``).join("\n");
  const rel = addNote(vault, {
    title: judgment.trim().slice(0, 40),
    content: body,
    tier: "L0",
    useWhen,
  });

  // 源资料标记已消化：营养已进入 L0，之后无人再读可自然衰亡（人审时可放心处决）
  for (const p of evidencePaths) {
    try {
      const abs = path.join(vault.root, p);
      const parsed = matter(fs.readFileSync(abs, "utf8"));
      parsed.data.kb_digested = true;
      // gray-matter 会把 yaml 日期解析成 Date；写回前转回纯日期串
      for (const [k, val] of Object.entries(parsed.data)) {
        if (val instanceof Date) parsed.data[k] = val.toISOString().slice(0, 10);
      }
      fs.writeFileSync(abs, matter.stringify(parsed.content, parsed.data));
    } catch {
      // 源文件异常不阻断 L0 落盘
    }
  }
  return rel;
}
