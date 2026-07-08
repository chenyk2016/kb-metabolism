# kb-metabolism 知识代谢系统

**一个会遗忘的知识库。**

[English →](README.en.md)

大多数个人知识库只有"进"。AI 时代收藏成本趋近于零，库越塞越多，人无法通读，也没人敢清理。kb-metabolism 在你已有的 Markdown 文件之上，补齐缺失的两个器官——**消化**（把资料变成可复述的判断）和**排泄**（把失去用途的内容排出去）。

> 知识库的健康度不看存了多少条，看每一条都有明确的未来用途。**默认过期，使用续命。**

## 运作方式

```
捕捉 ──▶ 分诊 ──▶ 分层存活 ──▶ 衰减 ──▶ 审判 ──▶ 墓地
kb add   kb triage  kb search/read  kb digest  人勾选   kb execute
        （入口税）  （信号记账）    （法医）            （git mv 可反悔）
```

- **文件是唯一真相。** 纯 Markdown + YAML frontmatter。索引（SQLite + FTS5，中文友好的 trigram 检索）是派生物，随时可删重建。卸载工具，笔记毫发无损。
- **一道检索门，永远记账。** `kb search` / `kb read`——CLI 或任意 agent 走 MCP——都会追加到 `.kb/access.log.jsonl`。这份日志就是代谢信号：被读取 = 续命。
- **入口税。** 写不出"什么时候会再用到"（`kb_use_when`）的笔记只能进 `inbox` 层，30 天不升级就进候选名单。
- **四层。** `L0` 核心（硬上限 100，每条一句可复述的判断）、`L1` 资料（能检索到即可）、`inbox`（限期）、`_graveyard/`（已掩埋，git 可反悔）。
- **法医提案，人当法官。** `kb digest` 把零信号笔记（无读取、无反链、超过衰减窗口未动）列成勾选名单。AI 永远不直接删除——你勾选，`kb execute` 用 `git mv` 移入墓地。
- **判断力是插件，不是地基。** 所有确定性环节（过期、衰减、检索、掩埋）**无 LLM、无 API key 也完整可用**。三种判断力 provider：
  - `human`（默认）——终端交互式分诊，零依赖
  - `anthropic`——自带 `ANTHROPIC_API_KEY`；便宜模型分诊，顶级模型写消化提案（仍然只是提案）
  - `agent`——不调 API；`--emit` 输出自包含 prompt，交给接入的任意 agent（Claude Code 或任何会说 MCP 的）

## 快速开始

```bash
npm install -g kb-metabolism

cd ~/notes            # 任意 markdown 目录
kb init --git         # 生成 .kb/ 配置 + 索引 + 墓地；git 是反悔按钮
kb triage             # 交互式定层（或 LLM/agent）
kb search "fts5"      # 走门检索——留下信号
kb digest             # 每周：法医产出处决名单
# 审阅报告，勾选 [x] 批准的，然后：
kb execute .kb/reports/kill-list-2026-07-08.md
```

带税捕捉：

```bash
kb add "SQLite 中文检索" --use-when "下次选全文检索引擎时"   # → L1
echo "一次性调研内容" | kb add "临时发现"                    # → inbox，30 天过期
```

## 接入 agent（MCP）

检索门会说 Model Context Protocol，agent 的每次查询同样留信号：

```bash
claude mcp add --scope user kb -- kb serve --vault ~/notes
```

暴露工具：`kb_search`、`kb_read`、`kb_add`、`kb_stats`。给 agent 立一条规矩：**查知识必须走门**——绕过门等于给全部笔记发免死金牌。

门的读写边界是刻意设计的：**取**走门（读不留文件系统痕迹，门负责记信号）；**进**走门（`kb_add` 让入口税由机器执行，也服务没有文件系统的纯 MCP 客户端）；**改**直接编辑文件（mtime/git 天然记账）；**删**永远不给 AI——只能走处决名单由人勾选。

`kb_add` 还带**查重税**：新内容的标题+首段若与某篇已有笔记重合过半，不会写入，而是返回候选让调用方先读再决定——优先编辑补充（一个主题一篇笔记），确认是新主题才 `force=true` 强制新增。防的是 agent"每次都新增、永不合并"的碎片化天性；漏网的碎片还有每周消化的合并提案兜底。

