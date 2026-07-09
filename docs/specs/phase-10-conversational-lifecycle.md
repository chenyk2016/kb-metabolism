# Phase 10：对话式全生命周期——零终端管理知识库

> 2026-07-09，设计在对话中与用户确认（"都做"）。目标：用户全程只说话，agent 是手，产品是笼子。

## 背景

skill/MCP prompts 已覆盖分诊、消化、过堂（对话式审批），但两处缺口挡住"零终端"：
1. **chew 落 L0 有陷阱**：`createL0` 的 L0 硬上限检查只存在于交互式 `kb chew`；agent 代驾若用 `kb_add -t L0` 落盘会绕过 100 条上限与 kb_digested 闭环。
2. **SKILL.md 只路由三个维护工作流**：建库、过堂、体检没有触发入口。

第一性原理：管理 = 强制层（运行时）+ 知识层（emit prompts）+ 手（agent 替人执行）。零终端的本质是换手，判决权不随手转移。

## 目标

1. `kb chew --judgment <一句判断> --use-when <用途> --source <路径...>`：非交互落 L0，复用 `createL0`（含 L0 上限检查、证据链、源标 kb_digested）+ runIndex。三参数必须同时给，缺一报错。
2. `emitChewPrompt` 更新落盘指引：主人说出判断后，agent 用上述命令提交——堵死 `kb_add -t L0` 代驾路径。
3. SKILL.md 升级全生命周期版：新增 建库（对话问齐参数 → `kb init -y` flags）、过堂（对话式审批 → `kb execute`）、体检（`kb doctor`）路由；保持零知识（只列稳定 CLI 契约，不复述协议）。
4. 文档同步：reference/cli.md（chew flags）、guide/agents.md（零终端一段）、README 命令表。

## 修改文件

- `packages/cli/src/cli.ts`：chew 命令加三个 option + 非交互分支
- `packages/core/src/judgment/agent.ts`：emitChewPrompt 落盘指引
- `skills/kb-metabolism/SKILL.md`：全生命周期路由表
- `apps/docs/reference/cli.md`、`apps/docs/guide/agents.md`、`README.md`

## 不做什么

- 不给 MCP 加 chew 落盘工具（判断必须出自人口，CLI 参数由 agent 转录主人原话足矣；MCP 工具会诱导 agent 自己合成判断）
- 不做 `kb key set` 的对话化（密钥不过对话历史——有意保留的一行终端）
- 不在 skill 里复述 init 向导的四问逻辑（只列 flags 契约）
