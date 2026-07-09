#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import { initVault, loadVault, kbDir, signalLogPath } from "./core/config.js";
import { runIndex } from "./core/indexer.js";
import { openDb } from "./core/db.js";
import { hybridSearch, noResultHint } from "./core/search.js";
import { appendSignal } from "./core/signals.js";
import { runCoroner } from "./core/coroner.js";
import { executeReport } from "./core/executor.js";
import { addNote } from "./core/capture.js";
import { applyDecision } from "./core/frontmatter.js";
import { getStats, formatStats } from "./core/stats.js";
import { digestReminder } from "./core/reminder.js";
import { runDoctor, formatDoctor, saveDoctorReport } from "./core/doctor.js";
import { latestKillList, parsePending, notePreview, approveLines } from "./core/review.js";
import { serve } from "./mcp/server.js";
import { humanTriage, confirm, LineReader, type UntriagedNote } from "./judgment/human.js";
import { runWizard, isGitRepo, type WizardResult } from "./wizard.js";
import { hookPrompt, hookSession, installHooks, uninstallHooks, buildHookConfig } from "./hooks.js";
import { emitTriagePrompt, emitDigestPrompt } from "./judgment/agent.js";
import type { TierDecision, Vault } from "./core/types.js";

const program = new Command();
program
  .name("kb")
  .description("kb-metabolism 知识代谢系统——一个会遗忘的知识库")
  .version("0.2.0")
  .option("--vault <dir>", "知识库根目录（默认从当前目录向上找 .kb/）");

function vault(): Vault {
  return loadVault(program.opts().vault);
}

function untriagedNotes(v: Vault, limit?: number): UntriagedNote[] {
  const db = openDb(v.root);
  const rows = db
    .prepare("SELECT path, title FROM notes WHERE tier IS NULL ORDER BY path" + (limit ? " LIMIT ?" : ""))
    .all(...(limit ? [limit] : [])) as Array<{ path: string; title: string }>;
  db.close();
  return rows.map((r) => {
    let head = "";
    try {
      head = fs
        .readFileSync(path.join(v.root, r.path), "utf8")
        .replace(/^---[\s\S]*?---/, "")
        .trim()
        .slice(0, 400);
    } catch {
      // 文件读不了就只凭标题分诊
    }
    return { path: r.path, title: r.title, head };
  });
}

async function applyDecisions(v: Vault, decisions: TierDecision[]): Promise<void> {
  for (const d of decisions) applyDecision(v, d);
  const r = await runIndex(v);
  console.log(`\n已应用 ${decisions.length} 条决定；当前层级分布：`, r.tiers);
}

function gitInit(root: string): void {
  execFileSync("git", ["-C", root, "init", "-q"]);
  execFileSync("git", ["-C", root, "add", "-A"]);
  try {
    execFileSync("git", ["-C", root, "commit", "-qm", "kb: init vault", "--no-verify"], {
      stdio: "ignore",
    });
  } catch {
    // 空目录或缺 git 身份——没有首次提交也能用
  }
  console.log("已初始化 git 仓库（处决的反悔按钮）");
}

/** 用 node 与 cli.js 的绝对路径注册，避开版本管理器（volta/nvm）按目录切 node 的坑 */
function registerMcp(root: string): void {
  const cliJs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "cli.js");
  const args = ["mcp", "add", "--scope", "user", "kb", "--", process.execPath, cliJs, "serve", "--vault", root];
  try {
    execFileSync("claude", args, { stdio: ["ignore", "pipe", "pipe"] });
    console.log("已注册 MCP 检索门（新开 Claude Code 会话即可用 kb_search/kb_read/kb_add/kb_stats）");
  } catch (err) {
    console.error(`MCP 注册失败（可能已存在同名 server）。手动执行：\n  claude ${args.join(" ")}`);
    if (err instanceof Error && err.message) console.error(`  原因：${err.message.split("\n")[0]}`);
  }
}

