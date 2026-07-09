import type { Vault } from "../types.js";
import type { UntriagedNote } from "./human.js";

/**
 * The "agent" provider makes no API calls. It emits a self-contained prompt
 * for whatever agent is connected (Claude Code, or anything speaking MCP) to
 * perform the judgment itself. The system stays agent-agnostic.
 */
export function emitTriagePrompt(vault: Vault, notes: UntriagedNote[]): string {
  return `# 任务：给知识库 ${vault.root} 中的 ${notes.length} 条未分诊笔记定层

规则（知识代谢协议）：
- L0 = 主人能一句话复述的核心判断 + 具体的"什么时候会再用到"（kb_use_when）。硬上限 ${vault.config.l0Cap} 条，从严。
- L1 = 长期有用的资料/细节，能被检索到即可，必须有 kb_use_when。
- inbox = 写不出站得住脚的 kb_use_when 的一切。写入 kb_expires = 今天 + ${vault.config.inboxDays} 天。
- 入口税：没有 use_when → inbox。拿不准 → inbox。

对下面每个文件（路径相对 vault 根目录）：读内容，然后只增改这些 frontmatter 字段，正文和其他字段一律不动：
  kb_tier、kb_use_when（仅 L0/L1）、kb_triaged（今天）、kb_expires（仅 inbox）

文件清单：
${notes.map((n) => `- ${n.path} — ${n.title}`).join("\n")}

完成后运行 \`kb index --vault ${vault.root}\`，汇报层级分布；拿不准的条目列出来交给主人拍板。`;
}

export function emitChewPrompt(
  vault: Vault,
  candidates: Array<{ path: string; title: string; reads90d: number }>
): string {
  return `# 任务：协助主人消化知识库 ${vault.root} 中的 ${candidates.length} 篇高频资料

这些 L1 资料近 90 天被反复读取——有营养，值得提炼成 L0 判断。你的角色是**消化酶不是胃**：

对每篇：读全文，拆解出 2-3 条候选判断句（一句话、可复述、"下次遇到 X 就 Y"的决策形状，不是摘要），
连同"存入时声明的用途是否仍成立"的追问，一起呈给主人。
**由主人用自己的话说出最终判断**——你绝不代替合成、绝不直接创建 L0。
主人确认后：运行 \`kb chew\`（或按其确认逐条执行 createL0 等价操作），源资料会自动标记 kb_digested。

资料清单：
${candidates.map((c) => `- ${c.path} — ${c.title}（近 90 天读 ${c.reads90d} 次）`).join("\n")}`;
}

export function emitDigestPrompt(vault: Vault, reportFile: string): string {
  return `# 任务：知识库 ${vault.root} 的每周消化审查

1. 读处决名单 ${reportFile}，逐条 sanity check（**不许替主人勾选任何框**——人是法官；判定理由与事实不符的，在该行末尾追加注释说明）。
2. 在受管理笔记中找重复/可合并的，以及值得 L1→L0 升级的（检索用 \`kb search\` / \`kb read\`，让查询留下使用信号）。
3. 把"## 消化提案"章节（"- [ ]" 勾选行）追加到报告文件末尾。
4. 向主人汇报：候选数、提案数，并说明批准方式 = 勾选后运行 \`kb execute ${reportFile}\`。`;
}
