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

cd ~/notes    # 任意 markdown 目录（Obsidian vault 会被自动识别）
kb init       # 交互向导：选管理范围 → git → 注册 Claude MCP → 语义检索，四问装完
              # 装完立刻给你一份体检报告：库里有多少在沉睡
kb triage     # 交互式定层（或 LLM/agent）
kb search "fts5"   # 走门检索——留下信号
kb digest     # 每周：法医产出处决名单（忘了跑门会提醒你）
kb review     # 逐条 y/n 过堂，完了自动掩埋
```

脚本/CI 场景用 `kb init -y` 或显式 flags（`--managed`/`--git`）跳过交互。

## 日常怎么用（重要：几乎不用"用"它）

这个系统的设计哲学是**尽量不被使用**——它是器官，不是要天天打开的工具：

- **日常零操作**：笔记照常在你的编辑器里写；查东西直接问接了门的 agent（hooks 自动带上下文）；想存东西对 agent 说"存进知识库，用途是 XX"
- **每周 5 分钟**：门提醒你时（检索/统计尾部那行 ⚠️）→ `kb digest` 出名单 → `kb review` 逐条 y/n；喜欢图形界面就 `kb ui`，判决台一屏搞定
- **偶尔**：digest 说有资料值得提炼时 → `kb chew` 用自己的话说出判断

**不知道该干什么的时候，直接敲 `kb`**——它会看一眼你的库，告诉你此刻该做的事（或者告诉你什么都不用做）。

### 管理台（`kb ui`）

`kb ui` 在本机起一个判决台 + 体检室（`127.0.0.1:7317`，只绑本机）：总览体检、分层浏览、过堂盖章、分诊定层、消化落 L0、信号流水、配置管理。三条纪律刻在管道里：

- 界面里的浏览与检索记 `kb_ui` 观察信号——**法医不认，不给笔记续命**（在管理界面翻一遍库 ≠ 使用）
- 全站没有删除按钮：删除唯一路径仍是 勾选名单 → 执行（git mv 可反悔），墓地里可一键还魂
- 不做笔记编辑器：改内容回你自己的编辑器，文件永远是唯一真相

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

暴露工具：`kb_search`、`kb_read`、`kb_add`、`kb_cite`、`kb_stats`。给 agent 立一条规矩：**查知识必须走门**——绕过门等于给全部笔记发免死金牌。

### 消化与吸收（完整的代谢）

排泄只是手段，消化才是目的——人们要的不是干净的库，是"存的东西变成判断力"：

- **消化（`kb chew`）**：近 90 天被反复读取的 L1 有营养，值得提炼。AI 是消化酶不是胃——它拆解出候选判断句、追问"当初的用途还成立吗"，**最终判断必须由你亲口说出**（把反思外包给 AI 正是第二大脑失败的病根）。产出的 L0 = 一句判断 + 用途 + 证据链；源资料标记 `kb_digested`，营养已转移，之后可自然衰亡——消化加速排泄，库里不再有中间态囤积。
- **吸收（`kb_cite` + `outputDirs`）**：内容被用进产出才是知识活着的铁证。agent 在回答中实际用了笔记就 `kb_cite` 声明；config 里的 `outputDirs`（创作目录）中的引用是铁证级吸收。信号金字塔落进法医规则：**被引用免死 180 天 > 被读取免死 90 天 > 检索命中/注入不续命**。`kb doctor` 会报告吸收率——你的库喂养了多少创造。

### hooks：门的第二形态（推荐）

MCP 工具靠 agent 自觉调用——它有时不会去搜。hooks 把"走门"变成管道的必然：

```bash
kb hook install          # 写入 ~/.claude/settings.json（备份 .bak，幂等，可 uninstall）
```

之后每个 Claude Code 会话：**每条提问**自动检索知识库、相关就注入摘要（UserPromptSubmit）；**会话开始**自动带上库概况、最近读过的笔记和消化提醒（SessionStart）。三条纪律：只走字面检索（毫秒级零费用）；不够相关就沉默（不制造上下文噪音）；注入记 `kb_inject` 信号但法医不认——机器注入不等于人在使用，不给笔记续命。

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
  "apiKeyEnv": "KB_EMBEDDING_API_KEY"            // 秘密的名字——config 进 git，key 本体见下
}
```

然后 `kb key set` 粘贴一次 key（写入 `.kb/secrets.json`，0600 权限、自动加入 .gitignore），再跑 `kb index` 生成向量（按内容 hash 增量，没改过的笔记不重算）。**配置与秘密分家**：config.json 进 git（系统怎么工作，可同步可复现），secrets.json 永不进 git（你是谁）；key 的解析链是 `环境变量（临时覆盖）→ .kb/secrets.json → 降级纯字面`，一处配置，CLI / MCP 门 / cron / hooks 全部生效，不依赖各进程的 env 继承。`kb key test` 随时验证 key 与向量覆盖率，`kb doctor` 会体检语义层健康（含 secrets 误入 git 的事故检测）。换 key 不用重算向量，换 **model** 才需要全量重嵌。

查询时字面三层与语义余弦各取 top20，按 RRF（`Σ 1/(60+排名)`）融合排序。**不配置或 API 不可用时自动降级纯字面**——语义只是增强，检索永远可用。个人库规模下语义匹配走 JS 全量余弦，无需任何向量数据库。

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
| `kb digest [--emit] [--no-llm]` | 重建索引 + 法医 + 消化名单 + 可选 LLM 提案 + 体检留档 |
| `kb chew [--emit]` | **消化**：把反复被读的 L1 提炼成 L0 判断（AI 拆解，人合成） |
| `kb review [报告]` | **交互式过堂**：逐条 y/n 判决，完了自动执行 |
| `kb execute <报告>` | 掩埋勾选项（可反悔） |
| `kb doctor [--save]` | **体检**：年龄分层/孤儿率/诊断——不依赖信号，新库第一分钟即可用 |
| `kb stats` | 库健康度（距上次消化超一周会在这里和门上提醒你） |
| `kb ui [--port 7317] [--no-open]` | **管理台**：判决台 + 体检室（只绑 127.0.0.1） |
| `kb serve` | MCP 门（stdio） |
| `kb index` | 重建派生索引 |
| `kb migrate --from <旧db>` | 导入旧版 sqlite 访问日志 |

## 每周节律

每周五分钟：`kb digest` → `kb review` 逐条 y/n 过堂，完了自动掩埋。忘了跑也没关系——**门自己会提醒**（检索/统计时距上次消化超一周就带一行提示）。想全自动就 cron：

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

pnpm monorepo；发布物仍是单包 `kb-metabolism`（`@kb/*` 私有包构建期打进 bundle）：

```
packages/core     引擎与协议（索引/法医/体检/消化）——零 LLM 不变量锁在这里
packages/mcp      MCP 检索门（stdio）
packages/server   HTTP API（/api/v1，Hono+zod）——管理台与未来一切集成的正式产品面
packages/cli      kb 命令行（发布包，tsup 打包，web 构建产物随包分发）
apps/web          React 管理台（Vite + Tailwind + TanStack Query）
```

```bash
pnpm install
pnpm build              # cli bundle + 管理台（产物进 packages/cli/dist/）
pnpm typecheck && pnpm test   # 各包 tsc + vitest（core 协议行为 + server 契约）
pnpm test:e2e           # Playwright：三条判决工作流打真实文件系统（先 pnpm build）
KB_SMOKE_VAULT=/path/to/a/vault pnpm smoke   # MCP 端到端冒烟
pnpm dev                # server（tsx watch）+ web（vite，/api 代理到 7317）
```

MIT © 柒崽
