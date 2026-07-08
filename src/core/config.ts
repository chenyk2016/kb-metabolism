import fs from "node:fs";
import path from "node:path";
import type { Vault, VaultConfig } from "./types.js";

export const KB_DIR = ".kb";

export const DEFAULT_CONFIG: VaultConfig = {
  managed: ["**/*.md"],
  exclude: ["_graveyard/**", ".kb/**", ".obsidian/**", "node_modules/**", "assets/**"],
  captureDir: ".",
  l0Cap: 100,
  inboxDays: 30,
  decayDays: 90,
  judgment: {
    provider: "human",
    triageModel: "claude-haiku-4-5",
    digestModel: "claude-opus-4-8",
  },
};

export function kbDir(root: string): string {
  return path.join(root, KB_DIR);
}
export function dbPath(root: string): string {
  return path.join(kbDir(root), "kb.db");
}
export function signalLogPath(root: string): string {
  return path.join(kbDir(root), "access.log.jsonl");
}
export function reportsDir(root: string): string {
  return path.join(kbDir(root), "reports");
}
export function graveyardDir(root: string): string {
  return path.join(root, "_graveyard");
}

/** walk up from startDir looking for a .kb/config.json */
export function findVaultRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, KB_DIR, "config.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadVault(explicitRoot?: string): Vault {
  const root = explicitRoot
    ? path.resolve(explicitRoot)
    : findVaultRoot(process.cwd());
  if (!root || !fs.existsSync(path.join(root, KB_DIR, "config.json"))) {
    throw new Error(
      "当前不在任何知识库内（向上找不到 .kb/config.json）——先运行 `kb init`，或用 --vault <目录> 指定"
    );
  }
  const raw = JSON.parse(
    fs.readFileSync(path.join(root, KB_DIR, "config.json"), "utf8")
  );
  const config: VaultConfig = {
    ...DEFAULT_CONFIG,
    ...raw,
    judgment: { ...DEFAULT_CONFIG.judgment, ...(raw.judgment ?? {}) },
  };
  return { root, config };
}

export function initVault(
  root: string,
  overrides: Partial<VaultConfig> = {}
): Vault {
  const config: VaultConfig = {
    ...DEFAULT_CONFIG,
    ...overrides,
    judgment: { ...DEFAULT_CONFIG.judgment, ...(overrides.judgment ?? {}) },
  };
  fs.mkdirSync(kbDir(root), { recursive: true });
  fs.mkdirSync(reportsDir(root), { recursive: true });
  fs.mkdirSync(graveyardDir(root), { recursive: true });
  fs.writeFileSync(
    path.join(kbDir(root), "config.json"),
    JSON.stringify(config, null, 2) + "\n"
  );
  // the sqlite index is derived and rebuildable — keep it out of git;
  // config, the signal log, and reports are state worth versioning
  fs.writeFileSync(path.join(kbDir(root), ".gitignore"), "kb.db\nkb.db-*\n");
  return { root: path.resolve(root), config };
}
