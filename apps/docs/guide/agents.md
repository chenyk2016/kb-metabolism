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
