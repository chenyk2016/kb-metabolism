import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { graveyardDir } from "./config.js";
import { runIndex } from "./indexer.js";
import type { Vault } from "./types.js";

function git(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function isGitRepo(root: string): boolean {
  try {
    git(root, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

export type ExecuteResult = { moved: string[]; skipped: string[]; committed: boolean };

/** Move approved (checked) kill-list entries to _graveyard/, then reindex. */
export function executeReport(vault: Vault, reportFile: string): ExecuteResult {
  const { root } = vault;
  const report = fs.readFileSync(path.resolve(reportFile), "utf8");

  const approved: string[] = [];
  for (const m of report.matchAll(/^- \[[xX]\] `([^`]+)`/gm)) {
    approved.push(m[1]);
  }

  const graveyard = graveyardDir(root);
  fs.mkdirSync(graveyard, { recursive: true });
  const useGit = isGitRepo(root);

  // refuse to auto-commit on top of a user's staged work
  let stagedClean = true;
  if (useGit) {
    try {
      git(root, ["diff", "--cached", "--quiet"]);
    } catch {
      stagedClean = false;
    }
  }

  const moved: string[] = [];
  const skipped: string[] = [];
  for (const rel of approved) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
      skipped.push(rel);
      continue;
    }
    let dest = path.join(graveyard, path.basename(abs));
    if (fs.existsSync(dest)) {
      const d = new Date().toISOString().slice(0, 10);
      dest = path.join(graveyard, `${d}-${path.basename(abs)}`);
    }
    let movedByGit = false;
    if (useGit) {
      try {
        git(root, ["mv", rel, path.relative(root, dest)]);
        movedByGit = true;
      } catch {
        // untracked file — plain rename below
      }
    }
    if (!movedByGit) fs.renameSync(abs, dest);
    moved.push(rel);
  }

  let committed = false;
  if (moved.length > 0 && useGit && stagedClean) {
    try {
      git(root, ["commit", "-m", `kb: bury ${moved.length} note(s) in _graveyard`, "--no-verify"]);
      committed = true;
    } catch {
      // nothing staged (all moves were plain renames) — fine
    }
  }

  runIndex(vault);
  return { moved, skipped, committed };
}
