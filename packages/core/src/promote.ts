import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { openDb } from "./db.js";
import { normalizeFmDates } from "./identity.js";
import type { Vault } from "./types.js";

/**
 * 晋升通道：inbox/未分诊 → L1/L0，L1 → L0。只向上，不降级——
 * 挤掉 L0 仍是消化仪式里的显式人工编辑，不是这里的职权。
 * 入口税照收：不给 use_when 一律拒绝（手改 frontmatter 绕税的洞在这里堵上）。
 * 纯文件操作，调用方负责 runIndex。
 */

const RANK: Record<string, number> = { inbox: 0, L1: 1, L0: 2 };

export type PromoteResult = { path: string; from: string; tier: "L0" | "L1" };

export function promoteNote(
  vault: Vault,
  rel: string,
  tier: "L0" | "L1",
  useWhen: string
): PromoteResult {
  if (!useWhen?.trim()) {
    throw new Error(`升级必须提供 use_when（"什么时候会再用到？"）——入口税，晋升也不豁免`);
  }
  const abs = path.resolve(vault.root, rel);
  const relNorm = path.relative(vault.root, abs);
  if (relNorm.startsWith("..")) throw new Error("路径越界：只能操作知识库内的笔记");
  if (!fs.existsSync(abs)) throw new Error(`不存在：${relNorm}`);

  const parsed = matter(fs.readFileSync(abs, "utf8"));
  const from = typeof parsed.data.kb_tier === "string" ? parsed.data.kb_tier : "未分诊";
  const fromRank = RANK[from] ?? -1; // 未分诊排在最底
  if (from === tier) throw new Error(`已是 ${tier} 层，无需升级`);
  if (RANK[tier] < fromRank) {
    throw new Error(`只升不降：${from} → ${tier} 不是晋升（挤位降级请直接编辑 frontmatter）`);
  }

  if (tier === "L0") {
    const db = openDb(vault.root);
    const l0Count = (
      db.prepare("SELECT COUNT(*) AS c FROM notes WHERE tier = 'L0'").get() as { c: number }
    ).c;
    db.close();
    if (l0Count >= vault.config.l0Cap) {
      throw new Error(
        `L0 已满（${l0Count}/${vault.config.l0Cap}）——硬上限。先挤掉一条，再收新判断。`
      );
    }
  }

  parsed.data.kb_tier = tier;
  parsed.data.kb_use_when = useWhen.trim();
  parsed.data.kb_triaged = new Date().toISOString().slice(0, 10);
  delete parsed.data.kb_expires; // 晋升即脱离 inbox 大限
  normalizeFmDates(parsed.data);
  fs.writeFileSync(abs, matter.stringify(parsed.content, parsed.data));
  return { path: relNorm, from, tier };
}
