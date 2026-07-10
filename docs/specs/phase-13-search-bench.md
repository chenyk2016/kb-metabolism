# Phase 13：kb bench——检索质量的自体基准

> 2026-07-10。phase-11 后检索排序就是生死判官（hook 注入发 30 天免死金牌、chew 候选依赖读取、
> 读取依赖排序），但检索质量从未被测量：语义层值不值那份 API 钱、调参会不会悄悄退步，全靠感觉。

## 第一性原理

1. **真值免费**：入口税收上来的 `kb_use_when` 就是"未来查询的预演"——每条 L0/L1 天然自带测试用例
   （用 use_when 当查询，该笔记必须能被找回）。标题是第二组近似真值。零标注、零 LLM、随库自动更新。
2. **评测永不留信号**：跑一遍基准 = 给全库发免死金牌，是这个系统独有的污染灾难。
   bench 直调 core 搜索函数（本来就不写信号），永不走门。
3. **回答具体决策**：同一套用例跑 literal / semantic / hybrid(RRF) 三策略，
   胜负手清单直接回答"embedding 值不值、RRF 有没有帮倒忙"。

## 实现

### core：`packages/core/src/bench.ts`

- `buildBenchCases(db)`：从索引出两组用例，按查询串合并（同 use_when/同标题的多篇 = 一组，命中任一算中）：
  - `use_when` 组：查询 = kb_use_when，期望 = 共享该 use_when 的路径集合；长度 <4 字或与标题相同的跳过
  - `title` 组：查询 = 标题，期望 = 同标题路径集合；长度 <4 字跳过
- `runBench(vault, {k=8, limit?, semantic=true})`：
  - literal：`searchNotes(db, q, 20)`
  - semantic：批量 `embedTexts`（16/批）+ `semanticSearch(db, qv, 20)`；无 key/未配置 → 自动跳过
  - hybrid：对上面两个 top-20 做 RRF（K=60，与 hybridSearch 同规），不重复调 API
  - 指标（每用例组 × 每策略）：Recall@k（期望集任一进 top-k）、MRR（首个期望的倒数排名）
  - 胜负手：hybrid 救回（literal 漏 hybrid 中）、fusion 帮倒忙（literal 中 hybrid 漏）、全军覆没清单
- 报告：`.kb/reports/search-bench-YYYY-MM-DD.md` + 终端摘要；报绝对数不只报百分比

### CLI：`kb bench [--limit n] [--no-semantic] [-k n]`

### 回归集（repo CI，`packages/core/test/bench.test.ts`）

固化已知失败模式：两字查询（进不了 trigram FTS，须由 LIKE 层接住）、use_when 用例构建正确性、
无 embedding 时优雅降级；hook 碰瓷沉默已在 search.test.ts。

## 不做什么

- 不做日志重放（L2）与 LLM 生成查询集（L3）——等信号积累，另立 spec
- 不做 nDCG/分级标注——300 条规模二值 + MRR 足够
- 不做评测平台/dashboard——报告是 markdown，读者是人
