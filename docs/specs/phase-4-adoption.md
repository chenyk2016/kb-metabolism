# 阶段 4 规格：采纳与信任优化（调研驱动）

> 2026-07-09 · 依据：ideas/kb-metabolism/02-demand.md 的六项第一性缺口分析，用户确认"开始"
> 本轮做高杠杆四项（缺口 2/5/3/6），init 向导与 hooks 注入留下一轮

## 1. 门上闹钟（缺口 2：系统不能靠自觉）

- 判定：`.kb/reports/` 中最新 `kill-list-*.md` 的日期距今 > 7 天，或库非空但从未消化
- 挂点：MCP `kb_search`/`kb_stats` 返回尾部 + CLI `kb stats`，一行提醒
- 无新状态、无新依赖——节律寄生在最高频接触点（门）上

## 2. `kb doctor`（缺口 3+6：冷启动 aha + 健康可见）

即时诊断，**不依赖访问日志**（新库第一分钟就有结论）：
- 数据：git 全仓一次 `log --name-only` 建"最后触碰"映射（fallback mtime）+ 反链 + tier + 信号（有则用）
- 输出：总量/未分诊率/孤儿率/L0 余量/门流量 + **年龄分层**（沉睡 >365d、衰退 >90d、活跃）+ 最老 5 条 + 一句诊断
- `kb init` 与 `kb digest` 自动附带；`kb doctor --save` 写入 `.kb/reports/health-YYYY-MM-DD.md`

## 3. `kb review`（缺口 5：法官弃庭）

- 交互式过堂最新（或指定）kill-list 的未勾选条目：逐条展示 路径/层级/理由/正文开头，`y`=处决 `n`=赦免 `q`=退出
- y 的行写回 `[x]`，结束后自动 `execute`；全程 fs 直读（判决不算使用信号）
- 复用 LineReader（管道可测）

## 不做（本轮）

- HTML 可视化报告（markdown+终端先行）
- init 交互向导、Obsidian 插件、hooks 注入（下一轮）

## 验收

1. 新空库 init 即见考古诊断；真实库 doctor 给出年龄分层与结论
2. 距上次消化 >7 天时，kb_stats/kb_search 尾部出现提醒行
3. review 管道输入 y/n 可完成勾选+执行全流程
