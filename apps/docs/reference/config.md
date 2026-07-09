# 配置（.kb/config.json）

`config.json` 进 git（系统怎么工作），`secrets.json` 永不进 git（你是谁）。

```jsonc
{
  "version": 1,
  "managed": ["**/*.md"],
  "exclude": ["_graveyard/**", ".kb/**", ".obsidian/**", "node_modules/**", "assets/**"],
  "captureDir": ".",
  "l0Cap": 100,
  "inboxDays": 30,
  "decayDays": 90,
  "citeDays": 180,
  "outputDirs": [],
  "judgment": {
    "provider": "human",
    "triageModel": "claude-haiku-4-5",
    "digestModel": "claude-opus-4-8"
  },
  "embedding": {
    "baseUrl": "https://api.siliconflow.cn/v1",
    "model": "BAAI/bge-m3",
    "apiKeyEnv": "KB_EMBEDDING_API_KEY"
  }
}
```

## 字段语义

| 字段 | 默认 | 说明 |
|---|---|---|
| `version` | 1 | 协议版本（见[规范](/protocol/spec#版本与演进承诺)） |
| `managed` | `["**/*.md"]` | 受代谢管理的笔记范围（glob，相对 vault 根） |
| `exclude` | 见上 | 完全排除：**连反链扫描都跳过**。想"不纳管但引用算信号"请收窄 `managed` 而不是加 `exclude` |
| `captureDir` | `.` | `kb add` 写入的目录 |
| `l0Cap` | 100 | L0 硬上限——判断层的稀缺性就是它的价值 |
| `inboxDays` | 30 | inbox 限期 |
| `decayDays` | 90 | 读取免死窗口 / 修改衰减窗口 |
| `citeDays` | 180 | 引用免死窗口（被用进产出的证据效力是读取的两倍） |
| `outputDirs` | `[]` | 创作目录（相对 vault 根）：其中对库内笔记的引用 = 铁证级吸收信号 |
| `judgment.provider` | `human` | 判断力插件：`human`（交互，零依赖）/ `anthropic`（LLM 提案）/ `agent`（emit 提示词） |
| `judgment.triageModel` | haiku | 分诊是高频低价值判断——便宜模型 |
| `judgment.digestModel` | opus | 消化提案值得顶级模型 |
| `embedding` | 无 | 语义检索插件；不配置 = 纯字面，零依赖不变量不破（见[语义检索](/guide/semantic-search)） |

## secrets.json

`kb key set` 写入，0600 权限，自动加入 `.kb/.gitignore`。key 解析链：

```
环境变量 env[apiKeyEnv]（临时覆盖）→ .kb/secrets.json → 无 key（静默降级纯字面）
```

一处配置，CLI / MCP / cron / hooks 全部生效。`kb doctor` 含"secrets 被 git 跟踪"事故检测——中招立即 `git rm --cached` 并轮换 key。
