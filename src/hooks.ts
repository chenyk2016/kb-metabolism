import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { openDb } from "./core/db.js";
import { hookSearch } from "./core/search.js";
import { appendSignal, readSignals } from "./core/signals.js";
import { getStats } from "./core/stats.js";
import { digestReminder } from "./core/reminder.js";
import type { Vault } from "./core/types.js";

/**
 * hooks 是门的第二形态：把"走门"从 agent 的选择变成管道的必然。
 * 纪律：hook 永不打断用户（任何异常静默退出）、不够相关就沉默（零输出=不注入）、
 * 注入记 kb_inject 信号但法医不认（机器注入 ≠ 人在使用，不给续命）。
 */

async function readStdinJson(): Promise<Record<string, unknown>> {
  try {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

/** UserPromptSubmit：按本条 prompt 检索，相关则注入摘要 */
export async function hookPrompt(vault: Vault): Promise<void> {
  const input = await readStdinJson();
  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  if ([...prompt.trim()].length < 4) return;

  const db = openDb(vault.root);
  const hits = hookSearch(db, prompt, 3);
  db.close();
  if (hits.length === 0) return;

  for (const h of hits) {
    appendSignal(vault.root, { tool: "kb_inject", query: prompt.slice(0, 80), path: h.path });
  }

  const lines = [
    "<kb-context>",
    "个人知识库中与本问题相关的笔记（自动注入的摘要）：",
    ...hits.map((h) => `- ${h.path} — ${h.title}：${h.snip}`),
    "如需全文用 kb_read 读取（读取是笔记的续命信号）；回答涉及个人积累时优先引用这些笔记。",
    "</kb-context>",
  ];
  process.stdout.write(lines.join("\n") + "\n");
}

/** SessionStart：库概况 + 消化提醒 + 最近走门读过的（会话连续性） */
export async function hookSession(vault: Vault): Promise<void> {
  await readStdinJson(); // 消费 stdin，内容不需要
  const s = getStats(vault);
  if (s.total === 0) return;

  const lines = ["<kb-status>", `个人知识库：${s.total} 条（L0 ${s.l0}/${s.l0Cap}）——检索走 kb_search，读取走 kb_read。`];

  const recentReads: string[] = [];
  const seen = new Set<string>();
  for (const sig of readSignals(vault.root).reverse()) {
    if (sig.tool === "kb_read" && sig.path && !seen.has(sig.path)) {
      seen.add(sig.path);
      recentReads.push(sig.path);
      if (recentReads.length >= 3) break;
    }
  }
  if (recentReads.length > 0) lines.push(`最近读过：${recentReads.join("、")}`);

  const reminder = digestReminder(vault.root);
  if (reminder) lines.push(`${reminder}（请转告用户）`);

  lines.push("</kb-status>");
  process.stdout.write(lines.join("\n") + "\n");
}

// ── 安装/卸载 ─────────────────────────────────────────

type HookEntry = { matcher?: string; hooks: Array<{ type: "command"; command: string }> };
type Settings = { hooks?: Record<string, HookEntry[]> } & Record<string, unknown>;

const MARKER = "kb-metabolism";

function hookCommands(vaultRoot: string): { prompt: string; session: string } {
  const cliJs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "cli.js");
  const base = `"${process.execPath}" "${cliJs}"`;
  return {
    prompt: `${base} hook prompt --vault "${vaultRoot}"`,
    session: `${base} hook session --vault "${vaultRoot}"`,
  };
}

export function settingsPath(scope: "user" | "project"): string {
  return scope === "user"
    ? path.join(os.homedir(), ".claude", "settings.json")
    : path.join(process.cwd(), ".claude", "settings.json");
}

function isOurs(e: HookEntry): boolean {
  return e.hooks?.some((h) => h.command?.includes(MARKER) && / hook (prompt|session) /.test(h.command));
}

export function buildHookConfig(vaultRoot: string): Record<string, HookEntry[]> {
  const cmd = hookCommands(vaultRoot);
  return {
    UserPromptSubmit: [{ hooks: [{ type: "command", command: cmd.prompt }] }],
    SessionStart: [{ hooks: [{ type: "command", command: cmd.session }] }],
  };
}

export function installHooks(vaultRoot: string, scope: "user" | "project"): string {
  const file = settingsPath(scope);
  let settings: Settings = {};
  if (fs.existsSync(file)) {
    settings = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.copyFileSync(file, file + ".bak");
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  settings.hooks = settings.hooks ?? {};
  const ours = buildHookConfig(vaultRoot);
  for (const [event, entries] of Object.entries(ours)) {
    const existing = (settings.hooks[event] ?? []).filter((e) => !isOurs(e)); // 幂等：替换旧的 kb 条目
    settings.hooks[event] = [...existing, ...entries];
  }
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
  return file;
}

export function uninstallHooks(scope: "user" | "project"): string | null {
  const file = settingsPath(scope);
  if (!fs.existsSync(file)) return null;
  const settings: Settings = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!settings.hooks) return null;
  fs.copyFileSync(file, file + ".bak");
  for (const event of Object.keys(settings.hooks)) {
    settings.hooks[event] = (settings.hooks[event] ?? []).filter((e) => !isOurs(e));
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
  return file;
}
