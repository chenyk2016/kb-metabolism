# 接入 agent

知识库真正的高频使用者是 agent。接入的原则只有一条：**查知识必须走门**——绕过门直接读文件，等于给全部笔记发免死金牌。

## MCP 检索门

```bash
claude mcp add --scope user kb -- kb serve --vault ~/notes
```

暴露五个工具：`kb_search`、`kb_read`、`kb_add`、`kb_cite`、`kb_stats`（语义见 [MCP 工具参考](/reference/mcp)）。门规随 MCP initialize 自动注入给接入方，不依赖客户端配置。

agent 的每次查询与读取同样留信号——agent 用得越勤，法医的证据越充分。

## 两道税由门强制执行

- **入口税**：`kb_add` 不给 `use_when` 只能进 inbox 限期
- **查重税**：新内容与已有笔记主题重合过半时不写入，返回候选让 agent 先读再决定——优先编辑补充（一个主题一篇笔记），确认新主题才 `force` 重试。防的是 agent"每次都新增、永不合并"的碎片化天性。

## 吸收：kb_cite

内容被用进产出才是知识活着的铁证。agent 在回答中实际使用了某笔记，应调用 `kb_cite` 声明——**被引用**是最高等级的存活证据，免死窗口是读取的两倍。

配置里的 `outputDirs`（创作目录）是另一条吸收通道：其中对库内笔记的引用是铁证级信号，`kb doctor` 会报告吸收率——你的库喂养了多少创造。

## 触发维护工作流：双通道

维护工作流（分诊/消化/提炼）的知识由 `kb ... --emit` 现场生成、随版本演进——触发它有两条通道，按客户端选：

- **MCP prompts**（协议原生）：支持 prompts 的客户端里直接用，Claude Code 中即斜杠命令 `/mcp__kb__triage`、`/mcp__kb__digest`、`/mcp__kb__chew`。
- **官方 skill**（[Agent Skills 开放标准](https://agentskills.io)，40+ 客户端可读）：承担自然语言触发（"帮我消化一下知识库"）与 MCP prompts 支持不全的客户端。仓库 `skills/kb-metabolism/` 下是官方零知识薄壳，装法：

```bash
npx skills add https://github.com/chenyk2016/kb-metabolism --skill kb-metabolism
# 或手动拷贝 skills/kb-metabolism/ 到 ~/.claude/skills/（各客户端目录见其文档）
```

两条通道殊途同归：都只是把 `--emit` 生成的任务提示递给 agent——**协议知识的唯一真相永远在产品里**，skill 与 prompt 均为触发器，不携带任何可漂移的规则。

仓库还提供姊妹技能 `skills/kb-structure/`（目录结构守门）：agent 往库里存笔记、建目录、移动/归档时先过它——拦截顶层膨胀与主题分类树，移动后跑 `kb index` 保住续命信号。它遵循同一哲学：目录规则住**库内** `90-system/目录规范.md`（技能附模板可实例化），技能只带执行程序；目录管"住哪"，kb 管"生死"。

### 零终端：全生命周期都可以只说话

装好官方 skill 后，从建库到过堂全程无需碰终端——agent 是手，产品是笼子，你只负责说意图和判决：建库（对话问齐参数）、分诊、周消化、过堂（"1、3 处决，2 留下"，agent 只勾你逐字点名的）、提炼（判断由你亲口说出，agent 用 `kb chew --judgment` 转录落盘，带 L0 上限检查）。唯一例外是 `kb key set`——密钥不进对话历史，这一行值得你亲手敲。

## hooks：门的第二形态（推荐）

MCP 工具靠 agent 自觉调用——它有时不会去搜。hooks 把"走门"变成管道的必然：

```bash
kb hook install    # 写入 Claude Code settings.json（备份 .bak，幂等，可 uninstall）
```

之后每个会话：**每条提问**自动检索并注入相关摘要（UserPromptSubmit）；**会话开始**自动带库概况与最近读过的笔记（SessionStart）。

三条纪律：只走字面检索（毫秒级零费用，不能让 hook 阻塞你的提问）；不够相关就沉默（不制造上下文噪音）；注入记 `kb_inject` 信号但**法医不认**——机器注入 ≠ 人在使用，不给笔记续命。

## 门的读写边界

| 操作 | 通道 | 原因 |
|---|---|---|
| 取 | 走门（`kb_read`） | 读不留文件系统痕迹，门负责记信号 |
| 进 | 走门（`kb_add`） | 让入口税由机器执行 |
| 改 | 直接编辑文件 | mtime/git 天然记账 |
| 删 | **永远不给 AI** | 只能走处决名单由人勾选 |
