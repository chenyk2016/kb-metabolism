#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import { initVault, loadVault, kbDir, signalLogPath } from "./core/config.js";
import { runIndex } from "./core/indexer.js";
import { openDb } from "./core/db.js";
import { searchNotes } from "./core/search.js";
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
  .description("kb-metabolism — a knowledge base that knows how to forget")
  .version("0.2.0")
  .option("--vault <dir>", "vault root (default: walk up from cwd for .kb/)");

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
      // unreadable file — triage on title alone
    }
    return { path: r.path, title: r.title, head };
  });
}

function applyDecisions(v: Vault, decisions: TierDecision[]): void {
  for (const d of decisions) applyDecision(v, d);
  const r = runIndex(v);
  console.log(`\napplied ${decisions.length} decision(s); tiers now:`, r.tiers);
}

program
  .command("init")
  .description("turn the current directory (or --vault) into a managed vault")
  .option("--managed <globs...>", "globs of managed notes", ["**/*.md"])
  .option("--capture-dir <dir>", "where `kb add` puts new notes", ".")
  .option("--git", "git init the vault if it is not a repo")
  .action((opts) => {
    const root = path.resolve(program.opts().vault ?? process.cwd());
    if (fs.existsSync(path.join(kbDir(root), "config.json"))) {
      console.error(`already a vault: ${root}`);
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
          // empty dir or missing git identity — vault still works without the commit
        }
        console.log("initialized git repo (your undo button for executions)");
      }
    }
    const r = runIndex(v);
    console.log(`vault ready: ${root}`);
    console.log(`managed: ${opts.managed.join(", ")} — ${r.notes} note(s), ${r.links} backlink(s)`);
    console.log(`next: kb triage · kb serve (MCP gate) · kb digest (weekly)`);
  });

program
  .command("index")
  .description("rebuild the derived index (notes, backlinks, full-text)")
  .action(() => {
    const r = runIndex(vault());
    console.log(`indexed ${r.notes} note(s), ${r.links} backlink(s)`);
    console.log("tiers:", r.tiers);
  });

program
  .command("search <query>")
  .description("search via the gate (logs a usage signal)")
  .option("-n, --limit <n>", "max results", "8")
  .action((query, opts) => {
    const v = vault();
    const db = openDb(v.root);
    const hits = searchNotes(db, query, parseInt(opts.limit, 10));
    db.close();
    appendSignal(v.root, { tool: "kb_search", query });
    if (hits.length === 0) console.log(`no results for: ${query}`);
    for (const h of hits) console.log(`${h.path}\n  ${h.title} — ${h.snip}\n`);
  });

program
  .command("read <notePath>")
  .description("print a note (logs the read — this is what keeps notes alive)")
  .action((notePath) => {
    const v = vault();
    const abs = path.resolve(v.root, notePath);
    const rel = path.relative(v.root, abs);
    if (rel.startsWith("..") || !fs.existsSync(abs)) {
      console.error(`not found in vault: ${notePath}`);
      process.exit(1);
    }
    appendSignal(v.root, { tool: "kb_read", path: rel });
    process.stdout.write(fs.readFileSync(abs, "utf8"));
  });

program
  .command("add [title]")
  .description("capture a note (entry tax: no --use-when means inbox + expiry)")
  .option("-t, --tier <tier>", "L0 | L1 | inbox")
  .option("-w, --use-when <text>", "when will this be needed again?")
  .option("-f, --file <file>", "take content from a file")
  .option("-d, --dir <dir>", "subdirectory (default: config captureDir)")
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
      console.error("nothing to add — pass a title, --file, or pipe content on stdin");
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
    console.log(`added: ${rel}`);
  });