program
  .command("init")
  .description("把当前目录（或 --vault）变成受管理的知识库（默认交互向导，flags/-y 跳过）")
  .option("--managed <globs...>", "受管理笔记的 glob 范围", ["**/*.md"])
  .option("--capture-dir <dir>", "`kb add` 写入的目录", ".")
  .option("--git", "若不在 git 仓库中则 git init（处决的反悔按钮）")
  .option("-y, --yes", "跳过交互向导，全部用默认值/flags")
  .action(async (opts, cmd) => {
    const root = path.resolve(program.opts().vault ?? process.cwd());
    if (fs.existsSync(path.join(kbDir(root), "config.json"))) {
      console.error(`已经是知识库了：${root}`);
      process.exit(1);
    }

    // 显式传了任一配置 flag（或 -y）就不打扰——脚本与老用法完全兼容
    const explicit = ["managed", "captureDir", "git"].some(
      (k) => cmd.getOptionValueSource(k) === "cli"
    );
    const w: WizardResult =
      opts.yes || explicit
        ? {
            managed: opts.managed,
            captureDir: opts.captureDir,
            wantGit: !!opts.git,
            wantMcp: false,
            embedding: undefined,
          }
        : await runWizard(root);

    const v = initVault(root, {
      managed: w.managed,
      captureDir: w.captureDir,
      ...(w.embedding ? { embedding: w.embedding } : {}),
    });
    if (w.wantGit && !isGitRepo(root)) gitInit(root);

    const r = await runIndex(v);
    console.log(`\n知识库就绪：${root}`);
    console.log(`管理范围：${w.managed.join(", ")}——${r.notes} 条笔记，${r.links} 条反链`);
    if (r.notes > 0) {
      // 冷启动 aha：不等 90 天信号，git/反链立刻给出"库里有多少在沉睡"
      console.log("\n" + formatDoctor(runDoctor(v)));
    }
    if (w.wantMcp) registerMcp(root);
    if (w.embedding) {
      console.log(
        `\n语义检索已配置，还差一步：export KB_EMBEDDING_API_KEY=你的key，然后跑 kb index 生成向量` +
          `\n（MCP 场景另需注册时带 --env KB_EMBEDDING_API_KEY=你的key，否则门降级纯字面）`
      );
    }
    console.log(`\n下一步：kb triage 分诊 · kb digest 每周消化 · kb review 过堂`);
  });

program
  .command("doctor")
  .description("知识库体检：年龄分层、孤儿率、门流量与诊断（不依赖信号，随时可跑）")
  .option("--save", "同时留档到 .kb/reports/health-*.md")
  .action(async (opts) => {
    const v = vault();
    await runIndex(v);
    const r = runDoctor(v);
    console.log(formatDoctor(r));
    if (opts.save) console.log(`\n已留档：${saveDoctorReport(v, r)}`);
  });

program
  .command("review [report]")
  .description("交互式过堂处决名单（y=处决 n=赦免 q=退出），结束后自动执行")
  .action(async (report) => {
    const v = vault();
    const file = report ? path.resolve(report) : latestKillList(v.root);
    if (!file || !fs.existsSync(file)) {
      console.error("找不到处决名单——先跑 kb digest");
      process.exit(1);
    }
    const { items } = parsePending(file);
    if (items.length === 0) {
      console.log(`名单里没有待审条目：${file}`);
      return;
    }
    console.log(`过堂 ${path.basename(file)}：${items.length} 条候选`);
    const reader = new LineReader();
    const approved: number[] = [];
    try {
      for (const [i, it] of items.entries()) {
        console.log(`\n[${i + 1}/${items.length}] ${it.path}`);
        if (it.rest) console.log(`  ${it.rest}`);
        const head = notePreview(v, it.path);
        if (head) console.log(`  ${head}…`);
        const a = (await reader.ask("  判决？[y]=处决 [n]=赦免 [q]=退出 > ")).trim().toLowerCase();
        if (a === "q") break;
        if (a === "y") approved.push(it.line);
      }
    } finally {
      reader.close();
    }
    if (approved.length === 0) {
      console.log("\n没有批准任何处决，名单保留（赦免的下周仍可能上榜，除非获得使用信号）。");
      return;
    }
    approveLines(file, approved);
    console.log(`\n已批准 ${approved.length} 条，执行掩埋…`);
    const r = await executeReport(v, file);
    for (const m of r.moved) console.log(`已掩埋：${m}`);
    console.log(r.committed ? "已提交 git（可反悔）。" : "未提交（无 git 或暂存区有你的东西）。");
  });

program
  .command("index")
  .description("重建派生索引（笔记、反链、全文检索、增量向量）")
  .action(async () => {
    const r = await runIndex(vault());
    console.log(`索引完成：${r.notes} 条笔记，${r.links} 条反链`);
    if (r.embedded > 0) console.log(`向量增量：${r.embedded} 条`);
    console.log("层级分布：", r.tiers);
  });

program
  .command("search <query>")
  .description("走门检索（记一条使用信号）")
  .option("-n, --limit <n>", "最多返回条数", "8")
  .action(async (query, opts) => {
    const v = vault();
    const db = openDb(v.root);
    const hits = await hybridSearch(v, db, query, parseInt(opts.limit, 10));
    db.close();
    appendSignal(v.root, { tool: "kb_search", query });
    if (hits.length === 0) console.log(`无结果：${query}\n${noResultHint(query)}`);
    for (const h of hits) console.log(`${h.path}\n  ${h.title} — ${h.snip}\n`);
  });