## 配置（`.kb/config.json`）

```jsonc
{
  "managed": ["**/*.md"],          // 受管理的笔记范围（glob）
  "exclude": ["_graveyard/**"],
  "captureDir": ".",               // kb add 写入的目录
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

vault 自包含：配置、信号日志、报告都在 `.kb/` 里，跟着目录走。只有可重建的 `kb.db` 被 gitignore。

### 语义检索（可选增强）

字面检索跨不过词汇鸿沟（搜"电话"找不到只写"手机号"的笔记）。在 config 里加一节 `embedding` 即可开启**字面 + 语义双路召回、RRF 融合**：

```jsonc
"embedding": {
  "baseUrl": "https://api.siliconflow.cn/v1",   // 任何 OpenAI 兼容端点：硅基流动/Voyage/OpenAI/Ollama
  "model": "BAAI/bge-m3",
  "apiKeyEnv": "KB_EMBEDDING_API_KEY"            // 存环境变量名——config 进 git，key 永不落盘
}
```

然后 `export KB_EMBEDDING_API_KEY=sk-xxx` 并跑一次 `kb index`（向量按内容 hash 增量计算，没改过的笔记不重算）。查询时字面三层与语义余弦各取 top20，按 RRF（`Σ 1/(60+排名)`）融合排序。**不配置或 API 不可用时自动降级纯字面**——语义只是增强，检索永远可用。个人库规模下语义匹配走 JS 全量余弦，无需任何向量数据库。

几个容易踩的点：

- **检索直接用自然语言**，不需要学任何语法。三层逐级降级：整串连续命中 > 空格显式分词全命中 > 自动分词（中文按二字词切分）按相关度排序——组合词如"业主服务测试账号"即使从未连续出现过，也会按覆盖度和词权重排出相关笔记。

- **`managed` 收窄 ≠ `exclude`**。想让某目录（如 `daily/`）"不受代谢管理、但它的引用算反链信号"，做法是把 `managed` 收窄到知识目录（如 `["knowledge/**/*.md"]`），别把 daily 放进 `exclude`——被 exclude 的文件连反链扫描都会跳过。
- **wiki 链接按完整文件名匹配**。`kb add` 生成的文件带日期前缀（`2026-07-08-标题.md`），手写 `[[链接]]` 时要用完整名（Obsidian 的自动补全默认就是全名，不受影响）。

## 命令

| 命令 | 职责 |
|---|---|
| `kb init [--managed <globs>] [--git]` | 任意目录变成知识库 |
| `kb add [标题] [-w 何时再用] [-t 层级]` | 捕捉（入口税自动生效） |
| `kb triage [--emit] [-y]` | 按配置的 provider 给未分诊笔记定层 |
| `kb search <词>` / `kb read <路径>` | 检索门（记信号） |
| `kb digest [--emit] [--no-llm]` | 重建索引 + 法医 + 可选 LLM 提案 |
| `kb execute <报告>` | 掩埋勾选项（可反悔） |
| `kb stats` | 库健康度 |
| `kb serve` | MCP 门（stdio） |
| `kb index` | 重建派生索引 |
| `kb migrate --from <旧db>` | 导入旧版 sqlite 访问日志 |

## 每周节律

每周五分钟：`kb digest` → 看报告 → 勾选 → `kb execute`。想自动化就 cron：

```
30 9 * * 1 kb --vault ~/notes digest
```

## 设计不变量

1. 文件 + git 是真相，SQLite 里的一切可丢弃
2. 访问日志是唯一不可再生的数据——以追加式 JSONL 存在 vault 内，重建索引不受影响
3. 检索必须走门；没有日志就没有衰减判定
4. 判断力按价值密度分配：分诊用便宜模型，消化用顶级模型，判决归人
5. AI 提案、人判决、git 兜底可反悔
6. 零 LLM 时系统必须完整——智能只是让它更省力
7. vault 自包含：拷走目录 = 带走整个系统

## 开发

```bash
npm install && npm run build
KB_SMOKE_VAULT=/path/to/a/vault npm run smoke   # MCP 端到端冒烟
```

MIT © 柒崽
