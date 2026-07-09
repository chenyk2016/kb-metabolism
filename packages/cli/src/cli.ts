#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import { initVault, loadVault, kbDir, signalLogPath } from "@kb/core";
import { runIndex } from "@kb/core";
import { openDb } from "@kb/core";
import { hybridSearch, noResultHint } from "@kb/core";
import { appendSignal } from "@kb/core";
import { runCoroner } from "@kb/core";
import { executeReport } from "@kb/core";
import { addNote } from "@kb/core";
import { applyDecision } from "@kb/core";
import { getStats, formatStats } from "@kb/core";
import { digestReminder } from "@kb/core";
import { runDoctor, formatDoctor, saveDoctorReport } from "@kb/core";
import { writeSecret, resolveEmbeddingKey, secretsTrackedByGit } from "@kb/core";
import { latestKillList, parsePending, notePreview, approveLines } from "@kb/core";
import { serve } from "@kb/mcp";
import { startUi, DEFAULT_PORT } from "@kb/server";
import { humanTriage, confirm, LineReader, listUntriaged } from "@kb/core";
import { runWizard, isGitRepo, type WizardResult } from "./wizard.js";
import { hookPrompt, hookSession, installHooks, uninstallHooks, buildHookConfig } from "./hooks.js";
import { emitTriagePrompt, emitDigestPrompt, emitChewPrompt } from "@kb/core";
import { buildChewCandidates, saveChewList, createL0 } from "@kb/core";
import type { TierDecision, Vault } from "@kb/core";

const program = new Command();
program
  .name("kb")
  .description("kb-metabolism 知识代谢系统——一个会遗忘的知识库")
  .version("0.3.0")
  .option("--vault <dir>", "知识库根目录（默认从当前目录向上找 .kb/）");

