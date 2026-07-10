import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { promoteNote, runIndex } from "../src/index.js";
import { dateStr, fm, makeVault } from "./helpers.js";

const INBOX = fm({ kb_tier: "inbox", kb_expires: dateStr(10) }, "# 暂存\n\n等待自证价值。");

describe("晋升通道（promote）", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => cleanup?.());

  it("inbox → L1：落 use_when、清 kb_expires、刷新分诊日", async () => {
    const t = await makeVault({ "scrap.md": INBOX });
    cleanup = t.cleanup;
    const r = promoteNote(t.vault, "scrap.md", "L1", "下次选型时");
    expect(r).toMatchObject({ from: "inbox", tier: "L1" });
    const data = matter(fs.readFileSync(path.join(t.root, "scrap.md"), "utf8")).data;
    expect(data.kb_tier).toBe("L1");
    expect(data.kb_use_when).toBe("下次选型时");
    expect(data.kb_expires).toBeUndefined();
  });

  it("入口税：无 use_when → 拒绝", async () => {
    const t = await makeVault({ "scrap.md": INBOX });
    cleanup = t.cleanup;
    expect(() => promoteNote(t.vault, "scrap.md", "L1", "  ")).toThrow(/入口税/);
  });

  it("只升不降 + 同层拒绝", async () => {
    const t = await makeVault({
      "l1.md": fm({ kb_tier: "L1", kb_use_when: "测试" }, "# 资料"),
    });
    cleanup = t.cleanup;
    expect(() => promoteNote(t.vault, "l1.md", "L1", "还是测试")).toThrow(/已是 L1/);
  });

  it("升 L0 过容量检查", async () => {
    const t = await makeVault({ "scrap.md": INBOX });
    cleanup = t.cleanup;
    t.vault.config.l0Cap = 0;
    expect(() => promoteNote(t.vault, "scrap.md", "L0", "永远")).toThrow(/L0 已满/);
  });

  it("晋升后不再因 inbox 过期上榜", async () => {
    const t = await makeVault({
      "old.md": fm({ kb_tier: "inbox", kb_expires: dateStr(-1) }, "# 过期暂存"),
    });
    cleanup = t.cleanup;
    const { runCoroner } = await import("../src/index.js");
    expect(runCoroner(t.vault).candidates.map((c) => c.path)).toContain("old.md");
    promoteNote(t.vault, "old.md", "L1", "证明了价值");
    await runIndex(t.vault);
    expect(runCoroner(t.vault).candidates.map((c) => c.path)).not.toContain("old.md");
  });
});
