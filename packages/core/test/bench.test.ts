import { describe, expect, it, afterEach } from "vitest";
import { buildBenchCases, openDb, runBench, searchNotes } from "../src/index.js";
import { fm, makeVault } from "./helpers.js";

describe("检索基准（bench）", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => cleanup?.());

  it("use_when/标题成用例；同查询串合并成簇；短查询剔除", async () => {
    const t = await makeVault({
      "a.md": fm({ kb_tier: "L1", kb_use_when: "下次选全文检索引擎时" }, "# SQLite 中文检索\n\ntrigram。"),
      "b.md": fm({ kb_tier: "L1", kb_use_when: "下次选全文检索引擎时" }, "# FTS5 对比\n\n方案。"),
      "c.md": fm({ kb_tier: "L1", kb_use_when: "短" }, "# 埋点\n\ndig 上报。"),
    });
    cleanup = t.cleanup;
    const db = openDb(t.root);
    const cases = buildBenchCases(db);
    db.close();
    const uw = cases.filter((c) => c.kind === "use_when");
    expect(uw).toHaveLength(1); // 同 use_when 合并；"短" 因长度被剔
    expect(uw[0].expect.sort()).toEqual(["a.md", "b.md"]);
    expect(cases.filter((c) => c.kind === "title").map((c) => c.query)).toContain("SQLite 中文检索");
  });

  it("两字查询进不了 trigram FTS，由 LIKE 层接住（已知失败模式回归）", async () => {
    const t = await makeVault({
      "dig.md": fm({ kb_tier: "L1", kb_use_when: "接埋点时" }, "# 埋点接入\n\nModule_Click 上报规范。"),
    });
    cleanup = t.cleanup;
    const db = openDb(t.root);
    const hits = searchNotes(db, "埋点", 8);
    db.close();
    expect(hits.map((h) => h.path)).toContain("dig.md");
  });

  it("无 embedding 时优雅降级纯 literal，指标可算，不写信号", async () => {
    const t = await makeVault({
      "a.md": fm({ kb_tier: "L1", kb_use_when: "下次选全文检索引擎时" }, "# SQLite 中文检索\n\n引擎选型：trigram 全文检索。"),
    });
    cleanup = t.cleanup;
    const r = await runBench(t.vault, {});
    expect(r.semanticSkipped).toBe("未配置 embedding");
    expect(r.stats.use_when.literal!.cases).toBe(1);
    expect(r.stats.use_when.literal!.hits).toBe(1); // use_when 与正文共享"检索/引擎"词
    expect(r.stats.title.literal!.recall).toBe(1);
    const fs = await import("node:fs");
    const path = await import("node:path");
    expect(fs.existsSync(path.join(t.root, ".kb", "access.log.jsonl"))).toBe(false); // 评测零信号
    expect(fs.existsSync(r.report)).toBe(true);
  });
});
