---
name: kb-metabolism
description: 知识代谢维护工作流的触发器。当用户要求"分诊/整理 inbox/给笔记定层"、"消化知识库/出处决名单/清理知识库/知识库周报"、"提炼判断/消化资料/chew"时使用。适用于装有 kb-metabolism（kb CLI）并已 kb init 的 Markdown 知识库。
---

# kb-metabolism 维护工作流

薄壳技能：只负责触发，**所有规则与流程以命令输出为准**——任务提示由 kb 现场生成，随产品版本演进，勿在此复述任何协议知识。

按用户意图选一条执行（默认从当前目录向上找库；不在库内时加 `--vault <目录>`）：

| 意图 | 命令 |
|---|---|
| 分诊：给未分诊笔记定层 | `kb triage --emit` |
| 每周消化：法医出名单 + 审查 | `kb digest --emit` |
| 提炼：把高频资料变成判断 | `kb chew --emit` |

**严格按输出的提示执行，不添加、不省略。** 铁律兜底：永远不要替用户勾选处决名单、删除或移动笔记——AI 只提案，人是法官。

支持 MCP prompts 的客户端（如 Claude Code）优先用斜杠命令代替本技能：`/mcp__kb__triage`、`/mcp__kb__digest`、`/mcp__kb__chew`。
