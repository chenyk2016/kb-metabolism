import fs from "node:fs";
import matter from "gray-matter";
import type { TierDecision, Vault } from "./types.js";
import path from "node:path";

/** apply a triage decision by writing kb_* frontmatter (body untouched) */
export function applyDecision(vault: Vault, d: TierDecision): void {
  const abs = path.join(vault.root, d.path);
  const raw = fs.readFileSync(abs, "utf8");
  const parsed = matter(raw);
  const data: Record<string, unknown> = { ...parsed.data };

  data.kb_tier = d.tier;
  if (d.useWhen) data.kb_use_when = d.useWhen;
  else delete data.kb_use_when;
  data.kb_triaged = new Date().toISOString().slice(0, 10);
  if (d.tier === "inbox") {
    const expires = new Date(Date.now() + vault.config.inboxDays * 86400000);
    data.kb_expires = expires.toISOString().slice(0, 10);
  } else {
    delete data.kb_expires;
  }

  fs.writeFileSync(abs, matter.stringify(parsed.content, data));
}
