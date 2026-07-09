# Phase 7：本地产品完整体——monorepo + HTTP API + React 管理台

> 2026-07-09。决策已确认：① `kb ui` 本地 Web；② 全功能管理台；③ UI 浏览记 `kb_ui` 不续命；④ 生产产品定位 → React 栈 + monorepo（推翻上版"无框架"，理由见 docs/blueprint.md）。规格待确认后开发。
> 对应蓝图 Phase A。上版纯静态方案已废弃，本文件为权威版本。

## 背景

产品定位从"个人工具"升级为"可生产使用的产品"（蓝图见 `docs/blueprint.md`）。人的三个不可替代动作（过堂/分诊/消化）需要图形化判决台；同时 HTTP API 作为第二个正式产品面（未来 Obsidian 插件、云端共用），必须在这一期把包边界、API 形状、前端栈这三个"晚改天价"的决定做对。

第一性原理：UI 的本质是**法官的法庭 + 体检室**——文件永远是真相，UI 是派生视图 + 判决动作图形化。零 LLM/零依赖不变量只锁内核运行时，不约束构建期工具链；构建产物仍是静态文件随包分发，用户侧零额外安装。

## 目标

1. **monorepo 重构**：pnpm workspaces；现有代码拆入 `packages/core`（引擎+协议，含 judgment）、`packages/cli`、`packages/mcp`、`packages/server`（新）、`apps/web`（新）。发布物仍是单包 `kb-metabolism`（bin `kb`/`kbm` 不变），内部包 private、tsup 构建期打包，web 构建产物随包分发。
2. **@kb/server**：Hono + @hono/node-server，`/api/v1/*`，全部 endpoint zod 校验，schema 与响应类型 workspace 共享给前端。薄封装 core，不产生第二套业务逻辑。
3. **React 管理台**：React + TS + Vite + TanStack Query + Tailwind + shadcn/ui，七视图（总览/笔记/过堂/分诊/消化/信号/设置）。`kb ui [--port 7317] [--no-open]` 起服务并开浏览器。
4. **信号纪律**：UI 浏览/检索记 `{tool:"kb_ui"}`（法医只认 kb_read/kb_cite，天然不认）；过堂预览沿用 `notePreview` 不记任何信号。
5. **协议不破**：无删除按钮（唯一删除路径仍是勾名单→execute）；无正文编辑器；secrets 永不经过 API。
6. **测试与 CI 起步**：core 关键协议行为单测（法医规则/入口税/信号窗口）、server 契约测试（vitest）、三条判决工作流 E2E（Playwright）、GitHub Actions（typecheck+test+build）。

## 仓库布局（重构后）

```
packages/core     # src/core + src/judgment → 引擎与协议，零 LLM 不变量在此
packages/cli      # src/cli.ts + wizard + hooks；新增 ui 子命令；发布名 kb-metabolism
packages/mcp      # src/mcp/server.ts
packages/server   # 新：Hono API + zod schemas（schemas 目录同时被 web 类型引用）
apps/web          # 新：Vite React 管理台；build 产物拷入 cli 包 dist/web
```

- tsconfig project references；根 `pnpm dev` = server（tsx watch）+ vite dev（proxy /api）。
- 发布：cli 包 `files` 含打包后 dist + web 静态产物；npm publish 单包不变。

## 页面与行为

| 视图 | 内容 | 动作 |
|---|---|---|
| 总览 | doctor 全量指标（年龄分层、L0 余量、门流量、吸收率、语义层）+ 待办卡（未分诊/待过堂/消化候选/digest 超期） | 卡片跳转对应视图 |
| 笔记 | tab：全部/L0/L1/inbox/未分诊/墓地；列：标题、层、use_when、最后读取、最后被引、反链、年龄；混合检索 | 行点开详情侧栏：正文渲染 + frontmatter + 信号史（记 kb_ui） |
| 过堂 | 最新 kill-list 逐条卡片：预览 + 法医理由 | 处决/赦免逐条；完成 execute（二次确认，展示 git mv 结果） |
| 分诊 | 未分诊队列：预览 + 定层 + use_when | 入口税前后端双重强制：无 use_when 时 L0/L1 不可选 |
| 消化 | chew 候选（近 90 天读 ≥2 次的 L1）；工作台左源右合成 | 人写判断 + use_when → createL0（L0 满展示报错）；源自动标 kb_digested |
| 信号 | access.log.jsonl 倒序流水，按 tool/时间过滤 | 只读 |
| 设置 | config 表单（zod 白名单写回）；报告历史；墓地列表+恢复；重建索引；embedding 仅显示"key 已配置/未配置" | 恢复 = git mv 回 vault 根（v1 不追溯原路径） |

## API（/api/v1，全部包 core 现有函数）

```
GET  /overview            → runDoctor + getStats + digestReminder + 待办计数
GET  /notes?tier=&sort=   → notes + lastReadByPath/lastByTool(kb_cite) + 反链数
GET  /notes/detail?path=  → 正文+frontmatter+信号史（append kb_ui）
GET  /search?q=           → hybridSearch（append kb_ui 带 query）
GET  /signals?tool=&limit=→ readSignals 尾部
GET  /reports · /reports/detail?file=  → 列表/内容（kill-list 走 parsePending+notePreview）
POST /review/approve {file,lines[]} → approveLines
POST /review/execute {file}         → executeReport
POST /triage {decisions[]}          → 写 frontmatter（tier/use_when/triaged/expires），服务端强制入口税
GET  /chew/candidates → buildChewCandidates；POST /chew → createL0
POST /notes {title,content,useWhen,tier,force?} → similarNotes 查重（同 MCP 语义）→ addNote
GET  /config → 不含秘密；PUT /config → zod 白名单校验写回
POST /index → runIndex
GET  /graveyard → 列表；POST /graveyard/restore → git mv 回库
```

安全边界：只绑 `127.0.0.1`；path 参数 resolve 后必须在 vault 内且拒绝 `.kb/`（secrets）；写操作校验 Origin/Content-Type（防浏览器内恶意页面 CSRF 打本地端口）；better-sqlite3 每请求开关连接（沿用现有模式）。

## 实现细节备忘

- config.json 落 `"version": 1` 协议版本字段，loader 兼容缺省——为后续迁移机制留位（迁移器本身不在本期）。
- UI 文案抽 i18n 字典，v1 只出中文，键位留好 en。
- markdown 渲染用 react-markdown（web 侧依赖，不进 cli 运行时）。
- 端到端信号验证：E2E 断言"UI 浏览产生 kb_ui 且 coroner 结果不变"——信号纪律用测试锁死。

## 不做什么

- 不做笔记正文编辑器、写作功能（文件为真相，编辑归用户编辑器）
- 不做删除按钮（含墓地视图；真删归人手动）
- 不做远程访问/鉴权/多用户（localhost 单人；团队是蓝图 Phase C）
- 不做 Obsidian 插件、文档站、npx 引导（蓝图 Phase B，另立 spec）
- 不在 UI 里调 LLM（anthropic/agent provider 流程仍走 CLI）
- 不做协议迁移器（本期只埋版本字段）
- 不做遥测（Phase B 与文档站一起，需 opt-in 设计）
