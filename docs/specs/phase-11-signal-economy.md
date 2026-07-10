# Phase 11：信号经济修复——让法医重新看得见

> 2026-07-10 对抗式审查产出。三个 P0：续命信号空转、年龄时钟被批量操作清零、反链=无条件永生。
> 不修 Fix 1-3，法医在未来 90 天要么沉默（全库年龄 0 天）要么疯狂（信号缺失整批提案）。

## 背景（审查实测）

1. **信号空转**：真实 vault 信号日志 21 条——kb_inject 19、kb_ui 2，**kb_read / kb_search / kb_cite 全部为 0**。hooks 注入摘要满足了信息需求但不续命，走门读取靠 agent 自觉但 agent 直读文件系统更便宜。设计自噬：便利层饿死了自己的信号经济。信息密度最高的笔记（摘要即答案）受害最深——永远不会被 kb_read，必死。
2. **年龄清零**：coroner 用 `git log -1 -- file` 取最后触碰。PARA 迁移 + kb_id 自愈写回让全库最后提交都是 2026-07-09/10 → 体检报告"286 条 100% 活跃、4 月笔记 0 天未动、代谢健康"——系统自产假阴性，法医盲 90 天。
3. **反链永生**：`backlinks === 0` 是上榜 AND 条件。孤儿率 49% → 51% 的库永久免疫；链接环（教程互链、MOC 索引）整簇担保；死笔记发出的链接与活笔记等权。

## 目标

### Fix 1：注入续命（与阈值修复绑定，缺一不可）

先把注入做准，再让注入算数——顺序不能反，否则灌水注入滥发免死金牌。

1. **hookSearch 阈值 idf 加权 + 标题命中**（`packages/core/src/search.ts`）：
   兜底层判据从 `rawCoverage ≥ 0.35` 改为双条件：**idf 加权覆盖度 ≥ 0.5** 且 **标题命中 ≥ 1 个单元**。
   实测教训：单靠 idf 不够——跨词边界的碎 bigram（"怎么|这么"拼出的"么这"，df=7）比实词 idf 还高，
   正文碰瓷照样过线；标题是主题声明，碎 bigram 在标题里碰不上。纪律仍是"宁沉默"。
2. **kb_inject 成为第三档存活证据**（`packages/core/src/coroner.ts` + `config.ts`）：
   - 新增 config `injectDays`（默认 30）；
   - coroner 增加 `injectAlive`：近 `injectDays` 内有 kb_inject 信号（按 kb_id 认领，复用 `lastByNoteId`）则不上榜；
   - 理由行补齐："最后注入已超 30 天 / 从未被注入"。
3. **信号金字塔口径更新**（protocol.md / README / docs）：
   被引用 180 天 > 被读取 90 天 > **被注入 30 天** > 检索命中/UI 浏览 0。

### Fix 2：年龄 = 内容变更时间（免疫 rename 与批量提交）

1. 把 `doctor.ts` 的 `lastCommitMap`（一次全仓 `git log`）抽成 core 公共函数（新文件 `packages/core/src/age.ts`，导出 `contentAgeMap(root, bulkThreshold)`），coroner 弃 per-file `git log -1` 改用它（顺带修性能：285 篇 × spawn git → 1 次）。
2. 全仓扫描命令：`git -c core.quotepath=false log -M --pretty=format:%cI --name-status`
   - `--name-status`（替代现在的 `--name-only --no-renames`）：状态码是区分"真编辑"与"挪位置"的关键——现状把 rename 拆成 A+D，重命名被当成触碰；
   - `-M` 显式开启 rename 检测，不依赖用户 git 配置；
   - `-c core.quotepath=false`：**修现存 bug ①**——中文文件名默认被 git 转义成带引号的八进制，与索引路径对不上；
   - `git rev-parse --show-prefix` 剥路径前缀：**修现存 bug ②**——vault 是仓库子目录时（实际部署：仓库根 `~/.openclaw/shared`，vault 在 `notes/content/`），git log 路径带前缀，同样全量 miss。两个 bug 叠加使 doctor 的年龄映射从上线起就静默失效（全部回退 mtime）；批量判定只数 vault 内文件，仓库其他目录的噪音不把小编辑衬成批量。
