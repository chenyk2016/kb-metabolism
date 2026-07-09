import fs from "node:fs";
import { signalLogPath } from "./config.js";
import type { Signal } from "./types.js";

/**
 * The access log is the only non-reproducible data in the system — it is the
 * metabolic signal. It lives as an append-only JSONL file so it travels with
 * the vault, diffs cleanly in git, and survives any index rebuild.
 */
export function appendSignal(root: string, signal: Omit<Signal, "ts">): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...signal });
  fs.appendFileSync(signalLogPath(root), line + "\n");
}

export function readSignals(root: string): Signal[] {
  const file = signalLogPath(root);
  if (!fs.existsSync(file)) return [];
  const out: Signal[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // tolerate a torn line; the log is append-only so this is rare
    }
  }
  return out;
}

/**
 * 信号认领：以笔记稳定身份（kb_id）为键。
 * 新信号行自带 id；无 id 的历史行按"记录时路径 = 当前路径"经 pathToId 兜底认领
 * （笔记移动后历史行失联——用 `kb migrate-signals` 一次性补 id 即可根治）。
 */
export function signalNoteKey(s: Signal, pathToId: Map<string, string>): string | null {
  if (s.id) return s.id;
  if (s.path) return pathToId.get(s.path) ?? null;
  return null;
}

/** most recent timestamp per note id for a given tool */
export function lastByNoteId(
  root: string,
  tool: string,
  pathToId: Map<string, string>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of readSignals(root)) {
    if (s.tool !== tool) continue;
    const key = signalNoteKey(s, pathToId);
    if (!key) continue;
    const prev = map.get(key);
    if (!prev || s.ts > prev) map.set(key, s.ts);
  }
  return map;
}
