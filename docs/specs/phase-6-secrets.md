# Phase 6：embedding key 的秘密管理——配置与秘密分家

> 2026-07-09，设计在对话中与用户确认通过（"改成单独密码本" → ".kb/secrets.json 与 config 同目录"）。

## 背景

现状：config.json 只存 `apiKeyEnv` 变量名，key 走 `process.env`，永不落盘。实测失败：key 需要在 N 个执行上下文（交互 shell / MCP 进程 / cron / hooks）各配一次，env 继承链互不相通，实际 0/N 配置——55 条笔记只有 40 条向量，MCP 门查询嵌入拿不到 key，语义检索长期静默降级纯字面。

第一性原理：env 继承链不是可靠的分发通道，文件系统才是所有进程的公共通道。"不落盘"把事实源转嫁给了人。key 是可轮换、可限额的付费 API key（非删库级秘密），0600 本地文件足够。

## 目标

1. key 有唯一事实源：`<vault>/.kb/secrets.json`（0600，自动 gitignore），与 config 同目录但不同命运——config 进 git（怎么工作），secrets 永不进 git（你是谁）。
2. 解析链一处实现、全调用点统一：`env[apiKeyEnv]`（临时覆盖）→ `.kb/secrets.json` → 无 key 显式降级。MCP 注册的 `env` 从此不用维护。
3. 失败记账：doctor 报向量覆盖率 x/y、key 来源、secrets 被 git 跟踪的事故检测。

## 修改文件

- `src/core/secrets.ts`（新）：secretsPath / resolveEmbeddingKey / requireEmbeddingKey / writeSecret（0600 + ensureGitignore）/ secretsTrackedByGit
- `src/core/embedding.ts`：embedTexts 改为显式收 key；syncEmbeddings 走 requireEmbeddingKey
- `src/core/search.ts`：hybridSearch 语义路走 requireEmbeddingKey（失败仍降级纯字面）
- `src/core/config.ts`：initVault 的 .kb/.gitignore 增加 secrets.json
- `src/core/doctor.ts`：DoctorReport 增加 embedding 节（keySource / vectors / total / secretsTracked），formatDoctor 输出语义层健康
- `src/cli.ts`：新增 `kb key set`（静默输入，不走 argv 防 shell history 泄露）/ `kb key test`（live 验证 + 覆盖率）；init 完成提示改指 `kb key set`
- `README.md`：语义检索一节改写 key 配置方式

## 不做什么

- 不做 Keychain / 多 provider / 加密凭证文件（收敛：0600 文件匹配威胁模型）
- 不做用户级 `~/.config/kb/credentials`（少一个概念；多 vault 各自 set 一次）
- 不改向量与嵌入协议本身；换 key 不重嵌，换 model 才重嵌（文档写明）
