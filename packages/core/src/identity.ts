import crypto from "node:crypto";
import fs from "node:fs";
import matter from "gray-matter";

/**
 * 笔记身份：kb_id 是与路径无关的稳定身份——出生分配，终生不变。
 * 路径会随人整理目录而变（移动是日常动词），信号日志以 id 认领笔记，
 * 移动/重命名不再等于"旧身份死亡、信号清零"。
 */

export function newId(): string {
  return crypto.randomBytes(6).toString("base64url");
}

/** gray-matter 会把 yaml 日期解析成 Date；写回前转回纯日期串（与 chew/triage 同规） */
export function normalizeFmDates(data: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(data)) {
    if (v instanceof Date) data[k] = v.toISOString().slice(0, 10);
  }
}

/** 读 frontmatter 中的 kb_id；文件异常或缺失返回 null（信号照记，只是少 id 字段） */
export function readNoteId(absPath: string): string | null {
  try {
    const id = matter(fs.readFileSync(absPath, "utf8")).data?.kb_id;
    return typeof id === "string" && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}
