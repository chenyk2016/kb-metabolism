import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { openDb } from "./db.js";
import { reportsDir } from "./config.js";
import { lastReadByPath } from "./signals.js";
import type { NoteRow, Vault } from "./types.js";

/** last touched via git history (if the vault is a repo), else file mtime */
function lastTouched(root: string, rel: string): Date {
  try {
    const out = execFileSync(
      "git",
      ["-C", root, "log", "-1", "--format=%cI", "--", rel],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
    if (out) return new Date(out);
  } catch {
    // not a git repo or file untracked
  }
  return fs.statSync(path.join(root, rel)).mtime;
}

export type Candidate = {
  path: string;
  title: string;
  tier: string;
  reasons: string[];
};

export type CoronerResult = { report: string; candidates: Candidate[] };

/**
 * The coroner is pure data — it never deletes anything. It proposes; the
 * human is the judge. A note lands on the kill list when every usage signal
 * is dead, or when its inbox grace period has expired.
 */
export function runCoroner(vault: Vault): CoronerResult {
  const { root, config } = vault;
  const db = openDb(root);
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const days = (d: Date) => Math.floor((today.getTime() - d.getTime()) / 86400000);

  const notes = db
    .prepare("SELECT * FROM notes WHERE tier IS NULL OR tier != 'L0'")
    .all() as NoteRow[];
  const backlinkStmt = db.prepare("SELECT COUNT(*) AS c FROM links WHERE dst = ?");
  const lastRead = lastReadByPath(root);

  const candidates: Candidate[] = [];
  for (const n of notes) {
    const tier = n.tier ?? "untriaged";
    const reasons: string[] = [];

    if (n.tier === "inbox" && n.expires && n.expires < todayStr) {
      reasons.push(`inbox expired (${n.expires})`);
    } else {
      const backlinks = (backlinkStmt.get(n.path) as { c: number }).c;
      const read = lastRead.get(n.path);
      const readAlive = read && days(new Date(read)) <= config.decayDays;
      const age = days(lastTouched(root, n.path));
      if (backlinks === 0 && !readAlive && age > config.decayDays) {
        reasons.push(
          "0 backlinks",
          read ? `last read >${config.decayDays}d ago` : "never read via the gate",
          `untouched for ${age}d`
        );
      }
    }
    if (reasons.length > 0) {
      candidates.push({ path: n.path, title: n.title, tier, reasons });
    }
  }
  db.close();

  const file = path.join(reportsDir(root), `kill-list-${todayStr}.md`);
  const lines = [
    `# Kill list ${todayStr}`,
    "",
    `> Check \`[x]\` to approve execution (git mv to _graveyard/), then run:`,
    `> \`kb execute ${path.relative(process.cwd(), file) || file}\``,
    `> The AI only proposes — the human is the judge. Unchecked = pardoned`,
    `> (it will reappear next week unless it earns a usage signal).`,
    "",
  ];
  if (candidates.length === 0) {
    lines.push("No candidates. Metabolism healthy.");
  } else {
    for (const c of candidates) {
      lines.push(`- [ ] \`${c.path}\` — [${c.tier}] ${c.title} | ${c.reasons.join("; ")}`);
    }
  }
  lines.push("");
  fs.mkdirSync(reportsDir(root), { recursive: true });
  fs.writeFileSync(file, lines.join("\n"));
  return { report: file, candidates };
}
