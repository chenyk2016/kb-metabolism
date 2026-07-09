import { defineConfig } from "vitepress";

// i18n 留位：当前全部内容即 root locale（中文）；英文版落 en/ 目录后在 locales 里注册
export default defineConfig({
  lang: "zh-CN",
  title: "kb-metabolism",
  description: "一个会遗忘的知识库——文件为真相、可治理的遗忘、判决归人",
  base: "/kb-metabolism/",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: "指南", link: "/guide/getting-started", activeMatch: "/guide/" },
      { text: "协议", link: "/protocol/spec", activeMatch: "/protocol/" },
      { text: "参考", link: "/reference/cli", activeMatch: "/reference/" },
      { text: "蓝图", link: "/roadmap" },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "指南",
          items: [
            { text: "为什么需要代谢", link: "/guide/why" },
            { text: "快速开始", link: "/guide/getting-started" },
            { text: "日常使用", link: "/guide/daily" },
            { text: "每周节律", link: "/guide/weekly" },
            { text: "管理台（kb ui）", link: "/guide/console" },
            { text: "接入 agent", link: "/guide/agents" },
            { text: "语义检索", link: "/guide/semantic-search" },
            { text: "概念表", link: "/guide/glossary" },
          ],
        },
      ],
      "/protocol/": [
        {
          text: "协议",
          items: [
            { text: "代谢协议规范 v1", link: "/protocol/spec" },
            { text: "兼容实现指南", link: "/protocol/compat" },
          ],
        },
      ],
      "/reference/": [
        {
          text: "参考",
          items: [
            { text: "CLI 命令", link: "/reference/cli" },
            { text: "配置（config.json）", link: "/reference/config" },
            { text: "HTTP API（/api/v1）", link: "/reference/http-api" },
            { text: "MCP 工具", link: "/reference/mcp" },
          ],
        },
      ],
    },
    socialLinks: [{ icon: "github", link: "https://github.com/chenyk2016/kb-metabolism" }],
    search: { provider: "local" },
    outline: { label: "本页目录", level: [2, 3] },
    lastUpdatedText: "最后更新",
    docFooter: { prev: "上一页", next: "下一页" },
    footer: {
      message: "MIT License",
      copyright: "© 柒崽",
    },
  },
});
