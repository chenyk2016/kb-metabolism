import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { contentAgeMap } from "../src/age.js";

/** 真实 git 仓库 + GIT_COMMITTER_DATE 造确定性历史（协议的年龄口径就是 git，不 mock） */
function git(root: string, args: string[], daysAgo?: number): void {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (daysAgo !== undefined) {
    const d = new Date(Date.now() - daysAgo * 86400000).toISOString();
    env.GIT_COMMITTER_DATE = d;
    env.GIT_AUTHOR_DATE = d;
  }
  execFileSync("git", ["-C", root, ...args], { env, stdio: "ignore" });
}

function makeRepo(): { root: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kb-age-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "t@test"]);
  git(root, ["config", "user.name", "t"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function write(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function commitAll(root: string, msg: string, daysAgo: number): void {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", msg, "--no-verify"], daysAgo);
}

function daysOf(iso: string): number {
  return Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
}

const BULK = 30;

describe("内容年龄（contentAgeMap）", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => cleanup?.());

  it("普通提交 = 触碰；中文路径能对上（quotepath 修复）", () => {
    const t = makeRepo();
    cleanup = t.cleanup;
    write(t.root, "中文笔记.md", "# 内容\n");
    commitAll(t.root, "add", 100);
    const map = contentAgeMap(t.root, BULK)!;
    expect(map.has("中文笔记.md")).toBe(true);
    expect(daysOf(map.get("中文笔记.md")!)).toBeGreaterThanOrEqual(99);
  });

  it("批量提交（>阈值个文件）不刷新已有历史；批量导入的新文件回退出生时间", () => {
    const t = makeRepo();
    cleanup = t.cleanup;
    write(t.root, "note.md", "# 老笔记\n\n正文。\n");
    commitAll(t.root, "add note", 200);
    // 批量 sweep：改 note.md + 新增 31 个文件 = 32 条记录 > 30
    write(t.root, "note.md", "# 老笔记\n\n正文。\n\nkb_id 之类的批量写回。\n");
    for (let i = 0; i < 31; i++) write(t.root, `bulk/f${i}.md`, `# ${i}\n`);
    commitAll(t.root, "migration sweep", 5);
    const map = contentAgeMap(t.root, BULK)!;
    expect(daysOf(map.get("note.md")!)).toBeGreaterThanOrEqual(199); // 年龄没被清零
    expect(daysOf(map.get("bulk/f0.md")!)).toBeLessThanOrEqual(6); // 新文件仍有出生时间
  });

  it("git mv 不算触碰，且旧路径的历史跟到新路径；真实编辑才刷新", () => {
    const t = makeRepo();
    cleanup = t.cleanup;
    write(t.root, "note.md", "# 笔记\n\n一些足够长的内容，保证 rename 检测。\n");
    commitAll(t.root, "add", 150);
    fs.mkdirSync(path.join(t.root, "moved"));
    git(t.root, ["mv", "note.md", "moved/note.md"]);
    commitAll(t.root, "reorganize", 3);
    let map = contentAgeMap(t.root, BULK)!;
    expect(map.has("note.md")).toBe(false);
    expect(daysOf(map.get("moved/note.md")!)).toBeGreaterThanOrEqual(149); // 移动 ≠ 续命

    write(t.root, "moved/note.md", "# 笔记\n\n真的改了内容。\n");
    commitAll(t.root, "edit", 0);
    map = contentAgeMap(t.root, BULK)!;
    expect(daysOf(map.get("moved/note.md")!)).toBeLessThanOrEqual(1); // 真编辑刷新
  });

  it("vault 是仓库子目录时，git 路径前缀被剥掉（notes/content/ 场景）", () => {
    const t = makeRepo();
    cleanup = t.cleanup;
    write(t.root, "notes/content/老笔记.md", "# 老\n");
    write(t.root, "sessions/log.md", "# 仓库里 vault 之外的噪音\n");
    commitAll(t.root, "add", 120);
    const map = contentAgeMap(path.join(t.root, "notes/content"), BULK)!;
    expect(map.has("老笔记.md")).toBe(true);
    expect(map.has("notes/content/老笔记.md")).toBe(false);
    expect(map.has("sessions/log.md")).toBe(false);
    expect(daysOf(map.get("老笔记.md")!)).toBeGreaterThanOrEqual(119);
  });

  it("非 git 目录返回 null（调用方回退 mtime）", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kb-age-plain-"));
    cleanup = () => fs.rmSync(root, { recursive: true, force: true });
    expect(contentAgeMap(root, BULK)).toBeNull();
  });
});
