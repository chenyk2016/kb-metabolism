# kb-metabolism

**A knowledge base that knows how to forget.**

[中文（默认）→](README.md)

Most personal knowledge bases only have an *in*. Capture is free in the AI era, so they grow until nobody can read them and nobody dares clean them up. kb-metabolism adds the two missing organs — **digestion** (turning material into restatable judgments) and **excretion** (retiring notes that lost their purpose) — on top of the files you already have.

> Health isn't how many notes you keep. It's that every note has a stated future use. **Expire by default; renew by being used.**

## How it works

```
capture ──▶ triage ──▶ live in tiers ──▶ decay ──▶ trial ──▶ graveyard
  kb add    kb triage   kb search/read    kb digest  human    kb execute
            (entry tax) (logged signals)  (coroner)  checks    (git mv,
                                                     boxes     reversible)
```

- **Files are the only truth.** Plain Markdown + YAML frontmatter. The index (SQLite + FTS5, CJK-friendly trigram search) is derived and disposable. Uninstall the tool and your notes are untouched.
- **One retrieval gate, always logged.** `kb search` / `kb read` — from the CLI or from any agent via MCP — append to `.kb/access.log.jsonl`. That log is the metabolic signal: reads keep notes alive.
- **Entry tax.** A note that can't answer *"when will I need this again?"* (`kb_use_when`) only gets into the `inbox` tier, where it expires in 30 days unless promoted.
- **Tiers.** `L0` core (hard cap 100 — one restatable judgment each), `L1` reference (findable is enough), `inbox` (expiring), `_graveyard/` (buried, recoverable via git).
- **The coroner proposes, the human judges.** `kb digest` lists notes with zero signals as a checkbox kill list. Nothing is ever deleted by AI — you check the boxes, `kb execute` moves them to the graveyard with `git mv`.
- **Judgment is a plugin, not a foundation.** Every deterministic part works with **no LLM and no API key**. Providers: `human` (default, interactive), `anthropic` (BYO key; cheap model triages, top model drafts digest proposals), `agent` (no API calls; `--emit` prints a self-contained prompt for any connected agent).

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

```bash
claude mcp add --scope user kb -- kb serve --vault ~/notes
```

Tools exposed: `kb_search`, `kb_read`, `kb_stats`. Tell your agent: *always retrieve through the gate* — bypassing it grants every note immunity.

> **Note on language:** this tool is built Chinese-first — CLI output and reports are in Chinese. The mechanics (frontmatter fields, config, report format) are language-neutral; an English CLI locale is a welcome contribution.

## Configuration, commands, invariants

See the Chinese README ([README.md](README.md)) for the full config reference, command table, and the seven design invariants — the code itself (`src/core/`) is documented in English.

## Development

```bash
npm install && npm run build
KB_SMOKE_VAULT=/path/to/a/vault npm run smoke   # MCP end-to-end test
```

MIT © qizai
