import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { appendSignal, buildChewCandidates, createL0, runIndex } from "../src/index.js";
import { fm, makeVault } from "./helpers.js";

describe("消化（chew）", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => cleanup?.());

  it("近 90 天读 ≥2 次的 L1 上桌；读 1 次的不上", async () => {
    const t = await makeVault({
      "hot.md": fm({ kb_tier: "L1", kb_use_when: "常用" }, "# 热资料"),
      "cold.md": fm({ kb_tier: "L1", kb_use_when: "少用" }, "# 冷资料"),
    });
    cleanup = t.cleanup;
    appendSignal(t.root, { tool: "kb_read", path: "hot.md" });
    appendSignal(t.root, { tool: "kb_read", path: "hot.md" });
    appendSignal(t.root, { tool: "kb_read", path: "cold.md" });
    const candidates = buildChewCandidates(t.vault);
    expect(candidates.map((c) => c.path)).toEqual(["hot.md"]);
  });

  it("createL0 落盘判断 + 源标 kb_digested；已消化的不再上桌", async () => {
    const t = await makeVault({
      "hot.md": fm({ kb_tier: "L1", kb_use_when: "常用" }, "# 热资料"),
    });
    cleanup = t.cleanup;
    appendSignal(t.root, { tool: "kb_read", path: "hot.md" });
    appendSignal(t.root, { tool: "kb_read", path: "hot.md" });

    const rel = createL0(t.vault, "热资料的核心是 X", "下次做 X 时", ["hot.md"]);
    const l0 = matter(fs.readFileSync(path.join(t.root, rel), "utf8"));
    expect(l0.data.kb_tier).toBe("L0");
    expect(l0.content).toContain("hot.md");

    const src = matter(fs.readFileSync(path.join(t.root, "hot.md"), "utf8"));
    expect(src.data.kb_digested).toBe(true);

    await runIndex(t.vault);
    expect(buildChewCandidates(t.vault).map((c) => c.path)).not.toContain("hot.md");
  });

  it("L0 满员 → 拒绝新判断（硬上限）", async () => {
    const t = await makeVault({
      "only.md": fm({ kb_tier: "L0", kb_use_when: "唯一" }, "# 占位判断"),
    });
    cleanup = t.cleanup;
    t.vault.config.l0Cap = 1;
    expect(() => createL0(t.vault, "挤不进来的判断", "无", ["only.md"])).toThrow(/已满/);
  });
});
