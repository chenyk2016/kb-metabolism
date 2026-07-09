# Phase 9：笔记身份机制（kb_id）

> 状态：待确认 | 日期：2026-07-09
> 动机：目录规范化（PARA 化）将把"移动笔记"从一次性事件变成日常动词，而当前续命信号按路径记账——移动即信号清零，代谢系统会把"被人整理"误判为"死亡"。

## 背景：现状盘点（2026-07-09 读码结论）

| 数据 | 键 | 可再生性 | 移动后果 |
|---|---|---|---|
| `kb.db` notes/fts | path 主键 | ✅ 派生（index 全量重建） | 无损，自动重建 |
| `kb.db` links 反链 | basename 解析 | ✅ 派生 | **天然抗移动**（改名才断） |
| `kb.db` embeddings | path + hash | ✅ 派生但重算花钱 | 白白重算 API 向量 |
| `access.log.jsonl` | **path** | ❌ 唯一不可再生物 | **信号永久孤儿** |
| coroner 的 `lastTouched` | git log by path | — | 移动=touch，反而刷新（可接受：整理即使用） |

结论：问题收敛在一处——**信号日志的身份键**。附带优化一处——embeddings 换键避免移动重算。

## 目标

1. 笔记获得与路径无关的稳定身份 `kb_id`（frontmatter，与 `kb_tier` 同一设计语言）
2. 移动/重命名笔记后，续命信号（read/cite/inject）、免死窗口、向量缓存全部无损
3. 人可以在 Obsidian 里直接拖拽，无需任何 kb 命令——下次 `kb index` 自愈
4. 保持系统核心不变量：**sqlite 永远可删可重建；access.log 是唯一圣物**

## 设计决策

- **ID 格式**：`crypto.randomBytes(6).toString("base64url")`（8 字符，无语义——时间戳类 ID 会诱导人从 ID 读含义）
- **分配点**（三处，同一 `ensureId` 工具函数）：
  1. `capture.addNote`：出生即有
  2. `runIndex`：自愈式补发——扫描时发现 managed 笔记缺 `kb_id` 就写回 frontmatter（升级后首次 index 自动完成全库 361+ 篇补发；`IndexResult` 新增 `idsAssigned` 计数）。frontmatter 重写用 gray-matter，与 `applyDecision` 现有先例一致
  3. `triage.applyDecision`：分诊时兜底补发
- **日志格式**：新信号行同时写 `id` 和 `path`（path 保留给人 debug 读日志用）；`kb_search` 只记 query，不变
- **聚合逻辑**：`signals.ts` 聚合改以 id 为键；无 id 的历史行通过"当前 db 的 path→id 映射"兜底解析（未迁移日志在笔记移动前仍有效）
- **日志迁移**：新命令 `kb migrate-signals`——先跑 index（保证 id 齐全），再重写日志给可解析的历史行补 `id` 字段，原文件备份为 `access.log.jsonl.bak-<date>`。这是对"append-only 圣物"的唯一一次外科手术，必须在目录大迁移**之前**执行
- **embeddings 换键**：主键 path → id（hash 仍做新鲜度判断）。纯移动 = id 不变 + hash 不变 = 零重算

## 修改文件

| 文件 | 改动 |
|---|---|
| `packages/core/src/identity.ts`（新） | `ensureId(file)` / `newId()` / 从 frontmatter 读 id |
| `packages/core/src/indexer.ts` | 扫描时补发 id；notes 表写入 id 列 |
| `packages/core/src/db.ts` | notes 加 `id TEXT UNIQUE`；embeddings 主键换 id |
| `packages/core/src/signals.ts` | `appendSignal` 带 id；聚合函数以 id 为键 + path 兜底 |
| `packages/core/src/capture.ts` | 出生分配 kb_id |
| `packages/core/src/frontmatter.ts` | applyDecision 兜底补发 |
| `packages/core/src/coroner.ts` | 信号查找从 `n.path` 改 `n.id` |
| `packages/core/src/embedding.ts` | 同步逻辑按 id 查缓存 |
| stats/review/chew/doctor 中信号消费处 | 同 coroner |
| `packages/mcp/src/server.ts`、`packages/server/src/app.ts`、`packages/cli/src/hooks.ts`、`packages/cli/src/cli.ts` | 记信号时从目标文件 frontmatter 取 id 一并写入 |
| `packages/cli/src/cli.ts` | 新增 `kb migrate-signals` 子命令 |
| 测试 | 新增 `identity.test.ts`（移动保信号、出生带 id、日志迁移、db 重建）；现有测试跟随调整 |

## 不做什么

- 不做目录迁移本身（vault 侧独立任务，且必须排在本 phase 之后）
- 不加"目录权重/区位感知"——kb 只读元数据，不懂目录语义
- 不做 `kb mv` 命令——index 自愈已覆盖，多一个命令多一条人必须记住的规则
- 不动 links 的 basename 解析机制（同名冲突问题留给未来，不在本期）
- 不给非 managed 笔记发 id

## 验收标准

1. 升级后首次 `kb index`：全部 managed 笔记 frontmatter 获得 `kb_id`，输出补发计数；再次 index 补发数为 0（幂等）
2. `kb migrate-signals`：历史日志行获得 id，备份文件存在，行数不变
3. **移动保信号测试（核心）**：kb_read 某笔记产生信号 → `git mv` 改路径改目录 → `kb index` → 该笔记不出现在 coroner 处决名单（信号仍被认领），embeddings 无重算
4. 新 kb_add 的笔记出生自带 kb_id
5. 删除 kb.db → `kb index` → 检索/反链/信号认领全部恢复（派生性不变量保持）
6. 全部现有测试通过

## 实施顺序（本 phase 内）

identity.ts → db/indexer（含补发）→ signals/日志写入 → 各消费方 → migrate-signals 命令 → 测试 → 在真实 vault 上执行补发与日志迁移并验证
