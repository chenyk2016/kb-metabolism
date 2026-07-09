# 阶段 5 规格：hooks 自动注入（调研缺口 1）

> 2026-07-09 · 回应对文件型方案的最强公开批评："agent 有时不去搜"
> 原则：把"走门"从 agent 的选择变成管道的必然；hooks 是门的第二形态

## 机制

Claude Code hooks（settings.json）两个挂点：

| 事件 | 命令 | 注入什么 |
|---|---|---|
| UserPromptSubmit | `kb hook prompt --vault <dir>` | 与本条 prompt 相关的笔记摘要（top3）+ "全文用 kb_read" 指引 |
| SessionStart | `kb hook session --vault <dir>` | 库概况一行 + 消化提醒 + 最近走门读过的笔记（会话连续性） |

## 关键设计决策

1. **hook 检索只走字面三层**（毫秒级、零费用）——每条 prompt 都过 embedding 的延迟/费用不可接受；深检索 agent 自己会调门
2. **不够相关就沉默**：短 prompt（<4 字符）跳过；phrase 层命中才算强相关；ranked 兜底要求覆盖度 ≥0.35，否则零输出（exit 0 无 stdout = 不注入）
3. **注入记 `kb_inject` 信号、法医不认**：机器注入 ≠ 人在使用，不给续命；kb_read 仍是唯一强信号
4. **stdin 容错**：hook 收 JSON（prompt/cwd 等），解析失败即静默退出——hook 永不打断用户

## 安装

- `kb hook install [--user|--project] `：合并写入 settings.json（先备份 .bak，幂等——已有 kb 条目则替换）；命令用 node/cli.js/vault 三个绝对路径（避 volta 坑、避 cwd 不定）
- `kb hook show`：打印配置片段，供手动粘贴
- 卸载：`kb hook uninstall`

## 验收

1. 管道喂 hook JSON：相关 prompt 注入 top3 摘要；无关 prompt 零输出
2. session hook 输出概况+最近读取；空库/无信号时降级得体
3. install 幂等（跑两次只有一份配置），uninstall 干净
