# 知识代谢系统 阶段 0+1+2 规格

> 2026-07-07 · 方向已在对话中确认：三层结构 + 代谢机制，首期只管 `00-my-inbox`

## 背景

notes 库（`~/.openclaw/shared/notes/content`）全库 2537 个 md，其中 `00-my-inbox` 39 个。
病根：系统只有"进"，没有"消化"和"淘汰"（见 2026-07-07 效率诊断笔记）。
本系统不是第 13 个工具，而是"文件为真相 + 一道带日志的检索门 + 定时作业 + 人当法官"的代谢机制。

## 架构不变量（第一性原理推导，不可违反）

1. **真相层是纯 Markdown + frontmatter + git**，任何数据库只是派生物
2. **索引可随时删库重建**；唯一例外是访问日志表——它是不可再生的代谢信号，重建索引时必须保留
3. **所有检索走同一道门（kb-MCP）并记日志**——衰减判定的数据来源
4. 判断力按价值密度分配：分诊用便宜模型，消化/挤位用顶级模型
5. Agent 无状态，被 cron/命令唤醒，读文件→干活→写文件→退出

## 管理范围

- 首期只管 `~/.openclaw/shared/notes/content/00-my-inbox`（含子目录）
- 反向链接信号扫描全 vault（daily 笔记引用 inbox 笔记也算使用信号）
- 人格知识库、其他目录不动

## 三层结构

| 层 | 位置 | 规则 |
|---|---|---|
| L0 核心 | frontmatter `kb_tier: L0` | 硬上限 100 条；每条必须有一句可复述判断 + `kb_use_when` |
| L1 资料 | `kb_tier: L1` | 可检索即可；90 天零信号进处决名单 |
| inbox | `kb_tier: inbox` | 30 天到期（`kb_expires`），到期未升级即候选 |
| L2 墓地 | 物理移入 `00-my-inbox/_graveyard/` | 随时可删；git 保证可反悔 |

## frontmatter 规范（命名空间 kb_ 防冲突）

```yaml
kb_tier: L0 | L1 | inbox
kb_use_when: "一句话：什么时候会再用到"   # L0/L1 必填，写不出就只能进 inbox
kb_triaged: 2026-07-07
kb_expires: 2026-08-06                    # 仅 inbox 层
```

## 修改/新增文件

### 新项目 `projects/kb-metabolism/`（Node 22 + TS，独立 git 仓库）

| 文件 | 职责 |
|---|---|
| `src/config.ts` | VAULT_ROOT、MANAGED_DIR、DB_PATH，支持环境变量覆盖 |
| `src/db.ts` | SQLite schema + 迁移；重建时保留 access_log |
| `src/indexer.ts` | 扫描 managed 笔记 → notes/links/FTS；全 vault 扫反链 |
| `src/server.ts` | kb-MCP（stdio）：kb_search / kb_read / kb_stats，前两者写访问日志 |
| `src/coroner.ts` | 法医：零信号判定 → `reports/kill-list-YYYY-MM-DD.md`（含勾选框） |
| `src/execute.ts` | 读勾选后的 kill-list → git mv 到 `_graveyard/` → 重建索引 |
| `docs/protocol.md` | 知识代谢协议（权威版） |

### SQLite schema（`data/kb.db`，gitignore）

- `notes(path PK, title, tier, use_when, triaged, expires, created, modified, hash)`
- `links(src, dst)` — 全 vault 指向 managed 笔记的链接
- `notes_fts` — FTS5 trigram（中文按字符三元组），存 path/title/body
- `access_log(id, ts, tool, query, path)` — **重建索引永不清空**
- 检索：query ≥3 字符走 MATCH，否则 LIKE 兜底（39 条量级全扫无压力）

### MCP 注册

`claude mcp add --scope user kb -- node <project>/dist/server.js`

### 两个作业 skill（`~/.openclaw/shared/skills/`）

- `kb-triage`：扫 00-my-inbox 无 kb_tier 的文件 → 读内容 → 定层写 frontmatter；写不出 use_when 的进 inbox + 30 天过期
- `kb-weekly-digest`：跑 indexer → 跑 coroner → LLM 审名单+找重复+L0 挤位提案 → 产出周报 → 等人勾选后跑 execute

### vault 侧修改（最小改动）

- `笔记记录规则.md`：「不擅自删除笔记」改为「删除走处决名单审批，git 兜底」
- `01-知识管理/` 放协议指针，指向 kb-metabolism/docs/protocol.md

## 法医判定规则

进入处决名单需同时满足（首期数据不足时以 git/反链为准）：
- 访问日志 90 天零读取（日志从检索门上线日开始积累）
- 反向链接数 = 0
- git 最后修改 > 90 天（vault 仓库 `git log`，fallback 文件 mtime）
- inbox 层额外规则：`kb_expires` 已过即候选，不用等 90 天

## 不做什么

- 不做向量检索/embedding（FTS5 + LIKE 对 39 条足够，索引层可重建，后续无痛加装）
- 不做文件 watcher 常驻进程（分诊按需/每周批量跑）
- 不自动安装 cron（涉及模型调用成本，提供一键启用命令，由用户决定开启）
- 不动 00-my-inbox 以外的目录，不碰人格知识库
- 不做 Web UI（Obsidian 就是 L0 的阅读器）

## 验收

1. indexer 跑完，`kb_stats` 报出 39 条笔记的层级分布
2. `kb_search("browser-use")` 能命中博客目录下的笔记，且 access_log 有记录
3. coroner 产出格式正确的 kill-list（含判定理由）
4. execute 对勾选项完成 git mv 且索引同步
