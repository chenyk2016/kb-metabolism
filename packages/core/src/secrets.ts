import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { kbDir } from "./config.js";
import type { EmbeddingConfig } from "./types.js";

/**
 * 配置与秘密分家：config.json 进 git（系统怎么工作），secrets.json 永不进 git（你是谁）。
 * 解析链一处实现、全调用点（CLI / MCP / cron / hooks）统一：
 *   env[apiKeyEnv]（临时覆盖）→ .kb/secrets.json（0600、gitignored）→ 无 key（调用方显式降级）
 * env 继承链不是可靠的分发通道，文件系统才是所有进程的公共通道。
 */

export function secretsPath(root: string): string {
  return path.join(kbDir(root), "secrets.json");
}

export type ResolvedKey = { key: string; source: "env" | "file" };

export function resolveEmbeddingKey(
  root: string,
  cfg: EmbeddingConfig
): ResolvedKey | null {
  const envName = cfg.apiKeyEnv ?? "KB_EMBEDDING_API_KEY";
  const fromEnv = process.env[envName];
  if (fromEnv?.trim()) return { key: fromEnv.trim(), source: "env" };
  try {
    const json = JSON.parse(fs.readFileSync(secretsPath(root), "utf8")) as Record<
      string,
      unknown
    >;
    const v = json[envName];
    if (typeof v === "string" && v.trim()) return { key: v.trim(), source: "file" };
  } catch {
    // 文件不存在或损坏都视为无 key
  }
  return null;
}

export function requireEmbeddingKey(root: string, cfg: EmbeddingConfig): string {
  const resolved = resolveEmbeddingKey(root, cfg);
  if (!resolved) {
    const envName = cfg.apiKeyEnv ?? "KB_EMBEDDING_API_KEY";
    throw new Error(
      `缺少 embedding API key：跑 \`kb key set\` 一次配好（写入 .kb/secrets.json，不进 git），或临时 export ${envName}`
    );
  }
  return resolved.key;
}

export function writeSecret(root: string, name: string, value: string): string {
  const file = secretsPath(root);
  let json: Record<string, string> = {};
  try {
    json = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // 新建
  }
  json[name] = value;
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n", { mode: 0o600 });
  fs.chmodSync(file, 0o600); // writeFileSync 的 mode 只在新建时生效
  ensureGitignore(root);
  return file;
}

/** 确保 .kb/.gitignore 覆盖 secrets.json（幂等） */
export function ensureGitignore(root: string): void {
  const gi = path.join(kbDir(root), ".gitignore");
  let content = "";
  try {
    content = fs.readFileSync(gi, "utf8");
  } catch {
    // 无 .gitignore，新建
  }
  if (!content.split("\n").some((l) => l.trim() === "secrets.json")) {
    fs.writeFileSync(gi, content.replace(/\n*$/, content ? "\n" : "") + "secrets.json\n");
  }
}

/** secrets.json 是否已被 git 跟踪——事故检测：意味着 key 已进历史，需 git rm --cached 并轮换 */
export function secretsTrackedByGit(root: string): boolean {
  try {
    execFileSync(
      "git",
      ["-C", root, "ls-files", "--error-unmatch", path.relative(root, secretsPath(root))],
      { stdio: "ignore" }
    );
    return true;
  } catch {
    return false;
  }
}
