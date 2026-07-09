import { defineConfig } from "tsup";

/**
 * 发布物是单包：@kb/*（workspace 私有包）全部打进 bundle，
 * 真实 npm 依赖保持 external（better-sqlite3 是原生模块，必须 external）。
 * splitting 让 @kb/core/judgment/anthropic 的动态 import 保持懒加载——
 * 不用 LLM 的用户永远不加载 @anthropic-ai/sdk。
 */
export default defineConfig({
  entry: { cli: "src/cli.ts", smoke: "src/smoke.ts" },
  format: "esm",
  platform: "node",
  target: "node20",
  splitting: true,
  clean: true,
  noExternal: [/^@kb\//],
});
