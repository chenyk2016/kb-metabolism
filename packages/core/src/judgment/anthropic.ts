import Anthropic from "@anthropic-ai/sdk";
import type { Candidate } from "../coroner.js";
import type { TierDecision, Vault } from "../types.js";
import type { VaultStats } from "../stats.js";
import type { UntriagedNote } from "./human.js";

const TRIAGE_SCHEMA = {
  type: "object",
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          tier: { type: "string", enum: ["L0", "L1", "inbox"] },
          use_when: { type: "string" },
          reason: { type: "string" },
        },
        required: ["path", "tier", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["decisions"],
  additionalProperties: false,
} as const;

const TRIAGE_SYSTEM = `You are the triage officer of a personal knowledge base with a metabolism:
- L0 (core, hard cap): only a judgment/conclusion the owner should be able to restate in one sentence, AND a clear future use. Be very strict.
- L1 (reference): long-term useful material/details that only needs to be findable by search. Requires a concrete "use_when" (when will this be needed again).
- inbox: everything else — one-off references, tasks, anything without a defensible use_when. Inbox notes expire in 30 days unless promoted.

The entry tax is absolute: if you cannot write a concrete use_when, the note goes to inbox. When unsure between L1 and inbox, choose inbox. Write use_when and reason in the same language as the note.`;

function client(): Anthropic {
  return new Anthropic();
}

/** batch tier proposals — cheap, high-frequency judgment on a cheap model */
export async function anthropicTriage(
  vault: Vault,
  notes: UntriagedNote[]
): Promise<TierDecision[]> {
  const listing = notes
    .map(
      (n) =>
        `<note path="${n.path}">\n${n.title}\n${n.head.replace(/\s+/g, " ").slice(0, 400)}\n</note>`
    )
    .join("\n");

  const response = await client().messages.create({
    model: vault.config.judgment.triageModel,
    max_tokens: 16000,
    system: TRIAGE_SYSTEM,
    output_config: { format: { type: "json_schema", schema: TRIAGE_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `Triage every note below. Return one decision per note, using the exact path given.\n\n${listing}`,
      },
    ],
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
  const parsed = JSON.parse(text) as {
    decisions: Array<{ path: string; tier: "L0" | "L1" | "inbox"; use_when?: string; reason: string }>;
  };
  const known = new Set(notes.map((n) => n.path));
  return parsed.decisions
    .filter((d) => known.has(d.path))
    .map((d) => {
      // enforce the entry tax even against the model
      const tier = d.tier !== "inbox" && !d.use_when?.trim() ? "inbox" : d.tier;
      return { path: d.path, tier, useWhen: d.use_when?.trim() || undefined, reason: d.reason };
    });
}

const JUDGMENT_SCHEMA = {
  type: "object",
  properties: {
    judgments: { type: "array", items: { type: "string" } },
  },
  required: ["judgments"],
  additionalProperties: false,
} as const;

/**
 * 消化酶：把一篇资料拆解成 2-3 条候选判断句，供人改写确认。
 * AI 只拆解不合成——最终判断必须出自人之口，否则是把反思外包（病根本身）。
 */
export async function anthropicChew(
  vault: Vault,
  note: { title: string; head: string; useWhen: string | null }
): Promise<string[]> {
  const response = await client().messages.create({
    model: vault.config.judgment.digestModel,
    max_tokens: 2048,
    thinking: { type: "adaptive" },
    system:
      "你是个人知识库的消化酶。把一篇资料拆解成 2-3 条候选判断句，供主人改写确认。判断句的标准：一句话、可复述、面向未来的决策（'下次遇到 X 就 Y'的形状），不是内容摘要。用资料本身的语言书写。",
    output_config: { format: { type: "json_schema", schema: JUDGMENT_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `标题：${note.title}\n存入时声明的用途：${note.useWhen ?? "（未声明）"}\n正文开头：\n${note.head}`,
      },
    ],
  });
  const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
  return (JSON.parse(text) as { judgments: string[] }).judgments.slice(0, 3);
}

/** digest proposals (merge/promote/evict) — worth the top model */
export async function anthropicDigest(
  vault: Vault,
  candidates: Candidate[],
  stats: VaultStats,
  noteList: Array<{ path: string; title: string; tier: string | null; use_when: string | null }>
): Promise<string> {
  const response = await client().messages.create({
    model: vault.config.judgment.digestModel,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: `You are the weekly digest reviewer of a personal knowledge base with a metabolism (L0 core capped at ${vault.config.l0Cap} / L1 reference / inbox expiring). You receive the kill-list candidates (data-driven, produced by fixed rules) and the full note list. Your job:
1. Sanity-check each candidate — if a reason looks wrong given the data, say so.
2. Propose merges for duplicate/overlapping notes.
3. Propose promotions (L1→L0 for notes that read like core judgments) and L0 evictions if near the cap.
Output a markdown section titled "## Digest proposals" with checkbox lines ("- [ ] ...") the owner can approve. Propose only — never instruct deletion outside the kill list. Write in the same language as the notes. If there is nothing to propose, output the section with "Nothing to propose."`,
    messages: [
      {
        role: "user",
        content: `Stats:\n${JSON.stringify(stats)}\n\nKill-list candidates:\n${JSON.stringify(candidates, null, 1)}\n\nAll managed notes:\n${noteList
          .map((n) => `- ${n.path} | ${n.tier ?? "untriaged"} | ${n.title} | ${n.use_when ?? ""}`)
          .join("\n")}`,
      },
    ],
  });
  return response.content.find((b) => b.type === "text")?.text ?? "";
}
