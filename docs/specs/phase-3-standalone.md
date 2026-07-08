# 阶段 3 规格：从个人工具到独立知识管理系统

> 2026-07-08 · 状态：**待确认** · 前置：阶段 0-2 已上线（检索门 + 法医 + 双 skill）

## 需求原文与隐含需求

原文：「把这个工具做成一个知识管理的系统，需要可以单独使用」。

"单独使用"从第一性原理拆开是**四个解耦**：

| 解耦 | 现状（耦合） | 目标 |
|---|---|---|
| 与我的库解耦 | 路径写死 00-my-inbox | 任意目录 `kb init` 即成为一个知识库 |
| 与 Claude Code 解耦 | 分诊/消化是 CC skill，检索只有 MCP | 自带 `kb` CLI，全流程无 agent 也能跑 |
| 与特定 LLM 解耦 | 判断力默认我的 Claude 会话 | 判断力是**插件**：human / anthropic / agent 三种 provider |
| 与我的机器解耦 | 索引在项目目录，装置靠手工 | `npm i -g` 一条命令装好；**vault 自包含**，拷走目录=带走整个系统（含信号日志） |

"知识管理的系统"（相对"代谢工具"）意味着补上缺失的器官：

- **进**（capture）：现在笔记怎么进来系统不管 → 需要 `kb add`（入口即收税）
- **取的人口**：现在只有 MCP，人不用 agent 时无门可走 → `kb search/read` CLI（人肉查询同样记信号）
- **多库**：一台机器可以有 N 个独立 vault，互不干扰

## 第一性原理推导（新增两条不变量）

继承阶段 0 的五条不变量（文件为真相 / 日志不可再生 / 检索必走门 / 判断力按价值密度分配 / AI 提案人判决），新增：

**六、判断力是插件，不是地基。**
系统的完备性拆解：五个器官 = 进 / 存 / 取 / 衰 / 审。其中"存、取、衰、审、执行"全部是**确定性操作**（过期判定、零信号判定、git mv 都不需要智能）；只有"分诊定层"和"消化提案"需要判断力。所以：无 LLM 时系统必须完整可用（判断由人在 CLI 里做），有 LLM 时只是省力。这是"可以单独使用"的真正含义——不绑定任何 agent 生态，Claude Code 从"宿主"降级为"其中一种接入方式"。

**七、vault 自包含。**
一个知识库的全部状态住在库目录内：笔记 + `.kb/`（配置、索引、**access_log**、报告）+ `_graveyard/`。换机器、备份、多库并存都不丢代谢信号。索引仍可重建，日志仍不可再生——只是从"项目的 data/"搬进"vault 的 .kb/"。

## 形态

npm 包（暂名 `kb-metabolism`，bin 名 `kb`），Node ≥20。无守护进程，CLI 一次性执行，节律交给 cron/手动。

```
任意目录/                      ← 一个 vault
├── （你的 markdown 笔记，结构随意）
├── _graveyard/                ← L2 墓地
└── .kb/
    ├── config.json            ← 见下
    ├── kb.db                  ← 索引（可重建）+ access_log（永不清空）
    └── reports/               ← kill-list-*.md、周报
```

```jsonc
// .kb/config.json
{
  "managed": ["**/*.md"],          // 管理范围 glob（默认全库；我的库配 ["00-my-inbox/**"]）
  "exclude": ["_graveyard/**", "assets/**"],
  "l0Cap": 100,
  "inboxDays": 30,
  "decayDays": 90,
  "judgment": {                     // 判断力插件
    "provider": "human",            // human | anthropic | agent
    "model": "claude-haiku-4-5-20251001"   // 仅 anthropic：分诊用便宜模型
  }
}
```

## 命令面（全集）

| 命令 | 职责 | 需要判断力？ |
|---|---|---|
| `kb init` | 交互式建 `.kb/`，可选 git init | 否 |
| `kb add [--tier L1] [--file f] [标题]` | 捕捉（stdin/文件/参数），生成带 frontmatter 的笔记；**不给 use_when 就自动 inbox+30 天** | 否 |
| `kb search <词>` / `kb read <路径>` | CLI 检索门，与 MCP 同一实现同一日志 | 否 |
| `kb triage` | 分诊未定层笔记 | **是**（provider） |
| `kb digest` | index + 法医 + 消化提案 → 报告 | 法医否；提案**是** |
| `kb execute <report>` | 处决勾选项 → `_graveyard/` → 重建索引 | 否 |
| `kb stats` | 健康度 | 否 |
| `kb serve` | 启动 MCP server（stdio），任意 agent 接入这道门 | 否 |
| `kb index` | 手动重建索引 | 否 |

## 判断力插件（Judgment Provider 接口）

```ts
interface JudgmentProvider {
  proposeTier(note): Promise<{ tier, useWhen?, reason }>;
  proposeDigest(candidates, stats): Promise<Proposal[]>;  // 合并/升级/挤位提案
}
```

1. **human**（默认，零依赖）：`kb triage` 逐条展示标题+首 300 字，交互式问人定层——系统没有任何 API key 也完整可用
2. **anthropic**：BYO API key（环境变量 `ANTHROPIC_API_KEY`），分诊走便宜模型，消化走好模型；提案仍落报告等人勾选
3. **agent**：不调 API，`kb triage --emit` 输出提案任务的 prompt（现在的两个 skill 退化为这个 provider 的"配方文档"），由接入的 agent 完成后回写

三种 provider 产出物相同：**提案**。执行permission 永远在人。

## 现有库的迁移（不丢信号）

1. 在 `notes/content` 跑 `kb init`，config.managed = `["00-my-inbox/**"]`
2. `kb migrate --from <旧 data/kb.db>`：把已积累的 access_log 行导入 `.kb/kb.db`（信号从 2026-07-07 起算的连续性保住）
3. 重注册 MCP：`claude mcp add --scope user kb -- kb serve --vault ~/.openclaw/shared/notes/content`
4. 两个 skill 改为薄壳：调 `kb triage --emit` / `kb digest`

## 实施阶段

- **P3.1 抽核**：现有代码重构为 `core/`（vault 模型、索引、信号、法医、执行——纯函数无 LLM）+ `adapters/`（cli、mcp）；config 化全部路径与阈值；`kb init/index/search/read/stats/serve` 可用
- **P3.2 闭环**：`kb add / triage(human) / digest / execute / migrate`——至此无任何 AI 依赖的完整知识管理系统成立
- **P3.3 增强**：anthropic provider + `--emit` agent provider + npm 打包发布（bin、README、`npx` 可跑）
- **v2 以后**：本地 web 健康面板、向量检索插槽、英文文档/开源运营——本期不做

## 不做什么

- 不做云服务/账号体系——vault 即全部，同步交给 git/网盘
- 不做常驻 watcher/daemon
- 不做私有格式——永远是纯 markdown + frontmatter，卸载系统笔记毫发无损
- 不内置向量检索（core 留 SearchBackend 接口位）
- 不做多人协作——这是单人知识代谢系统

## 验收

1. 在一个全新空目录：`kb init && kb add "测试" && kb triage && kb search 测试 && kb digest`——全程无 API key、无 Claude Code，闭环跑通
2. 同机第二个 vault 互不串库
3. 我的 00-my-inbox 迁移后：旧 access_log 行数在新库可查，MCP 检索门行为与阶段 1 一致
4. `npm pack` 产物在干净机器（无本项目源码）可 `npm i -g` 后完成验收 1
