import { openDb } from "./db.js";
import { readSignals } from "./signals.js";
import type { Vault } from "./types.js";

export type VaultStats = {
  total: number;
  tiers: Record<string, number>;
  l0: number;
  l0Cap: number;
  orphans: number;
  reads7d: number;
  searches7d: number;
};

export function getStats(vault: Vault): VaultStats {
  const db = openDb(vault.root);
  const tiers: Record<string, number> = {};
  for (const r of db
    .prepare("SELECT COALESCE(tier, 'untriaged') AS t, COUNT(*) AS c FROM notes GROUP BY t")
    .all() as Array<{ t: string; c: number }>) {
    tiers[r.t] = r.c;
  }
  const total = Object.values(tiers).reduce((s, c) => s + c, 0);
  const orphans = (
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM notes WHERE path NOT IN (SELECT DISTINCT dst FROM links)"
      )
      .get() as { c: number }
  ).c;
  db.close();

  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  let reads7d = 0;
  let searches7d = 0;
  for (const s of readSignals(vault.root)) {
    if (s.ts < weekAgo) continue;
    if (s.tool === "kb_read") reads7d++;
    if (s.tool === "kb_search") searches7d++;
  }

  return {
    total,
    tiers,
    l0: tiers["L0"] ?? 0,
    l0Cap: vault.config.l0Cap,
    orphans,
    reads7d,
    searches7d,
  };
}

export function formatStats(s: VaultStats): string {
  const lines = [
    `${s.total} notes under management`,
    ...Object.entries(s.tiers).map(([t, c]) => `- ${t}: ${c}`),
    `L0 capacity: ${s.l0}/${s.l0Cap}`,
    `orphan notes (0 backlinks): ${s.orphans}`,
    `last 7 days: ${s.reads7d} reads, ${s.searches7d} searches via the gate`,
  ];
  if (s.total === 0) lines.push("index is empty — run `kb index`");
  return lines.join("\n");
}
