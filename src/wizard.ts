import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { LineReader } from "./judgment/human.js";
import type { EmbeddingConfig } from "./core/types.js";

/**
 * init 交互向导：把"配 globs → git → 注册 MCP → 配语义检索"的五步上手税压成一次问答。
 * 原则：能探测的绝不问——Obsidian、目录结构、git、claude CLI 都靠探测；
 * 只问四个真正需要人拍板的问题，每个都有安全默认值（EOF/回车=默认）。
 */

export type WizardResult = {
  managed: string[];
  captureDir: string;
  wantGit: boolean;
  wantMcp: boolean;
  embedding?: EmbeddingConfig;
};

type TopDir = { name: string; mdCount: number };

function countMd(dir: string): number {
  let n = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "_graveyard" || e.name === "node_modules") continue;
    if (e.isDirectory()) n += countMd(path.join(dir, e.name));
    else if (e.isFile() && e.name.endsWith(".md")) n++;
  }
  return n;
}

function listTopDirs(root: string): { dirs: TopDir[]; rootMd: number } {
  const dirs: TopDir[] = [];
  let rootMd = 0;
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "_graveyard" || e.name === "node_modules") continue;
    if (e.isDirectory()) {
      const c = countMd(path.join(root, e.name));
      if (c > 0) dirs.push({ name: e.name, mdCount: c });
    } else if (e.isFile() && e.name.endsWith(".md")) rootMd++;
  }
  dirs.sort((a, b) => b.mdCount - a.mdCount);
  return { dirs, rootMd };
}

export function isGitRepo(root: string): boolean {
  try {
    execFileSync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function hasClaudeCli(): boolean {
  try {
    execFileSync("which", ["claude"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export async function runWizard(root: string): Promise<WizardResult> {
  const reader = new LineReader();
  try {
    const isObsidian = fs.existsSync(path.join(root, ".obsidian"));
    const { dirs, rootMd } = listTopDirs(root);
    const total = dirs.reduce((s, d) => s + d.mdCount, 0) + rootMd;

    console.log(`\n在 ${root} 建库`);
    if (isObsidian) console.log("检测到 Obsidian vault ✓（笔记保持原样，系统只加 .kb/ 和 frontmatter）");
    console.log(`共找到 ${total} 篇 markdown`);

    // ── 问题 1：管理范围 ─────────────────────────────
    let managed = ["**/*.md"];
    let captureDir = ".";
    if (dirs.length > 0) {
      console.log(`\n顶层目录（按笔记数排序）：`);
      dirs.forEach((d, i) => console.log(`  [${i + 1}] ${d.name}/ — ${d.mdCount} 篇`));
      if (rootMd > 0) console.log(`  （根目录另有 ${rootMd} 篇）`);
      console.log(`提示：日记/剪藏类目录建议不纳入管理——不受代谢约束，但它们的引用仍算续命信号`);
      const ans = (
        await reader.ask(`哪些目录纳入代谢管理？[回车]=全库，或输编号（逗号分隔，如 1,3）> `)
      ).trim();
      if (ans) {
        const picked = ans
          .split(/[,，\s]+/)
          .map((s) => dirs[parseInt(s, 10) - 1])
          .filter(Boolean);
        if (picked.length > 0) {
          managed = picked.map((d) => `${d.name}/**/*.md`);
          captureDir = picked[0].name;
        }
      }
    }

    // ── 问题 2：git ─────────────────────────────────
    let wantGit = false;
    if (isGitRepo(root)) {
      console.log(`\ngit 仓库 ✓（处决的反悔按钮已就位）`);
    } else {
      const ans = (
        await reader.ask(`\n这里不是 git 仓库。初始化 git？（处决可一键反悔）[Y/n] > `)
      ).trim().toLowerCase();
      wantGit = ans === "" || ans === "y" || ans === "yes";
    }

    // ── 问题 3：MCP 注册 ─────────────────────────────
    let wantMcp = false;
    if (hasClaudeCli()) {
      const ans = (
        await reader.ask(`检测到 Claude Code。把检索门注册给它（user 级，所有会话可用）？[Y/n] > `)
      ).trim().toLowerCase();
      wantMcp = ans === "" || ans === "y" || ans === "yes";
    }

    // ── 问题 4：语义检索 ─────────────────────────────
    let embedding: EmbeddingConfig | undefined;
    const ans = (
      await reader.ask(
        `开启语义检索（跨越"搜'电话'找不到'手机号'"的词汇鸿沟）？\n需要任一 OpenAI 兼容 embedding 服务（硅基流动/OpenAI/Ollama），没有可跳过 [y/N] > `
      )
    ).trim().toLowerCase();
    if (ans === "y" || ans === "yes") {
      const baseUrl =
        (await reader.ask(`服务地址 [回车=硅基流动 https://api.siliconflow.cn/v1] > `)).trim() ||
        "https://api.siliconflow.cn/v1";
      const model = (await reader.ask(`模型 [回车=BAAI/bge-m3] > `)).trim() || "BAAI/bge-m3";
      embedding = { baseUrl, model, apiKeyEnv: "KB_EMBEDDING_API_KEY" };
    }

    return { managed, captureDir, wantGit, wantMcp, embedding };
  } finally {
    reader.close();
  }
}
