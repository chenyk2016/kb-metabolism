# Phase 12：kb promote——补上 inbox 的晋升通道

> 2026-07-10。协议要求 inbox"30 天内升级或进名单"，但工具链只造了死亡通道没造晋升通道：
> triage 只看未分诊（tier IS NULL）、chew 只做 L1→L0、review 只有 y/n。
> 唯一升级方式是手改 frontmatter——摩擦不对称（死亡零摩擦、晋升最高摩擦），
> 且过期 inbox 被赦免后不改层级，下周继续上榜——钉子户吃光每周审批预算。

## 目标

一个动作四个入口，把"升级"塞进用户本来就会走的动线：

### 1. core：`promoteNote(vault, rel, tier, useWhen)`（新文件 `packages/core/src/promote.ts`）

- **入口税照收**：`useWhen` 空 → 抛错（堵住手改绕税的洞）
- 路径必须在 vault 内且文件存在；目标层只能向上（inbox/未分诊 → L1/L0，L1 → L0）；已是目标层 → 报错
- 升 L0 过容量检查（与 `createL0` 同规：满了先挤位）
- frontmatter 变更：`kb_tier`=目标层、`kb_use_when`=useWhen、`kb_triaged`=今天、**删 `kb_expires`**；`kb_id` 不动（信号跟人走）
- 纯文件操作，调用方负责 `runIndex`

### 2. CLI：`kb promote <path> -w <用途> [-t L1|L0]`

默认升 L1。同时 **`kb review` 加第三个键**：y 处决 / n 赦免 / **p 升级**（追问一句 use_when，默认升 L1）——判决现场就是"这条有用"被意识到的瞬间，摩擦最低的落点。升级后的条目不勾选（等价赦免），且层级已变，下周不再上榜。

### 3. MCP：`kb_promote` 工具

参数 `path`、`use_when`（必填）、`tier`（默认 L1）。管理范围校验与 `kb_read` 同规。
门规（GATE_INSTRUCTIONS）补一条：用户明确说"这条留下/升级，用途是 XX"时用 kb_promote 代办。
**协议边界不变**：删除/移动仍然永不给 AI；升级是建设性动作，税由机器强制，AI 可代办。

### 4. UI + HTTP API

- server：`POST /api/v1/promote`（zod：path/tier/useWhen），复用 core，成功后重建索引
- web 判决台候选行加"升级"按钮：点击 → 填 use_when → 调接口 → 刷新列表

## 修改文件

- `packages/core/src/promote.ts`（新增）+ `index.ts` 导出
- `packages/core/test/promote.test.ts`（新增）：升级清 expires/落 use_when、无 use_when 拒绝、L0 容量、同层拒绝、降级拒绝
- `packages/cli/src/cli.ts` — promote 子命令 + review 的 p 分支
- `packages/mcp/src/server.ts` — kb_promote 工具 + 门规更新
- `packages/server/src/schemas.ts`、`app.ts` — PromoteSchema + 端点 + 契约测试
- `apps/web/src/App.tsx`（判决台升级按钮）
- 文档：README 命令表、guide/weekly.md（p 键）、reference/cli.md、reference/mcp.md、reference/http-api.md

## 不做什么

- **不做降级**（L0→L1 的挤位仍是消化仪式里的显式人工编辑）
- **不给升级记使用信号**——升级是判决不是使用，git 已记账；法医口径不掺水
- **不自动升级**——AI 只能在用户明说时代办，不许法医/分诊自动晋升
