# CLI 命令

全局选项：`--vault <dir>` 指定库（默认从当前目录向上找 `.kb/`）。

## 日常

| 命令 | 职责 |
|---|---|
| `kb` | **现在该做什么**：状态感知的剧本引导（默认命令） |
| `kb search <词> [-n 8]` | 走门检索（记 `kb_search` 信号） |
| `kb read <路径>` | 输出笔记全文（记 `kb_read`——续命信号） |
| `kb add [标题] [-w 何时再用] [-t 层级] [-f 文件] [-d 子目录]` | 捕捉（入口税自动生效；支持 stdin 管道） |
| `kb ui [--port 7317] [--no-open]` | 管理台：判决台 + 体检室（只绑 127.0.0.1） |

## 每周节律

| 命令 | 职责 |
|---|---|
| `kb digest [--emit] [--no-llm]` | 重建索引 + 法医名单 + 消化名单 + 体检留档 |
| `kb review [报告]` | 交互式过堂（y=处决 n=赦免 **p=升级** q=退出），结束自动执行 |
| `kb promote <路径> -w <用途> [-t L1\|L0]` | 晋升：inbox/未分诊 → L1/L0，L1 → L0；只升不降，入口税照收，清 inbox 过期日 |
| `kb bench [--limit n] [--no-semantic] [-k n]` | 检索自体基准：入口税的 use_when 当查询（未来查询的预演），三策略对比出报告；直调纯函数，不走门不留信号 |
| `kb execute <报告>` | 掩埋名单中已勾选条目（git mv，可反悔） |
| `kb chew [--emit] [--limit n]` | 消化：把高频 L1 提炼成 L0（AI 拆解，人合成） |
| `kb chew --judgment <判断> --use-when <用途> --source <路径...>` | 非交互落 L0（agent 转录主人原话的唯一合法通道，含 L0 上限检查） |
| `kb triage [--emit] [--limit n] [-y]` | 给未分诊笔记定层（provider: human/anthropic/agent） |

`--emit`：不做判断，输出自包含提示词交给任意接入的 agent。

## 体检与维护

| 命令 | 职责 |
|---|---|
| `kb doctor [--save]` | 体检：年龄分层/孤儿率/吸收率/语义层（不依赖信号，新库即刻可用） |
| `kb stats` | 库健康度速览 |
| `kb index` | 重建派生索引（笔记/反链/FTS/增量向量），顺带给缺 `kb_id` 的笔记自愈补发身份 |
| `kb init [--managed <globs>] [--git] [-y]` | 任意目录变成知识库（默认交互四问） |
| `kb migrate --from <旧db>` | 从旧版 sqlite 导入访问日志 |
| `kb migrate-signals` | 给日志历史行补 `kb_id`（自动备份）——目录大整理前务必先跑一次 |

## 接入

| 命令 | 职责 |
|---|---|
| `kb serve` | 启动 MCP 检索门（stdio） |
| `kb hook install [--project]` / `uninstall` / `show` | Claude Code hooks 安装/卸载/打印配置 |
| `kb key set` / `kb key test` | embedding API key 管理（写 `.kb/secrets.json`，永不走 argv） |