program
  .command("read <notePath>")
  .description("输出笔记全文（记读取信号——这就是笔记的续命方式）")
  .action((notePath) => {
    const v = vault();
    const abs = path.resolve(v.root, notePath);
    const rel = path.relative(v.root, abs);
    if (rel.startsWith("..") || !fs.existsSync(abs)) {
      console.error(`知识库里找不到：${notePath}`);
      process.exit(1);
    }
    appendSignal(v.root, { tool: "kb_read", path: rel });
    process.stdout.write(fs.readFileSync(abs, "utf8"));
  });

program
  .command("add [title]")
  .description("捕捉笔记（入口税：不给 --use-when 就进 inbox 限期）")
  .option("-t, --tier <tier>", "L0 | L1 | inbox")
  .option("-w, --use-when <text>", "什么时候会再用到？")
  .option("-f, --file <file>", "从文件取内容")
  .option("-d, --dir <dir>", "子目录（默认取配置 captureDir）")
  .action(async (title, opts) => {
    const v = vault();
    let content = "";
    if (opts.file) content = fs.readFileSync(opts.file, "utf8");
    else if (!process.stdin.isTTY) {
      const chunks: Buffer[] = [];
      for await (const c of process.stdin) chunks.push(c as Buffer);
      content = Buffer.concat(chunks).toString("utf8");
    }
    if (!title && !content) {
      console.error("没有可添加的内容——请给标题、--file 或从 stdin 管道输入");
      process.exit(1);
    }
    const rel = addNote(v, {
      title: title ?? content.split("\n")[0].replace(/^#+\s*/, "").slice(0, 60),
      content,
      tier: opts.tier,
      useWhen: opts.useWhen,
      dir: opts.dir,
    });
    await runIndex(v);
    console.log(`已添加：${rel}`);
  });

program
  .command("triage")
  .description("给未分诊笔记定层（provider：human | anthropic | agent）")
  .option("--limit <n>", "最多分诊 n 条")
  .option("--emit", "不做判断，输出给 agent 的任务提示（agent provider）")
  .option("-y, --yes", "LLM 提案不经确认直接应用")
  .action(async (opts) => {
    const v = vault();
    await runIndex(v);
    const notes = untriagedNotes(v, opts.limit ? parseInt(opts.limit, 10) : undefined);
    if (notes.length === 0) {
      console.log("没有未分诊的笔记。代谢健康。");
      return;
    }
    const provider = opts.emit ? "agent" : v.config.judgment.provider;

    if (provider === "agent") {
      console.log(emitTriagePrompt(v, notes));
      return;
    }
    if (provider === "anthropic") {
      const { anthropicTriage } = await import("./judgment/anthropic.js");
      console.log(`请 ${v.config.judgment.triageModel} 给 ${notes.length} 条笔记出提案…`);
      const decisions = await anthropicTriage(v, notes);
      for (const d of decisions) {
        console.log(`- ${d.path} → ${d.tier}${d.useWhen ? `（${d.useWhen}）` : ""} — ${d.reason ?? ""}`);
      }
      const ok = opts.yes || (await confirm(`应用这 ${decisions.length} 条提案？`));
      if (ok) await applyDecisions(v, decisions);
      else console.log("未应用任何提案。");
      return;
    }
    // human（默认）
    const decisions = await humanTriage(notes);
    if (decisions.length > 0) await applyDecisions(v, decisions);
    else console.log("未应用任何决定。");
  });

program
  .command("digest")
  .description("每周消化：重建索引 + 法医验尸 + 可选 LLM 提案")
  .option("--no-llm", "即便 provider 是 anthropic 也跳过 LLM 提案")
  .option("--emit", "输出给 agent 的审查任务提示")
  .action(async (opts) => {
    const v = vault();
    await runIndex(v);
    const { report, candidates } = runCoroner(v);
    console.log(`处决名单：${candidates.length} 条候选 → ${report}`);

    if (opts.emit || v.config.judgment.provider === "agent") {
      console.log("\n" + emitDigestPrompt(v, report));
    } else if (v.config.judgment.provider === "anthropic" && opts.llm !== false) {
      const { anthropicDigest } = await import("./judgment/anthropic.js");
      const db = openDb(v.root);
      const noteList = db
        .prepare("SELECT path, title, tier, use_when FROM notes ORDER BY path")
        .all() as Array<{ path: string; title: string; tier: string | null; use_when: string | null }>;
      db.close();
      console.log(`请 ${v.config.judgment.digestModel} 出消化提案…`);
      const proposals = await anthropicDigest(v, candidates, getStats(v), noteList);
      fs.appendFileSync(report, "\n" + proposals.trim() + "\n");
      console.log("提案已追加进报告。");
    }

    const health = saveDoctorReport(v, runDoctor(v));
    console.log("\n" + formatStats(getStats(v)));
    console.log(`体检已留档：${health}（kb doctor 随时查看）`);
    console.log(`\n过堂审批：kb review（或手工勾选后 kb execute ${report}）`);
  });

program
  .command("execute <report>")
  .description("执行名单中已勾选的条目（git mv 到 _graveyard/，可反悔）")
  .action(async (report) => {
    const v = vault();
    const r = await executeReport(v, report);
    if (r.moved.length === 0 && r.skipped.length === 0) {
      console.log("没有勾选任何条目——无事发生。");
      return;
    }
    for (const m of r.moved) console.log(`已掩埋：${m}`);
    for (const s of r.skipped) console.log(`跳过（文件不存在）：${s}`);
    console.log(r.committed ? "已提交 git（可反悔）。" : "未提交（无 git 或暂存区有你的东西）。");
  });

program
  .command("stats")
  .description("知识库健康度")
  .action(() => {
    const v = vault();
    console.log(formatStats(getStats(v)));
    const reminder = digestReminder(v.root);
    if (reminder) console.log("\n" + reminder);
  });

program
  .command("serve")
  .description("启动 MCP 检索门（stdio），供任意 agent 接入")
  .action(async () => {
    await serve(vault());
  });

const hook = program
  .command("hook")
  .description("Claude Code hooks：自动注入相关笔记（门的第二形态，不靠 agent 自觉）");

hook
  .command("prompt")
  .description("UserPromptSubmit 挂点：按本条 prompt 检索，相关则注入摘要（供 hooks 调用）")
  .action(async () => {
    try {
      await hookPrompt(vault());
    } catch {
      // hook 永不打断用户
    }
  });

hook
  .command("session")
  .description("SessionStart 挂点：注入库概况与最近读取（供 hooks 调用）")
  .action(async () => {
    try {
      await hookSession(vault());
    } catch {
      // hook 永不打断用户
    }
  });

hook
  .command("install")
  .description("把两个挂点写入 Claude Code settings.json（自动备份 .bak，幂等）")
  .option("--project", "装到当前项目 .claude/settings.json（默认装 user 级）")
  .action((opts) => {
    const v = vault();
    const file = installHooks(v.root, opts.project ? "project" : "user");
    console.log(`已写入 ${file}（原文件备份为 .bak）`);
    console.log("新开 Claude Code 会话生效：每条提问自动带上相关笔记，会话开始自动带库状态。");
    console.log("卸载：kb hook uninstall" + (opts.project ? " --project" : ""));
  });

hook
  .command("uninstall")
  .description("从 settings.json 移除 kb 挂点")
  .option("--project", "从当前项目 .claude/settings.json 移除")
  .action((opts) => {
    const file = uninstallHooks(opts.project ? "project" : "user");
    console.log(file ? `已移除（${file}，备份 .bak）` : "没有找到已安装的 kb 挂点。");
  });

hook
  .command("show")
  .description("打印 hooks 配置片段（手动粘贴到 settings.json 用）")
  .action(() => {
    const v = vault();
    console.log(JSON.stringify({ hooks: buildHookConfig(v.root) }, null, 2));
  });

program
  .command("migrate")
  .description("从旧版 sqlite kb.db 导入访问日志信号")
  .requiredOption("--from <db>", "旧 kb.db 的路径")
  .action((opts) => {
    const v = vault();
    const old = new Database(path.resolve(opts.from), { readonly: true });
    const rows = old
      .prepare("SELECT ts, tool, query, path FROM access_log ORDER BY id")
      .all() as Array<{ ts: string; tool: string; query: string | null; path: string | null }>;
    old.close();
    const lines = rows.map((r) =>
      JSON.stringify({
        ts: new Date(r.ts.includes("T") ? r.ts : r.ts.replace(" ", "T")).toISOString(),
        tool: r.tool,
        ...(r.query ? { query: r.query } : {}),
        ...(r.path ? { path: r.path } : {}),
      })
    );
    fs.appendFileSync(signalLogPath(v.root), lines.join("\n") + (lines.length ? "\n" : ""));
    console.log(`已导入 ${lines.length} 条信号 → ${signalLogPath(v.root)}`);
  });

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
