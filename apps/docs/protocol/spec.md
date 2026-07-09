# 代谢协议规范 v1

::: info 本页地位
这是 kb-metabolism 代谢协议的**权威规范**，供兼容实现引用。工具可以被重写，协议和信号日志跟人走。
当前协议版本：**1**（与 `.kb/config.json` 的 `version` 字段对齐）。
:::

## 设计不变量

任何声称兼容本协议的实现必须满足：

1. **文件 + git 是真相**，一切索引均为派生物，可随时丢弃重建
2. **访问日志是唯一不可再生的数据**——追加式 JSONL，存于 vault 内，重建索引不得影响它
3. **检索必须走门**；没有日志就没有衰减判定
4. **AI 提案、人判决、git 兜底可反悔**——不存在自动删除
5. **零 LLM 时系统必须完整**——智能只是省力插件
6. **vault 自包含**：拷走目录 = 带走整个系统；秘密（`secrets.json`）永不进 git

## 分层模型

```
L0 核心（人读）   ≤ l0Cap（默认 100）条硬上限。每条 = 一句可复述判断 + 何时会再用。
L1 资料（AI 读）  能被检索到即可。零信号超过衰减窗口 → 处决候选。
inbox（暂存）     inboxDays（默认 30 天）到期。到期前升级或进名单。
_graveyard/       墓地。git mv 移入，可反悔；随时可真删（人工）。
```

## frontmatter 字段

被管理笔记的 YAML frontmatter 使用 `kb_` 前缀命名空间：

| 字段 | 类型 | 必填 | 含义 |
|---|---|---|---|
| `kb_tier` | `"L0" \| "L1" \| "inbox"` | 分诊后必有 | 层级；缺失 = 未分诊 |
| `kb_use_when` | string | L0/L1 必填 | 一句话：什么时候会再用到（**入口税**） |
| `kb_triaged` | `YYYY-MM-DD` | 分诊后必有 | 分诊日期 |
| `kb_expires` | `YYYY-MM-DD` | 仅 inbox | 过期日，默认分诊日 + inboxDays |
| `kb_digested` | boolean | 可选 | 已被消化为 L0，营养转移完毕 |

**入口税铁律：写不出 `kb_use_when` 的内容，只能进 inbox 层。** 兼容实现不得绕过。

## 信号日志（access.log.jsonl）

位置：`<vault>/.kb/access.log.jsonl`。追加式 JSONL，每行一条：

```json
{"ts":"2026-07-09T10:23:29.390Z","tool":"kb_read","path":"sqlite-fts5.md"}
{"ts":"2026-07-09T10:24:01.102Z","tool":"kb_search","query":"全文检索"}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `ts` | ISO 8601 | 信号时间（UTC） |
| `tool` | string | 信号来源（见下表；命名空间开放，未知工具必须被容忍） |
| `path` | string? | 相对 vault 根的笔记路径（读取/引用类信号必有） |
| `query` | string? | 检索词（检索类信号必有） |

### 信号金字塔（法医认定的效力等级）

| tool | 语义 | 免死窗口 |
|---|---|---|
| `kb_cite` | 被引用进真实产出 | **citeDays（默认 180 天）** |
| `kb_read` | 经门读取全文 | **decayDays（默认 90 天）** |
| `kb_search` / `kb_add` | 检索、捕捉 | 不续命（记账用） |
| `kb_inject` | hooks 机器注入 | **不续命**——机器注入 ≠ 人在使用 |
| `kb_ui` | 管理界面浏览/检索 | **不续命**——观察 ≠ 使用 |

兼容实现新增信号类型时：**默认不续命**。让一种信号续命是协议级决定，必须升版本。

解析容错：读取方必须容忍撕裂行（进程中断产生的半行 JSON），跳过即可。

## 法医判定规则

法医只产出**提案**（处决名单），执行必须经人批准。一篇笔记成为候选，当且仅当：

- **inbox 层**：`kb_expires` 已过；或
- **非 L0 层**同时满足全部四条：
  1. 最后一次 `kb_read` 距今超过 `decayDays`（或从未被读）
  2. 最后一次 `kb_cite` 距今超过 `citeDays`（或从未被引用）
  3. 反向链接数 = 0（全 vault 扫描，含不受管理的目录；`exclude` 的除外）
  4. 最后修改（git 提交时间，非 git 仓库则 mtime）距今超过 `decayDays`

**L0 永不上榜**——挤掉 L0 是消化仪式里的显式人工动作，不是法医的职权。

## 处决与反悔

- 名单格式：Markdown checkbox 列表（`- [ ] \`path\` — 理由`），人勾选 `[x]` 即批准
- 执行 = `git mv` 到 `_graveyard/`（非 git 仓库降级为 rename），并建议自动提交
- 还魂 = `git mv` 回库内任意位置
- 墓地内容的真删除永远是人工操作，任何实现不得提供自动清空

## 配置文件（.kb/config.json）

```jsonc
{
  "version": 1,                 // 协议版本
  "managed": ["**/*.md"],       // 受管理范围（glob）
  "exclude": ["_graveyard/**"],
  "captureDir": ".",
  "l0Cap": 100,
  "inboxDays": 30,
  "decayDays": 90,
  "citeDays": 180,
  "outputDirs": [],             // 创作目录：其中的引用是铁证级吸收信号
  "judgment": { "provider": "human", "triageModel": "…", "digestModel": "…" },
  "embedding": { /* 可选，见语义检索 */ }
}
```

完整字段语义见[配置参考](/reference/config)。

## 版本与演进承诺

- `version` 字段缺省视为 `1`
- **破坏性变更**（字段语义改变、信号效力改变、法医规则改变）必须升 `version`，并随版本发布迁移说明
- 新增可选字段、新增不续命的信号类型属于兼容变更，不升版本
