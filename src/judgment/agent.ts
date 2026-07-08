import type { Vault } from "../core/types.js";
import type { UntriagedNote } from "./human.js";

/**
 * The "agent" provider makes no API calls. It emits a self-contained prompt
 * for whatever agent is connected (Claude Code, or anything speaking MCP) to
 * perform the judgment itself. The system stays agent-agnostic.
 */
export function emitTriagePrompt(vault: Vault, notes: UntriagedNote[]): string {
  return `# Task: triage ${notes.length} untriaged note(s) in the knowledge vault at ${vault.root}

Rules (the metabolism protocol):
- L0 = a core judgment the owner can restate in one sentence + a concrete "when will this be needed again" (kb_use_when). Hard cap ${vault.config.l0Cap}. Be strict.
- L1 = reference material, long-term useful, requires kb_use_when.
- inbox = everything without a defensible kb_use_when. Gets kb_expires = today + ${vault.config.inboxDays} days.
- Entry tax: no use_when → inbox. When unsure, inbox.

For each file below (paths relative to the vault root): read it, then add/update ONLY these frontmatter fields, leaving the body and other fields untouched:
  kb_tier, kb_use_when (L0/L1 only), kb_triaged (today), kb_expires (inbox only)

Files:
${notes.map((n) => `- ${n.path} — ${n.title}`).join("\n")}

When done, run \`kb index --vault ${vault.root}\` and report the tier distribution. List any notes you were unsure about for the owner to decide.`;
}

export function emitDigestPrompt(vault: Vault, reportFile: string): string {
  return `# Task: weekly digest review for the knowledge vault at ${vault.root}

1. Read the kill list at ${reportFile} and sanity-check every candidate (do NOT check any box yourself — the human is the judge; annotate the line instead if a reason looks wrong).
2. Look for duplicate/mergeable notes among managed notes and for L1 notes worth promoting to L0 (use \`kb search\`/\`kb read\` so lookups leave usage signals).
3. Append a "## Digest proposals" section with "- [ ]" checkbox lines to the report file.
4. Tell the owner: candidates count, proposals count, and that approving means checking boxes then running \`kb execute ${reportFile}\`.`;
}
