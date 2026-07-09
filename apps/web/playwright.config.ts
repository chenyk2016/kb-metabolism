import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

/**
 * E2E 针对已构建产物：webServer 直接跑 `kb ui`（cli dist + web dist），跑之前必须 pnpm build。
 * 注意 playwright 先起 webServer 再跑 globalSetup，所以 vault 装配（e2e/prepare.mjs）
 * 挂在 webServer 命令链里、server 启动之前。
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, "../../packages/cli/dist/cli.js");
const vaultFile = path.join(here, "e2e", ".vault-path");

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  workers: 1, // 共享一个 vault，串行跑
  use: { baseURL: "http://127.0.0.1:7719" },
  webServer: {
    command: `sh -c 'node "${here}/e2e/prepare.mjs" && exec node "${cli}" ui --no-open --port 7719 --vault "$(cat "${vaultFile}")"'`,
    url: "http://127.0.0.1:7719/api/v1/overview",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
