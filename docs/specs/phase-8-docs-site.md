# Phase 8：文档站——给陌生用户的说明书 + 协议规范的权威 URL

> 2026-07-09。已确认：VitePress、v1 纯中文（i18n 目录留位）。对应蓝图 Phase B 第一块。规格待确认后开发。

## 背景

npm publish 与 Obsidian 插件将带来第一批陌生用户，README 只服务"已到 repo 的开发者"。同时蓝图终态"协议 > 工具"要求协议规范有一个可被外部引用的权威 URL——埋在 README 里永远只是某工具的用法，独立成章才有规范地位。

## 目标

1. `apps/docs`（`@kb/docs`，private）：VitePress 站点，内容从 README/protocol.md/blueprint.md 拆页重组，不从零写。
2. **协议规范 v1 成为头等公民**：独立章节、带版本号、含 frontmatter 字段表 / 信号 JSONL schema / 法医规则 / 信号金字塔（免死窗口表）/ 兼容实现指南——写给"想做兼容工具的人"。
3. GitHub Pages 自动部署：push main 且 docs 相关路径变更时触发，URL `https://chenyk2016.github.io/kb-metabolism/`。
4. 内置本地搜索（VitePress local search，零外部服务）。

## 站点结构

```
首页            hero：一个会遗忘的知识库｜三卖点：文件为真相 / 可治理的遗忘 / 判决归人
指南 guide/
  为什么需要代谢    囤积腐烂问题 + 缺失的两个器官（消化/排泄）
  快速开始          install → init 四问 → 第一份体检报告
  日常使用          "几乎不用用"哲学 + kb 默认命令
  每周节律          digest → review 过堂 → chew 消化
  管理台            kb ui 七视图 + 三条纪律（kb_ui 不续命/无删除按钮/无编辑器）
  接入 agent        MCP 注册 + 门规 + hooks 第二形态
  语义检索          embedding 配置 + kb key + 降级承诺
  概念表            入口税/法医/信号/续命/过堂/墓地/消化/吸收——黑话词汇表
协议 protocol/
  规范 v1           分层模型、frontmatter 字段、access.log.jsonl 格式、
                    法医判定规则、信号金字塔、版本与演进承诺
  兼容实现指南       第三方工具如何读写同一套约定而不破坏代谢
参考 reference/
  CLI 命令          全命令表（从 README 扩写）
  配置              config.json 全字段 + secrets 分家说明
  HTTP API          /api/v1 端点表（从 @kb/server schemas 整理）
  MCP 工具          五工具 + 信号语义
蓝图              blueprint.md 的公开版（五层一内核 + 路线，不含内部闸门细节）
```

## 修改文件

- `apps/docs/`（新）：`.vitepress/config.ts`（nav/sidebar/base=/kb-metabolism//local search/i18n root=zh）+ 上述 md 页面
- `pnpm-workspace.yaml` 已覆盖 apps/*；根 package.json 加 `docs:dev` / `docs:build` 脚本
- `.github/workflows/docs.yml`（新）：paths 过滤 `apps/docs/**` + `docs/protocol.md`，build → actions/deploy-pages
- README 顶部加文档站链接徽章

## 实现细节

- base 路径 `/kb-metabolism/`（Pages 项目页），所有内链相对化
- 协议页标注 `协议版本：1`，与 config.json 的 `version` 字段对齐；演进承诺：破坏性变更必须升 version 并附迁移说明
- i18n 留位：内容放 locales root（中文），`en/` 目录结构预留不实现
- 部署需要一次手动开关：repo Settings → Pages → Source 选 "GitHub Actions"（写进 PR 描述提醒）

## 不做什么

- 英文版内容（结构留位，翻译另起）
- 博客/评论/analytics/自定义域名/多版本文档
- 不把 HTTP API 做成 OpenAPI 交互文档（v1 表格足够；等有第三方集成需求再说）
- 不改协议本身——文档站只是把已实现的协议写成规范
