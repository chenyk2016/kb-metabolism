import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { appendSignal, runCoroner, runIndex } from "../src/index.js";
import { daysAgoIso, dateStr, fm, makeVault } from "./helpers.js";

/** 把文件 mtime 拨到 N 天前（无 git 的 vault 里法医以 mtime 为准） */
function ageFile(root: string, rel: string, days: number): void {
  const t = new Date(Date.now() - days * 86400000);
  fs.utimesSync(path.join(root, rel), t, t);
}

const OLD_L1 = fm({ kb_tier: "L1", kb_use_when: "测试" }, "# 老资料\n\n很久没人碰的内容。");

describe("法医规则（coroner）", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => cleanup?.());

  it("过期 inbox → 上榜", async () => {
    const t = await makeVault({
      "scrap.md": fm({ kb_tier: "inbox", kb_expires: dateStr(-1) }, "# 残渣"),
    });
    cleanup = t.cleanup;
    const { candidates } = runCoroner(t.vault);
    expect(candidates.map((c) => c.path)).toContain("scrap.md");
  });

  it("零信号 + 零反链 + 超衰减窗口 → 上榜", async () => {
    const t = await makeVault({ "old.md": OLD_L1 });
    cleanup = t.cleanup;
    ageFile(t.root, "old.md", 120);
    await runIndex(t.vault);
    const { candidates } = runCoroner(t.vault);
    expect(candidates.map((c) => c.path)).toContain("old.md");
  });

  it("近期 kb_read → 赦免（读取续命）", async () => {
    const t = await makeVault({ "old.md": OLD_L1 });
    cleanup = t.cleanup;
    ageFile(t.root, "old.md", 120);
    await runIndex(t.vault);
    appendSignal(t.root, { tool: "kb_read", path: "old.md" });
    const { candidates } = runCoroner(t.vault);
    expect(candidates.map((c) => c.path)).not.toContain("old.md");
  });

  it("kb_ui 观察信号不续命——管理界面翻一遍 ≠ 使用", async () => {
    const t = await makeVault({ "old.md": OLD_L1 });
    cleanup = t.cleanup;
    ageFile(t.root, "old.md", 120);
    await runIndex(t.vault);
    appendSignal(t.root, { tool: "kb_ui", path: "old.md" });
    appendSignal(t.root, { tool: "kb_inject", path: "old.md" });
    const { candidates } = runCoroner(t.vault);
    expect(candidates.map((c) => c.path)).toContain("old.md");
  });

  it("被引用免死窗口比读取长一倍（120 天前的 cite 仍有效）", async () => {
    const t = await makeVault({ "old.md": OLD_L1 });
    cleanup = t.cleanup;
    ageFile(t.root, "old.md", 150);
    await runIndex(t.vault);
    // 手写一条 120 天前的 kb_cite：过了 90 天读取窗口，但在 180 天引用窗口内
    fs.appendFileSync(
      path.join(t.root, ".kb", "access.log.jsonl"),
      JSON.stringify({ ts: daysAgoIso(120), tool: "kb_cite", path: "old.md" }) + "\n"
    );
    const { candidates } = runCoroner(t.vault);
    expect(candidates.map((c) => c.path)).not.toContain("old.md");
  });

  it("有反链 → 赦免", async () => {
    const t = await makeVault({
      "old.md": OLD_L1,
      "daily.md": "# 日记\n\n参考了 [[old]] 的结论。",
    });
    cleanup = t.cleanup;
    ageFile(t.root, "old.md", 120);
    await runIndex(t.vault);
    const { candidates } = runCoroner(t.vault);
    expect(candidates.map((c) => c.path)).not.toContain("old.md");
  });

  it("L0 永不上榜", async () => {
    const t = await makeVault({
      "core.md": fm({ kb_tier: "L0", kb_use_when: "永远" }, "# 核心判断"),
    });
    cleanup = t.cleanup;
    ageFile(t.root, "core.md", 400);
    await runIndex(t.vault);
    const { candidates } = runCoroner(t.vault);
    expect(candidates.map((c) => c.path)).not.toContain("core.md");
  });
});
