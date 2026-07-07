# kb-metabolism 知识代谢系统

> 文件为唯一真相 + 一道带日志的检索门 + 定时作业 + 人当法官。
> 协议：[docs/protocol.md](docs/protocol.md) · 规格：[docs/specs/phase-0-1-2.md](docs/specs/phase-0-1-2.md)

管理范围（首期）：`~/.openclaw/shared/notes/content/00-my-inbox`

## 组件

| 命令 | 职责 |
|---|---|
| `npm run index` | 索引器：笔记+反链 → SQLite（access_log 永不清空） |
| `npm run server` | kb-MCP 检索门（stdio）：kb_search / kb_read / kb_stats，自动记访问日志 |
| `npm run coroner` | 法医：零信号判定 → `reports/kill-list-*.md` |
| `npm run execute -- <report>` | 执行勾选的处决（git mv 到 `_graveyard/`）并重建索引 |
| `npm run smoke` | MCP 端到端冒烟测试 |

## MCP 注册（已完成，user 级）

```bash
claude mcp add --scope user kb -- node ~/.openclaw/shared/projects/kb-metabolism/dist/server.js
```

## 两个作业 Skill（已装到 ~/.openclaw/shared/skills/）

- `/kb-triage` — 分诊：给未分诊笔记定层写 frontmatter
- `/kb-weekly-digest` — 每周消化：法医名单 + 合并/升级提案 → 人勾选审批

## 每周 cron（默认关闭，涉及模型调用成本，需手动启用）

```bash
# 方式一：crontab（每周一 09:30）
30 9 * * 1 cd ~/.openclaw/shared/projects/kb-metabolism && npm run index --silent && npm run coroner --silent && claude -p "执行 kb-weekly-digest 技能流程" --permission-mode acceptEdits

# 方式二：OpenClaw cron，见 openclaw-config
```

## 信号从今天开始积累

衰减判定依赖检索门的访问日志，日志从检索门上线之日（2026-07-07）起算。
前 90 天法医主要依据 git 修改时间 + 反链 + inbox 过期。**查知识请一律走 kb_search/kb_read，别绕过门。**

## 修改代码后

```bash
npm run build && npm run smoke
```
