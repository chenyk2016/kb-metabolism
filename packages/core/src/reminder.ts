import fs from "node:fs";
import path from "node:path";
import { reportsDir } from "./config.js";
import { openDb } from "./db.js";

/**
 * 门上闹钟：系统不能靠自觉（这正是本产品的立论），所以把消化节律
 * 寄生在最高频的接触点——检索门上。无新状态：上次消化时间就是
 * reports/ 里最新 kill-list 的日期。
 */
const CADENCE_DAYS = 7;

export function digestReminder(root: string): string | null {
  let latest: string | null = null;
  try {
    for (const f of fs.readdirSync(reportsDir(root))) {
      const m = f.match(/^kill-list-(\d{4}-\d{2}-\d{2})\.md$/);
      if (m && (!latest || m[1] > latest)) latest = m[1];
    }
  } catch {
    // reports 目录不存在 = 从未消化
  }

  if (!latest) {
    const db = openDb(root);
    const n = (db.prepare("SELECT COUNT(*) AS c FROM notes").get() as { c: number }).c;
    db.close();
    if (n === 0) return null;
    return `⚠️ 这个库还从未消化过——跑一次 kb digest，让法医看看有没有该清的`;
  }

  const days = Math.floor((Date.now() - new Date(latest).getTime()) / 86400000);
  if (days <= CADENCE_DAYS) return null;
  return `⚠️ 距上次消化已 ${days} 天（建议每周一次）——kb digest 出名单，kb review 过堂`;
}
