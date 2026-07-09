import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import {
  addNote,
  appendSignal,
  lastByNoteId,
  notePathIdMap,
  openDb,
  readNoteId,
  runCoroner,
  runIndex,
} from "../src/index.js";
import { dateStr, fm, makeVault } from "./helpers.js";

function ageFile(root: string, rel: string, days: number): void {
  const t = new Date(Date.now() - days * 86400000);
  fs.utimesSync(path.join(root, rel), t, t);
}

const OLD_L1 = fm({ kb_tier: "L1", kb_use_when: "测试" }, "# 老资料\n\n很久没人碰的内容。");

describe("笔记身份（kb_id）", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => cleanup?.());

  it("index 自愈补发：缺 kb_id 的 managed 笔记获得身份，且幂等", async () => {
    const t = await makeVault({ "a.md": OLD_L1, "b.md": "# 裸笔记\n\n没有 frontmatter。" });
    cleanup = t.cleanup;
    // makeVault 已跑过一次 index，两篇都该有 id 了
    const idA = readNoteId(path.join(t.root, "a.md"));
    const idB = readNoteId(path.join(t.root, "b.md"));
    expect(idA).toBeTruthy();
    expect(idB).toBeTruthy();
    expect(idA).not.toBe(idB);
    // 幂等：再跑一次不再补发、id 不变
    const r2 = await runIndex(t.vault);
    expect(r2.idsAssigned).toBe(0);
    expect(readNoteId(path.join(t.root, "a.md"))).toBe(idA);
  });

  it("撞号自愈：复制文件后到者获得新 id", async () => {
    const t = await makeVault({ "a.md": OLD_L1 });
    cleanup = t.cleanup;
    fs.copyFileSync(path.join(t.root, "a.md"), path.join(t.root, "z-copy.md"));
    await runIndex(t.vault);
    const idA = readNoteId(path.join(t.root, "a.md"));
    const idZ = readNoteId(path.join(t.root, "z-copy.md"));
    expect(idA).toBeTruthy();
    expect(idZ).toBeTruthy();
    expect(idA).not.toBe(idZ);
  });

  it("出生即有身份：addNote 写入 kb_id", async () => {
    const t = await makeVault();
    cleanup = t.cleanup;
    const rel = addNote(t.vault, { title: "新知识", content: "内容", useWhen: "测试时" });
    const parsed = matter(fs.readFileSync(path.join(t.root, rel), "utf8"));
    expect(typeof parsed.data.kb_id).toBe("string");
    expect((parsed.data.kb_id as string).length).toBeGreaterThan(0);
  });

  it("核心验收：移动笔记后续命信号仍被认领（不上处决名单）", async () => {
    const t = await makeVault({ "old.md": OLD_L1 });
    cleanup = t.cleanup;
    const id = readNoteId(path.join(t.root, "old.md"))!;
    ageFile(t.root, "old.md", 120);
    await runIndex(t.vault);
    // 走门读取（带 id，模拟新版 MCP 门）
    appendSignal(t.root, { tool: "kb_read", path: "old.md", id });
    // 人整理目录：挪进子目录并改名
    fs.mkdirSync(path.join(t.root, "30-resources"), { recursive: true });
    fs.renameSync(path.join(t.root, "old.md"), path.join(t.root, "30-resources/renamed.md"));
    ageFile(t.root, "30-resources/renamed.md", 120);
    await runIndex(t.vault);
    const { candidates } = runCoroner(t.vault);
    expect(candidates.map((c) => c.path)).not.toContain("30-resources/renamed.md");
    // id 不因移动改变
    expect(readNoteId(path.join(t.root, "30-resources/renamed.md"))).toBe(id);
  });

  it("历史 path 行兜底：未移动时按当前路径认领；移动后失联（migrate-signals 的存在理由）", async () => {
    const t = await makeVault({ "old.md": OLD_L1 });
    cleanup = t.cleanup;
    appendSignal(t.root, { tool: "kb_read", path: "old.md" }); // 旧版无 id 的行
    const db = openDb(t.root);
    const p2i = notePathIdMap(db);
    db.close();
    const id = readNoteId(path.join(t.root, "old.md"))!;
    expect(lastByNoteId(t.root, "kb_read", p2i).has(id)).toBe(true);
    // 移动后旧行按 path 解析不到了
    fs.renameSync(path.join(t.root, "old.md"), path.join(t.root, "moved.md"));
    await runIndex(t.vault);
    const db2 = openDb(t.root);
    const p2i2 = notePathIdMap(db2);
    db2.close();
    expect(lastByNoteId(t.root, "kb_read", p2i2).has(id)).toBe(false);
  });

  it("派生性不变量：删 kb.db 重建后 id 认领恢复", async () => {
    const t = await makeVault({ "old.md": OLD_L1 });
    cleanup = t.cleanup;
    const id = readNoteId(path.join(t.root, "old.md"))!;
    appendSignal(t.root, { tool: "kb_read", path: "old.md", id });
    for (const f of ["kb.db", "kb.db-wal", "kb.db-shm"]) {
      fs.rmSync(path.join(t.root, ".kb", f), { force: true });
    }
    await runIndex(t.vault);
    const db = openDb(t.root);
    const p2i = notePathIdMap(db);
    db.close();
    expect(lastByNoteId(t.root, "kb_read", p2i).get(id)).toBeTruthy();
  });
});
