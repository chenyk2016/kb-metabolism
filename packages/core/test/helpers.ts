import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initVault, runIndex, type Vault } from "../src/index.js";

/** 一次性测试 vault：真实文件系统（协议的真相层就是文件，不 mock） */
export async function makeVault(
  notes: Record<string, string> = {}
): Promise<{ vault: Vault; root: string; cleanup: () => void }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kb-test-"));
  const vault = initVault(root);
  for (const [rel, content] of Object.entries(notes)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  await runIndex(vault);
  return { vault, root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

export function fm(data: Record<string, string>, body: string): string {
  const lines = Object.entries(data).map(([k, v]) => `${k}: "${v}"`);
  return `---\n${lines.join("\n")}\n---\n${body}\n`;
}

export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

export function dateStr(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 86400000).toISOString().slice(0, 10);
}
