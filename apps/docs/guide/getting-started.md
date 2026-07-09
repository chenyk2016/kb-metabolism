# 快速开始

## 安装

```bash
npm install -g kb-metabolism
```

要求 Node.js ≥ 20。安装后获得 `kb` 命令（别名 `kbm`）。

::: tip 还未发布到 npm？
从源码安装：clone 仓库后 `pnpm install && pnpm build`，再 `cd packages/cli && npm i -g .`。
:::

## 初始化：四问装完

```bash
cd ~/notes    # 你的任意 Markdown 目录（Obsidian vault 会被自动识别）
kb init
```

交互向导只问四个真正需要人拍板的问题，其余全靠探测：

1. **哪些目录纳入代谢管理？**——日记/剪藏类目录建议不纳管：它们不受代谢约束，但其中的引用仍算续命信号
2. **初始化 git？**——处决的反悔按钮，强烈建议开
3. **注册 MCP 检索门给 Claude Code？**——检测到 `claude` CLI 才会问
4. **开启语义检索？**——需要任一 OpenAI 兼容 embedding 服务，可跳过

装完立刻得到一份**体检报告**：不等 90 天信号，用 git 历史和反链直接告诉你库里有多少在沉睡。

脚本/CI 场景用 `kb init -y` 或显式 flags 跳过交互。

## 第一周做什么

```bash
kb triage          # 给存量笔记定层（交互式，也可交给 LLM/agent）
kb search "关键词"  # 走门检索——从此每次检索都是续命信号
kb ui              # 打开管理台看全局
```

之后就交给节律：[日常使用](/guide/daily)（零操作）和[每周节律](/guide/weekly)（5 分钟）。

## 目录里多了什么

```
your-notes/
├── .kb/
│   ├── config.json          # 配置（进 git）
│   ├── access.log.jsonl     # 信号日志——唯一不可再生的数据（进 git）
│   ├── reports/             # 法医名单、体检、消化名单留档（进 git）
│   ├── secrets.json         # API key（0600，自动 gitignore，永不进 git）
│   └── kb.db                # 派生索引（gitignore，删了可重建）
└── _graveyard/              # 墓地：被处决的笔记（git mv 可反悔）
```

你的笔记本身只会被添加几个 `kb_*` frontmatter 字段（见[协议规范](/protocol/spec)），内容永远不被改动。
