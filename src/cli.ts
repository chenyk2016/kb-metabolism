#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import { initVault, loadVault, kbDir, signalLogPath } from "./core/config.js";
import { runIndex } from "./core/indexer.js";
import { openDb } from "./core/db.js";
import { searchNotes, noResultHint } from "./core/search.js";
import { appendSignal } from "./core/signals.js";
import { runCoroner } from "./core/coroner.js";
import { executeReport } from "./core/executor.js";
import { addNote } from "./core/capture.js";
import { applyDecision } from "./core/frontmatter.js";
import { getStats, formatStats } from "./core/stats.js";
import { serve } from "./mcp/server.js";
import { humanTriage, confirm, type UntriagedNote } from "./judgment/human.js";
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

function applyDecisions(v: Vault, decisions: TierDecision[]): void {
  for (const d of decisions) applyDecision(v, d);
  const r = runIndex(v);
  console.log(`\n已应用 ${decisions.length} 条决定；当前层级分布：`, r.tiers);
}

program
  .command("init")
  .description("把当前目录（或 --vault）变成受管理的知识库")
  .option("--managed <globs...>", "受管理笔记的 glob 范围", ["**/*.md"])
  .option("--capture-dir <dir>", "`kb add` 写入的目录", ".")
  .option("--git", "若不在 git 仓库中则 git init（处决的反悔按钮）")
  .action((opts) => {
    const root = path.resolve(program.opts().vault ?? process.cwd());
    if (fs.existsSync(path.join(kbDir(root), "config.json"))) {
      console.error(`已经是知识库了：${root}`);
      process.exit(1);
    }
    const v = initVault(root, { managed: opts.managed, captureDir: opts.captureDir });
    if (opts.git) {
      try {
        execFileSync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
      } catch {
        execFileSync("git", ["-C", root, "init", "-q"]);
        execFileSync("git", ["-C", root, "add", "-A"]);
        try {
          execFileSync(
            "git",
            ["-C", root, "commit", "-qm", "kb: init vault", "--no-verify"],
            { stdio: "ignore" }
          );
        } catch {
          // 空目录或缺 git 身份——没有首次提交也能用
        }
        console.log("已初始化 git 仓库（处决的反悔按钮）");
      }
    }
    const r = runIndex(v);
    console.log(`知识库就绪：${root}`);
    console.log(`管理范围：${opts.managed.join(", ")}——${r.notes} 条笔记，${r.links} 条反链`);
    console.log(`下一步：kb triage 分诊 · kb serve 开检索门（MCP）· kb digest 每周消化`);
  });

program
  .command("index")
  .description("重建派生索引（笔记、反链、全文检索）")
  .action(() => {
    const r = runIndex(vault());
    console.log(`索引完成：${r.notes} 条笔记，${r.links} 条反链`);
    console.log("层级分布：", r.tiers);
  });

program
  .command("search <query>")
  .description("走门检索（记一条使用信号）")
  .option("-n, --limit <n>", "最多返回条数", "8")
  .action((query, opts) => {
    const v = vault();
    const db = openDb(v.root);
    const hits = searchNotes(db, query, parseInt(opts.limit, 10));
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
    runIndex(v);
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
    runIndex(v);
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
      if (ok) applyDecisions(v, decisions);
      else console.log("未应用任何提案。");
      return;
    }
    // human（默认）
    const decisions = await humanTriage(notes);
    if (decisions.length > 0) applyDecisions(v, decisions);
    else console.log("未应用任何决定。");
  });

program
  .command("digest")
  .description("每周消化：重建索引 + 法医验尸 + 可选 LLM 提案")
  .option("--no-llm", "即便 provider 是 anthropic 也跳过 LLM 提案")
  .option("--emit", "输出给 agent 的审查任务提示")
  .action(async (opts) => {
    const v = vault();
    runIndex(v);
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

    console.log("\n" + formatStats(getStats(v)));
    console.log(`\n审阅报告，勾选 [x] 批准的条目，然后：kb execute ${report}`);
  });

program
  .command("execute <report>")
  .description("执行名单中已勾选的条目（git mv 到 _graveyard/，可反悔）")
  .action((report) => {
    const v = vault();
    const r = executeReport(v, report);
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
    console.log(formatStats(getStats(vault())));
  });

program
  .command("serve")
  .description("启动 MCP 检索门（stdio），供任意 agent 接入")
  .action(async () => {
    await serve(vault());
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