function vault(): Vault {
  return loadVault(program.opts().vault);
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
        `\n语义检索已配置，还差一步：kb key set 粘贴 API key（写入 .kb/secrets.json，自动 gitignore；CLI 和 MCP 门共用，无需再配环境变量）`
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

/** 静默读入一行（不回显；key 永不走 argv，避免进 shell history） */
function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: process.stdin.isTTY === true,
    });
    process.stdout.write(prompt);
    (rl as unknown as { _writeToOutput?: (s: string) => void })._writeToOutput = () => {};
    rl.question("", (answer) => {
      process.stdout.write("\n");
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function testKey(v: Vault): Promise<void> {
  const cfg = v.config.embedding;
  if (!cfg) {
    console.error("config.json 没有 embedding 配置——先加 embedding 节（见 README「语义检索」）");
    process.exit(1);
  }
  const resolved = resolveEmbeddingKey(v.root, cfg);
  if (!resolved) {
    console.error(`无 key：kb key set 一次配好，或临时 export ${cfg.apiKeyEnv ?? "KB_EMBEDDING_API_KEY"}`);
    process.exit(1);
  }
  try {
    const { embedTexts } = await import("@kb/core");
    const [vec] = await embedTexts(cfg, ["kb key test"], resolved.key);
    const db = openDb(v.root);
    const vectors = (db.prepare("SELECT COUNT(*) AS c FROM embeddings").get() as { c: number }).c;
    const total = (db.prepare("SELECT COUNT(*) AS c FROM notes").get() as { c: number }).c;
    db.close();
    console.log(
      `✅ key 可用（来源 ${resolved.source === "env" ? "环境变量（临时）" : ".kb/secrets.json"}）· ${cfg.model} · ${vec.length} 维`
    );
    console.log(
      vectors < total ? `向量覆盖 ${vectors}/${total}——跑 kb index 增量补齐` : `向量覆盖 ${vectors}/${total}`
    );
  } catch (err) {
    console.error(`❌ key 验证失败：${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

const keyCmd = program
  .command("key")
  .description("embedding API key 管理（.kb/secrets.json——配置进 git，秘密永不进 git）");

keyCmd
  .command("set")
  .description("粘贴 key 写入 .kb/secrets.json（0600 + 自动 gitignore），CLI/MCP/cron 全部生效")
  .action(async () => {
    const v = vault();
    const cfg = v.config.embedding;
    if (!cfg) {
      console.error("config.json 没有 embedding 配置——先加 embedding 节（见 README「语义检索」）");
      process.exit(1);
    }
    const envName = cfg.apiKeyEnv ?? "KB_EMBEDDING_API_KEY";
    const key = await askHidden(`粘贴 ${envName}（输入不回显）> `);
    if (!key) {
      console.error("空输入，未写入");
      process.exit(1);
    }
    console.log(`已写入 ${writeSecret(v.root, envName, key)}（0600，.kb/.gitignore 已覆盖）`);
    if (secretsTrackedByGit(v.root)) {
      console.error("🚨 secrets.json 已被 git 跟踪（key 可能已进历史）：git rm --cached 并轮换 key");
    }
    await testKey(v);
  });

keyCmd
  .command("test")
  .description("验证 key：真实调一次 embedding API，报告来源与向量覆盖率")
  .action(async () => {
    await testKey(vault());
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
  .command("now", { isDefault: true })
  .description("现在该做什么？（直接运行 kb 就是这个命令）")
  .action(async () => {
    let v: Vault;
    try {
      v = vault();
    } catch {
      console.log("还没有知识库。第一步：cd 到你的笔记目录（Obsidian vault 也行），运行 kb init");
      return;
    }
    const s = getStats(v);
    console.log(`知识库：${s.total} 条 · L0 ${s.l0}/${s.l0Cap} · 近 7 天走门 ${s.reads7d + s.searches7d} 次\n`);

    // 按优先级给出"此刻该做的一件事"——剧本，不是能力清单
    const todo: string[] = [];
    const untriaged = s.tiers["未分诊"] ?? 0;
    if (untriaged > 0) todo.push(`${untriaged} 条笔记还未分诊 → kb triage`);
    const latest = latestKillList(v.root);
    if (latest && parsePending(latest).items.length > 0) {
      todo.push(`处决名单有 ${parsePending(latest).items.length} 条待过堂 → kb review`);
    }
    const reminder = digestReminder(v.root);
    if (reminder) todo.push(reminder.replace(/^⚠️ /, "") + " → kb digest");
    const chews = buildChewCandidates(v);
    if (chews.length > 0) todo.push(`${chews.length} 篇高频资料值得提炼成判断 → kb chew`);

    if (todo.length === 0) {
      console.log("✅ 代谢健康，此刻什么都不用做。");
      console.log("日常就这样用：笔记照常写；查东西问接了门的 agent；存东西让 agent 调 kb_add。");
      console.log("门会在该消化的时候提醒你。");
    } else {
      console.log("此刻该做的事（按优先级）：");
      todo.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
      console.log(`\n日常无需操作——写笔记照旧，检索交给 agent；以上是每周 5 分钟的维护仪式。`);
    }
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
    const notes = listUntriaged(v, opts.limit ? parseInt(opts.limit, 10) : undefined);
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
      const { anthropicTriage } = await import("@kb/core/judgment/anthropic");
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
      const { anthropicDigest } = await import("@kb/core/judgment/anthropic");
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
    const chews = buildChewCandidates(v);
    if (chews.length > 0) {
      const chewFile = saveChewList(v, chews);
      console.log(`消化名单：${chews.length} 篇高频资料值得提炼成判断 → ${chewFile}（kb chew 逐条消化）`);
    }
    console.log("\n" + formatStats(getStats(v)));
    console.log(`体检已留档：${health}（kb doctor 随时查看）`);
    console.log(`\n过堂审批：kb review（或手工勾选后 kb execute ${report}）`);
  });

program
  .command("chew")
  .description("消化：把反复被使用的 L1 资料提炼成 L0 判断（AI 拆解，人合成）")
  .option("--emit", "输出给 agent 的消化协助提示")
  .option("--limit <n>", "最多消化 n 篇")
  .action(async (opts) => {
    const v = vault();
    await runIndex(v);
    let candidates = buildChewCandidates(v);
    if (opts.limit) candidates = candidates.slice(0, parseInt(opts.limit, 10));
    if (candidates.length === 0) {
      console.log("没有达到消化阈值的资料（近 90 天被读 ≥2 次的 L1）。继续走门使用，营养自然浮现。");
      return;
    }
    if (opts.emit || v.config.judgment.provider === "agent") {
      console.log(emitChewPrompt(v, candidates));
      return;
    }

    console.log(`消化 ${candidates.length} 篇高频资料（AI 只拆解，判断由你说出）`);
    const reader = new LineReader();
    let made = 0;
    try {
      for (const [i, c] of candidates.entries()) {
        console.log(`\n[${i + 1}/${candidates.length}] ${c.path}`);
        console.log(`  ${c.title}｜近 90 天读 ${c.reads90d} 次`);
        if (c.useWhen) console.log(`  存入时说的用途：${c.useWhen}——现在还成立吗？`);
        console.log(`  ${c.head}…`);

        if (v.config.judgment.provider === "anthropic") {
          try {
            const { anthropicChew } = await import("@kb/core/judgment/anthropic");
            const props = await anthropicChew(v, c);
            if (props.length > 0) {
              console.log(`  消化酶拆解的候选判断（供改写，别照抄）：`);
              props.forEach((p, j) => console.log(`   ${String.fromCharCode(97 + j)}. ${p}`));
            }
          } catch (err) {
            console.error(`  （拆解不可用：${err instanceof Error ? err.message : err}）`);
          }
        }

        const judgment = (
          await reader.ask("  用你的话说出要留下的判断（一句话；回车=跳过）> ")
        ).trim();
        if (!judgment) continue;
        const useWhen = (await reader.ask("  什么时候会再用到？> ")).trim();
        if (!useWhen) {
          console.log("  没有用途就不值得进 L0——跳过。");
          continue;
        }
        try {
          const rel = createL0(v, judgment, useWhen, [c.path]);
          made++;
          console.log(`  ✅ L0 已生成：${rel}（源资料已标记 kb_digested，之后可自然衰亡）`);
        } catch (err) {
          console.error(`  ${err instanceof Error ? err.message : err}`);
          break;
        }
      }
    } finally {
      reader.close();
    }
    if (made > 0) {
      const r = await runIndex(v);
      console.log(`\n本次消化产出 ${made} 条 L0 判断；层级分布：`, r.tiers);
    } else {
      console.log("\n本次没有产出判断。");
    }
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

program
  .command("ui")
  .description("打开本地管理台（判决台 + 体检室），只绑 127.0.0.1")
  .option("--port <n>", "端口", String(DEFAULT_PORT))
  .option("--no-open", "不自动打开浏览器")
  .action(async (opts) => {
    const v = vault();
    const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "web");
    if (!fs.existsSync(path.join(webRoot, "index.html"))) {
      console.error("管理台静态资源缺失（dist/web）——开发环境请先 pnpm build");
      process.exit(1);
    }
    const { url } = await startUi({
      root: v.root,
      port: parseInt(opts.port, 10),
      webRoot,
      open: opts.open,
    });
    console.log(`管理台已启动：${url}（Ctrl+C 退出）`);
    console.log(`界面里的浏览与检索记 kb_ui 观察信号，不给笔记续命——判决才是你来这里的目的。`);
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
