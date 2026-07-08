# kb-metabolism 知识代谢系统

**一个会遗忘的知识库。**

[English →](README.md)

大多数个人知识库只有"进"。AI 时代收藏成本趋近于零，库越塞越多，人无法通读，也没人敢清理。kb-metabolism 在你已有的 Markdown 文件之上，补齐缺失的两个器官——**消化**（把资料变成可复述的判断）和**排泄**（把失去用途的内容排出去）。

> 知识库的健康度不看存了多少条，看每一条都有明确的未来用途。**默认过期，使用续命。**

## 运作方式

```
捕捉 ──▶ 分诊 ──▶ 分层存活 ──▶ 衰减 ──▶ 审判 ──▶ 墓地
kb add   kb triage  kb search/read  kb digest  人勾选   kb execute
        （入口税）  （信号记账）    （法医）            （git mv 可反悔）
```

- **文件是唯一真相。** 纯 Markdown + frontmatter。索引（SQLite + FTS5，中文 trigram 检索）是派生物，随时可删重建。卸载工具，笔记毫发无损。
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

```bash
claude mcp add --scope user kb -- kb serve --vault ~/notes
```

暴露工具：`kb_search`、`kb_read`、`kb_stats`。给 agent 立一条规矩：**查知识必须走门**——绕过门等于给全部笔记发免死金牌。

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

命令表、配置项见 [英文 README](README.md)。MIT © 柒崽
