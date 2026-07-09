import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { addNote } from "../src/index.js";
import { makeVault } from "./helpers.js";

/** 入口税：写不出 use_when 的内容只能进 inbox 等死 */
describe("入口税（capture）", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => cleanup?.());

  it("无 use_when → 强制 inbox 并带 30 天过期", async () => {
    const t = await makeVault();
    cleanup = t.cleanup;
    const rel = addNote(t.vault, { title: "随手记", content: "临时内容" });
    const parsed = matter(fs.readFileSync(path.join(t.root, rel), "utf8"));
    expect(parsed.data.kb_tier).toBe("inbox");
    expect(parsed.data.kb_expires).toBeTruthy();
  });

  it("声明 L1 但无 use_when → 拒绝写入", async () => {
    const t = await makeVault();
    cleanup = t.cleanup;
    expect(() => addNote(t.vault, { title: "x", content: "y", tier: "L1" })).toThrow(/入口税/);
  });

  it("有 use_when → 默认 L1", async () => {
    const t = await makeVault();
    cleanup = t.cleanup;
    const rel = addNote(t.vault, { title: "有用的", content: "z", useWhen: "下次部署时" });
    const parsed = matter(fs.readFileSync(path.join(t.root, rel), "utf8"));
    expect(parsed.data.kb_tier).toBe("L1");
    expect(parsed.data.kb_expires).toBeUndefined();
  });

  it("目录越界 → 拒绝", async () => {
    const t = await makeVault();
    cleanup = t.cleanup;
    expect(() =>
      addNote(t.vault, { title: "x", content: "y", dir: "../outside" })
    ).toThrow(/越界/);
  });
});
