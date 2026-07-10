# HTTP API（/api/v1）

`kb ui` 在 `127.0.0.1:7317` 起的本机 API——管理台与本机集成的正式契约（zod schema 定义于 `@kb/server`）。**只服务 localhost**，远程访问不在 v1 范围。

## 信号语义

界面类访问一律记 `kb_ui` 观察信号（法医不认，不续命）：`GET /notes/detail` 记带 `path` 的 `kb_ui`，`GET /search` 记带 `query` 的 `kb_ui`。其余端点不产生信号。

## 端点

| 方法 路径 | 职责 |
|---|---|
| `GET /overview` | 体检 + 统计 + 消化提醒 + 待办计数 |
| `GET /notes?tier=all\|L0\|L1\|inbox\|untriaged` | 笔记列表（含反链数、最后读取/被引时间） |
| `GET /notes/detail?path=` | 笔记详情（正文/frontmatter/反链/信号史）；记 `kb_ui` |
| `POST /notes` | 捕捉：`{title, content?, tier?, useWhen?, force?}`——先过查重税，命中返回 `{similar}` 不写入 |
| `GET /search?q=&limit=` | 混合检索；记 `kb_ui` |
| `GET /signals?tool=&path=&limit=` | 信号流水（倒序）；行内可含 `id`（笔记稳定身份 kb_id，认领以它为准） |
| `GET /reports` / `GET /reports/detail?file=` | 报告列表/内容（kill-list 附逐条解析与预览） |
| `POST /review/approve` | `{file, lines[]}` 勾选名单行 |
| `POST /review/execute` | `{file}` 执行掩埋（git mv，可反悔） |
| `POST /triage` | `{decisions:[{path,tier,useWhen?}]}`；**入口税服务端强制**（L0/L1 缺 useWhen → 400） |
| `POST /promote` | `{path, tier?, useWhen}` 晋升（默认 L1）；只升不降、入口税强制、清 inbox 过期日 |
| `GET /chew/candidates` | 消化候选（近 90 天读 ≥2 次的 L1） |
| `POST /chew` | `{judgment, useWhen, evidencePaths[]}` 落 L0；L0 满 → 409 |
| `POST /digest` | 法医 + 体检留档 + 消化名单（无 LLM） |
| `GET /config` / `PUT /config` | 配置读写（**白名单校验**，未知字段 → 400；秘密永不出现在任何响应） |
| `POST /index` | 重建派生索引 |
| `GET /graveyard` / `POST /graveyard/restore` | 墓地列表 / 还魂（`{file}`） |

## 安全边界

- 全部请求校验 `Host` 必须是本机（DNS rebinding 防线）；非 GET 校验 `Origin`（防浏览器内跨站打本地端口）
- 所有 path 参数 resolve 后必须落在 vault 内，且永远拒绝 `.kb/`（secrets 所在地）
- **没有删除端点**——删除唯一路径是 approve → execute（git mv 可反悔）

错误响应统一 `{"error": "人话描述"}`，状态码 400/403/404/409/500。
