import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { VAULT_ROOT, GRAVEYARD_DIR } from "./config.js";
import { runIndex } from "./indexer.js";

function git(args: string[]): string {
  return execFileSync("git", ["-C", VAULT_ROOT, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

const reportArg = process.argv[2];
if (!reportArg) {
  console.error("用法: npm run execute -- reports/kill-list-YYYY-MM-DD.md");
  process.exit(1);
}
const report = fs.readFileSync(path.resolve(reportArg), "utf8");

// 只处决被勾选的行：- [x] `path`
const approved: string[] = [];
for (const m of report.matchAll(/^- \[[xX]\] `([^`]+)`/gm)) {
  approved.push(m[1]);
}
if (approved.length === 0) {
  console.log("没有勾选任何条目，无事发生。");
  process.exit(0);
}

fs.mkdirSync(GRAVEYARD_DIR, { recursive: true });

// 保护：如果暂存区已有别的东西，拒绝自动 commit，避免误提交用户的暂存内容
let stagedClean = true;
try {
  git(["diff", "--cached", "--quiet"]);
} catch {
  stagedClean = false;
}

const moved: string[] = [];
for (const rel of approved) {
  const abs = path.join(VAULT_ROOT, rel);
  if (!fs.existsSync(abs)) {
    console.warn(`跳过（不存在）: ${rel}`);
    continue;
  }
  let dest = path.join(GRAVEYARD_DIR, path.basename(abs));
  if (fs.existsSync(dest)) {
    const d = new Date().toISOString().slice(0, 10);
    dest = path.join(GRAVEYARD_DIR, `${d}-${path.basename(abs)}`);
  }
  try {
    git(["mv", rel, path.relative(VAULT_ROOT, dest)]);
  } catch {
    fs.renameSync(abs, dest); // 未被 git 跟踪的文件
  }
  moved.push(rel);
  console.log(`处决: ${rel} → ${path.relative(VAULT_ROOT, dest)}`);
}

if (moved.length > 0 && stagedClean) {
  try {
    git(["commit", "-m", `kb: 处决 ${moved.length} 条 → _graveyard`, "--no-verify"]);
    console.log("已提交 vault 仓库（git 可反悔）。");
  } catch {
    console.warn("commit 失败（可能文件未被 git 跟踪），移动已完成。");
  }
} else if (!stagedClean) {
  console.warn("vault 暂存区有未提交内容，跳过自动 commit——请手动提交。");
}

const r = runIndex();
console.log(`索引已重建：${r.notes} 条笔记。`);
