import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * E2E fixture：现做一个真实 vault（走已构建的 cli，不 mock）。
 * 在 playwright 的 webServer 命令链里、server 启动前执行；
 * 路径写入 e2e/.vault-path 供 server 与各测试读取。
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, "../../../packages/cli/dist/cli.js");

const fm = (data, body) =>
  `---\n${Object.entries(data)
    .map(([k, v]) => `${k}: "${v}"`)
    .join("\n")}\n---\n${body}\n`;

const root = fs.mkdtempSync(path.join(os.tmpdir(), "kb-e2e-"));
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

fs.writeFileSync(
  path.join(root, "hot-l1.md"),
  fm({ kb_tier: "L1", kb_use_when: "E2E 消化用" }, "# 高频资料\n\n被反复读取的内容。")
);
fs.writeFileSync(
  path.join(root, "expired.md"),
  fm({ kb_tier: "inbox", kb_expires: yesterday }, "# 过期残渣\n\n一次性内容。")
);
fs.writeFileSync(path.join(root, "fresh.md"), "# 未分诊笔记\n\n等待定层的内容。\n");

const cli = (args) =>
  execFileSync(process.execPath, [CLI, ...args, "--vault", root], { stdio: "pipe" });
cli(["init", "-y", "--git"]);
cli(["read", "hot-l1.md"]);
cli(["read", "hot-l1.md"]);
cli(["digest"]);

fs.writeFileSync(path.join(here, ".vault-path"), root);
console.log(`e2e vault ready: ${root}`);
