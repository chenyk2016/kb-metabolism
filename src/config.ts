import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HOME = os.homedir();

/** vault 根目录（反链信号扫描范围 = 全 vault） */
export const VAULT_ROOT =
  process.env.KB_VAULT_ROOT ?? path.join(HOME, ".openclaw/shared/notes/content");

/** 被代谢管理的范围（首期只管 00-my-inbox） */
export const MANAGED_DIR =
  process.env.KB_MANAGED_DIR ?? path.join(VAULT_ROOT, "00-my-inbox");

/** L2 墓地 */
export const GRAVEYARD_DIR = path.join(MANAGED_DIR, "_graveyard");

export const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

export const DB_PATH =
  process.env.KB_DB_PATH ?? path.join(PROJECT_ROOT, "data", "kb.db");

export const REPORTS_DIR = path.join(PROJECT_ROOT, "reports");

/** L0 核心层硬上限 */
export const L0_CAP = 100;

/** 零信号判定窗口（天） */
export const DECAY_DAYS = 90;