3. 解析：按日期行切提交块，**从新到老**单趟扫描，维护三张表：
   - `alias`（历史路径 → 当前路径）：遇 `R*` 行不算触碰但记别名链——跳过重命名后，更老提交里的旧路径靠 `resolve()` 沿链换算成当前路径认领，否则历史失联；
   - `lastChanged`（结果）：`M`/`A` 行且所在提交非批量（文件数 ≤ `bulkCommitThreshold`，config 默认 30）→ 首见即最新；
   - `firstSeen`（兜底）：任何非 D 行无条件覆盖，扫完 = 出生时间；触碰全被过滤的文件回退出生时间——批量导入的新笔记因此仍有正确年龄，批量过滤只保护"本来有老历史的文件"。
   - `D` 行跳过；merge 提交 git log 默认不列文件，天然不污染。
4. 取舍：改名 + 小改内容同提交（如 kb_id 迁移补发）按 `R92` 之类报出，仍视为 rename 跳过——这正是要过滤的噪音；大改到相似度 <50% 时 git 报 A+D，历史从该提交重新起算，与 git 自身行为一致。
5. 非 git 库 / 未跟踪文件回退 mtime（现状不变）。
6. doctor 年龄分层同规则复用——体检与法医口径必须一致。
7. 测试：临时 git 仓库 + `GIT_COMMITTER_DATE` 造确定性历史——老笔记经批量提交不刷新年龄；`git mv` 不刷新且历史跟到新路径；真编辑刷新；中文文件名路径能对上。

### Fix 3：反链从"豁免"降级为"活源担保"

1. 反链计数改为**只统计活源发出的链接**。源活着 = 满足其一：
   - 源自身有窗口内 read/cite/inject 信号；
   - 源内容年龄（Fix 2 口径）≤ `decayDays`（正在被编辑的 MOC 发出的链接有效）；
   - 链接 `from_output = 1`（创作目录引用是铁证，永远算活——不降级）。
2. **只算一层，不做不动点迭代**：死簇互链会同批上榜（这正是目的），被使用的 MOC 仍保护其子节点。
3. 理由行区分："0 活反链（另有 3 条链接来自死源）"——让法官看见"有人链过但链它的也死了"。

## 修改文件

- `packages/core/src/search.ts` — hookSearch idf 加权阈值
- `packages/core/src/coroner.ts` — injectAlive、活源反链、共享年龄映射
- `packages/core/src/age.ts`（新增）— `contentAgeMap`：全仓单趟扫描 + rename 别名链 + 批量过滤 + quotepath 修复
- `packages/core/src/doctor.ts` — 弃 `lastCommitMap`，改用 `contentAgeMap`
- `packages/core/src/config.ts`、`types.ts` — `injectDays`、`bulkCommitThreshold`
- `packages/core/test/coroner.test.ts` — 新增用例：注入续命、rename 免疫、批量提交免疫、死源反链不豁免、活 MOC 担保
- `docs/protocol.md`、`README.md`、`apps/docs/protocol/spec.md` — 信号金字塔与法医规则口径同步

## 验收

1. `pnpm typecheck && pnpm test` 全绿；
2. 在真实 vault 跑 `kb digest`：4 月笔记恢复真实年龄（不再 0 天）、体检不再报"100% 活跃"；
3. 构造用例：inbox 外笔记被 hook 注入过（30 天内）不上榜；仅被死笔记链接的笔记照常上榜。

## 不做什么

- **不 deny agent 直读 vault**——那是 Claude Code permissions 层的事，产品代码管不到；仅在 `apps/docs/guide/agents.md` 加一节配置建议（把"走门"从自觉变成管道的终极形态）。
- **不做 `kb promote`**（inbox 升级通道）——真实缺口但独立问题，另立 spec。
- **不动 kb_cite 荣誉制与 outputDirs 接线**——后者是用户配置动作（60-creative 加进 outputDirs），不是代码改动。
- **不迁移信号格式**——kb_inject 信号已带 id/path 字段，向后兼容，历史行按现有 path 兜底认领。
- **不做反链不动点/PageRank**——一层活源判定足够，复杂度不换收益。
