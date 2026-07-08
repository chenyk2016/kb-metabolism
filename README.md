# kb-metabolism

**A knowledge base that knows how to forget.**

[中文文档 →](README.zh-CN.md)

Most personal knowledge bases only have an *in*. Capture is free in the AI era, so they grow until nobody can read them and nobody dares clean them up. kb-metabolism adds the two missing organs — **digestion** (turning material into restatable judgments) and **excretion** (retiring notes that lost their purpose) — on top of the files you already have.

> Health isn't how many notes you keep. It's that every note has a stated future use. **Expire by default; renew by being used.**

## How it works

```
capture ──▶ triage ──▶ live in tiers ──▶ decay ──▶ trial ──▶ graveyard
  kb add    kb triage   kb search/read    kb digest  human    kb execute
            (entry tax) (logged signals)  (coroner)  checks    (git mv,
                                                     boxes     reversible)
```

- **Files are the only truth.** Plain Markdown + YAML frontmatter. The index (SQLite + FTS5, Chinese-friendly trigram search) is derived and disposable. Uninstall the tool and your notes are untouched.
- **One retrieval gate, always logged.** `kb search` / `kb read` — from the CLI or from any agent via MCP — append to `.kb/access.log.jsonl`. That log is the metabolic signal: reads keep notes alive.
- **Entry tax.** A note that can't answer *"when will I need this again?"* (`kb_use_when`) only gets into the `inbox` tier, where it expires in 30 days unless promoted.
- **Tiers.** `L0` core (hard cap 100 — one restatable judgment each), `L1` reference (findable is enough), `inbox` (expiring), `_graveyard/` (buried, recoverable via git).
- **The coroner proposes, the human judges.** `kb digest` lists notes with zero signals (no reads, no backlinks, untouched past the decay window) as a checkbox kill list. Nothing is ever deleted by AI — you check the boxes, `kb execute` moves them to the graveyard with `git mv`.
- **Judgment is a plugin, not a foundation.** Every deterministic part (expiry, decay, search, burial) works with **no LLM and no API key**. Three judgment providers:
  - `human` (default) — interactive triage in the terminal, zero dependencies
  - `anthropic` — bring your own `ANTHROPIC_API_KEY`; a cheap model triages, a top model writes digest proposals (still just proposals)
  - `agent` — no API calls; `--emit` prints a self-contained prompt for whatever agent is connected (Claude Code, anything speaking MCP)

## Quick start

```bash
npm install -g kb-metabolism

cd ~/notes            # any folder of markdown
kb init --git         # .kb/ config + index + graveyard; git = your undo button
kb triage             # assign tiers interactively (or via LLM/agent)
kb search "fts5"      # retrieval through the gate — logs a signal
kb digest             # weekly: coroner writes the kill list
# review the report, check [x] what you approve, then:
kb execute .kb/reports/kill-list-2026-07-08.md
```

Capture with the tax built in:

```bash
kb add "SQLite Chinese search" --use-when "next time I pick an FTS engine"   # → L1
echo "some one-off research" | kb add "temp findings"                        # → inbox, expires in 30d
```

## Connect your agent (MCP)

The gate speaks Model Context Protocol, so every agent lookup leaves a signal too:

```bash
claude mcp add --scope user kb -- kb serve --vault ~/notes
```

Tools exposed: `kb_search`, `kb_read`, `kb_stats`. Tell your agent: *always retrieve through the gate* — bypassing it grants every note immunity.

## Configuration (`.kb/config.json`)

```jsonc
{
  "managed": ["**/*.md"],          // which notes are governed (globs)
  "exclude": ["_graveyard/**"],
  "captureDir": ".",               // where `kb add` writes
  "l0Cap": 100,
  "inboxDays": 30,
  "decayDays": 90,
  "judgment": {
    "provider": "human",           // human | anthropic | agent
    "triageModel": "claude-haiku-4-5",
    "digestModel": "claude-opus-4-8"
  }
}
```

The vault is self-contained: config, signal log, and reports live in `.kb/` and travel with the folder. Only `kb.db` (rebuildable) is gitignored.

## Commands

| Command | What it does |
|---|---|
| `kb init [--managed <globs>] [--git]` | make any directory a vault |
| `kb add [title] [-w use-when] [-t tier]` | capture (entry tax applies) |
| `kb triage [--emit] [-y]` | tier untriaged notes via the configured provider |
| `kb search <q>` / `kb read <path>` | retrieval gate (logs signals) |
| `kb digest [--emit] [--no-llm]` | reindex + coroner + optional LLM proposals |
| `kb execute <report>` | bury the checked entries (reversible) |
| `kb stats` | vault health |
| `kb serve` | MCP gate over stdio |
| `kb index` | rebuild the derived index |
| `kb migrate --from <old.db>` | import legacy access-log signals |

## Weekly cadence

Five minutes a week: run `kb digest`, read the report, check boxes, `kb execute`. Cron it if you like:

```
30 9 * * 1 kb --vault ~/notes digest
```

## Design invariants

1. Files + git are the truth; everything in SQLite is disposable.
2. The access log is the only non-reproducible data — it lives as an append-only JSONL file inside the vault and survives any rebuild.
3. All retrieval goes through the gate; no log, no decay verdicts.
4. Judgment is allocated by value density: cheap model for triage, top model for digest, human for the verdict.
5. AI proposes, the human judges, git makes every burial reversible.
6. The system must be complete with zero LLM — intelligence only makes it cheaper.
7. The vault is self-contained: copy the folder, take the whole system with you.

## Development

```bash
npm install && npm run build
KB_SMOKE_VAULT=/path/to/a/vault npm run smoke   # MCP end-to-end test
```

MIT © qizai
