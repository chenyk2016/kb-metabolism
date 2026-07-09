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

/** most recent timestamp per note path for a given tool */
export function lastByTool(root: string, tool: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of readSignals(root)) {
    if (s.tool === tool && s.path) {
      const prev = map.get(s.path);
      if (!prev || s.ts > prev) map.set(s.path, s.ts);
    }
  }
  return map;
}

/** most recent read timestamp per note path */
export function lastReadByPath(root: string): Map<string, string> {
  return lastByTool(root, "kb_read");
}
