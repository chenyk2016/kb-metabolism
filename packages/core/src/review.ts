import fs from "node:fs";
import path from "node:path";
import { reportsDir } from "./config.js";
import type { Vault } from "./types.js";

/**
 * 交互式过堂：把"打开 md 手改勾选框"的摩擦降到 git add -p 级别。
 * 审批成本必须低于 5 分钟/周，否则法官弃庭、名单堆积、系统停摆。
 */

export function latestKillList(root: string): string | null {
  let latest: string | null = null;
  try {
    for (const f of fs.readdirSync(reportsDir(root))) {
      if (/^kill-list-\d{4}-\d{2}-\d{2}\.md$/.test(f) && (!latest || f > latest)) latest = f;
    }
  } catch {
    return null;
  }
  return latest ? path.join(reportsDir(root), latest) : null;
}

export type PendingItem = {
  line: number; // 报告中的行号（0-based）
  path: string;
  rest: string; // 破折号后的说明（层级/标题/理由）
};

export function parsePending(reportFile: string): { lines: string[]; items: PendingItem[] } {
  const lines = fs.readFileSync(reportFile, "utf8").split("\n");
  const items: PendingItem[] = [];
  lines.forEach((l, i) => {
    const m = l.match(/^- \[ \] `([^`]+)`\s*—?\s*(.*)$/);
    if (m) items.push({ line: i, path: m[1], rest: m[2] });
  });
  return { lines, items };
}

/** 判决预览用：直接 fs 读正文开头——判决不算使用信号，绝不能走门 */
export function notePreview(vault: Vault, rel: string, chars = 200): string {
  try {
    return fs
      .readFileSync(path.join(vault.root, rel), "utf8")
      .replace(/^---[\s\S]*?---/, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, chars);
  } catch {
    return "（文件已不存在）";
  }
}

export function approveLines(reportFile: string, lineNumbers: number[]): void {
  const lines = fs.readFileSync(reportFile, "utf8").split("\n");
  for (const i of lineNumbers) {
    lines[i] = lines[i].replace(/^- \[ \]/, "- [x]");
  }
  fs.writeFileSync(reportFile, lines.join("\n"));
}