program
  .command("triage")
  .description("assign tiers to untriaged notes (provider: human | anthropic | agent)")
  .option("--limit <n>", "triage at most n notes")
  .option("--emit", "print an agent prompt instead of deciding (agent provider)")
  .option("-y, --yes", "apply LLM proposals without confirmation")
  .action(async (opts) => {
    const v = vault();
    runIndex(v);
    const notes = untriagedNotes(v, opts.limit ? parseInt(opts.limit, 10) : undefined);
    if (notes.length === 0) {
      console.log("nothing untriaged. metabolism healthy.");
      return;
    }
    const provider = opts.emit ? "agent" : v.config.judgment.provider;

    if (provider === "agent") {
      console.log(emitTriagePrompt(v, notes));
      return;
    }
    if (provider === "anthropic") {
      const { anthropicTriage } = await import("./judgment/anthropic.js");
      console.log(`asking ${v.config.judgment.triageModel} for ${notes.length} proposal(s)…`);
      const decisions = await anthropicTriage(v, notes);
      for (const d of decisions) {
        console.log(`- ${d.path} → ${d.tier}${d.useWhen ? ` (${d.useWhen})` : ""} — ${d.reason ?? ""}`);
      }
      const ok = opts.yes || (await confirm(`apply ${decisions.length} proposal(s)?`));
      if (ok) applyDecisions(v, decisions);
      else console.log("nothing applied.");
      return;
    }
    // human (default)
    const decisions = await humanTriage(notes);
    if (decisions.length > 0) applyDecisions(v, decisions);
    else console.log("nothing applied.");
  });

program
  .command("digest")
  .description("weekly digest: reindex, run the coroner, add LLM proposals if configured")
  .option("--no-llm", "skip LLM proposals even if provider is anthropic")
  .option("--emit", "print an agent prompt for the review step")
  .action(async (opts) => {
    const v = vault();
    runIndex(v);
    const { report, candidates } = runCoroner(v);
    console.log(`kill list: ${candidates.length} candidate(s) → ${report}`);

    if (opts.emit || v.config.judgment.provider === "agent") {
      console.log("\n" + emitDigestPrompt(v, report));
    } else if (v.config.judgment.provider === "anthropic" && opts.llm !== false) {
      const { anthropicDigest } = await import("./judgment/anthropic.js");
      const db = openDb(v.root);
      const noteList = db
        .prepare("SELECT path, title, tier, use_when FROM notes ORDER BY path")
        .all() as Array<{ path: string; title: string; tier: string | null; use_when: string | null }>;
      db.close();
      console.log(`asking ${v.config.judgment.digestModel} for digest proposals…`);
      const proposals = await anthropicDigest(v, candidates, getStats(v), noteList);
      fs.appendFileSync(report, "\n" + proposals.trim() + "\n");
      console.log("proposals appended to the report.");
    }

    console.log("\n" + formatStats(getStats(v)));
    console.log(`\nreview the report, check [x] what you approve, then: kb execute ${report}`);
  });

program
  .command("execute <report>")
  .description("execute checked kill-list entries (git mv to _graveyard/, reversible)")
  .action((report) => {
    const v = vault();
    const r = executeReport(v, report);
    if (r.moved.length === 0 && r.skipped.length === 0) {
      console.log("no boxes checked — nothing happened.");
      return;
    }
    for (const m of r.moved) console.log(`buried: ${m}`);
    for (const s of r.skipped) console.log(`skipped (missing): ${s}`);
    console.log(r.committed ? "committed to git (reversible)." : "not committed (no git / staged work present).");
  });

program
  .command("stats")
  .description("vault health")
  .action(() => {
    console.log(formatStats(getStats(vault())));
  });

program
  .command("serve")
  .description("run the MCP retrieval gate (stdio) for agents")
  .action(async () => {
    await serve(vault());
  });

program
  .command("migrate")
  .description("import access-log signals from a legacy sqlite kb.db")
  .requiredOption("--from <db>", "path to the old kb.db")
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
    console.log(`imported ${lines.length} signal(s) into ${signalLogPath(v.root)}`);
  });

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
