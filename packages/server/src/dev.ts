import { findVaultRoot } from "@kb/core";
import { DEFAULT_PORT, startUi } from "./ui.js";

/** 开发入口：KB_VAULT 指定库（或从 cwd 向上找）；前端走 vite dev 的 /api 代理 */
const root = process.env.KB_VAULT ?? findVaultRoot(process.cwd());
if (!root) {
  console.error("找不到知识库：设 KB_VAULT=/path/to/vault 或在库内运行");
  process.exit(1);
}
const { url } = await startUi({ root, port: Number(process.env.KB_PORT) || DEFAULT_PORT });
console.log(`API dev server: ${url}/api/v1  (vault: ${root})`);
