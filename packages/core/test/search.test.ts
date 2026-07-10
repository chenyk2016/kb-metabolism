import { describe, expect, it, afterEach } from "vitest";
import { hookSearch, openDb } from "../src/index.js";
import { fm, makeVault } from "./helpers.js";

describe("hook 注入判准（hookSearch）", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => cleanup?.());

  it("标题相关 → 注入；标题无关、正文只碰瓷功能词 → 沉默", async () => {
    const t = await makeVault({
      "kafka.md": fm(
        { kb_tier: "L1", kb_use_when: "测试" },
        "# kafka 重试参数\n\nretries 建议大于 0，参数配置见正文。"
      ),
      "misc.md": fm(
        { kb_tier: "L1", kb_use_when: "测试" },
        "# 随手记\n\n怎么说呢，这么做也行，在做别的事情。"
      ),
    });
    cleanup = t.cleanup;
    const db = openDb(t.root);
    const hit = hookSearch(db, "kafka 重试参数怎么配置");
    const silent = hookSearch(db, "怎么这么慢，在做吗");
    db.close();
    expect(hit.map((h) => h.path)).toContain("kafka.md");
    expect(silent).toEqual([]);
  });
});
