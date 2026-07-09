import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { appendSignal, initVault, runCoroner, runIndex, type Vault } from "@kb/core";
import { createApp } from "../src/app.js";

/**
 * 契约测试：直接打 app.fetch，不占端口。
 * 重点锁死两类不变量——安全边界（Host/Origin/路径/.kb）与信号纪律（kb_ui 不续命）。
 */

const HOST = { host: "127.0.0.1:7317" };
const JSON_H = { ...HOST, "content-type": "application/json" };

let root: string;
let vault: Vault;
let app: Hono;

function ageFile(rel: string, days: number): void {
  const t = new Date(Date.now() - days * 86400000);
  fs.utimesSync(path.join(root, rel), t, t);
}

const req = (p: string, init?: RequestInit & { headers?: Record<string, string> }) =>
  app.request(p, { ...init, headers: { ...HOST, ...init?.headers } });

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "kb-api-test-"));
  vault = initVault(root);
  fs.writeFileSync(
    path.join(root, "alpha.md"),
    `---\nkb_tier: L1\nkb_use_when: "契约测试"\n---\n# Alpha 资料\n\n关于 alpha 的内容。\n`
  );
  fs.writeFileSync(path.join(root, "untriaged.md"), "# 未分诊\n\n内容。\n");
  await runIndex(vault);
  app = createApp({ root });
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("安全边界", () => {
  it("非本机 Host → 403（DNS rebinding 防线）", async () => {
    const r = await app.request("/api/v1/overview", { headers: { host: "evil.com" } });
    expect(r.status).toBe(403);
  });

  it("跨站 Origin 的写操作 → 403", async () => {
    const r = await req("/api/v1/index", {
      method: "POST",
      headers: { origin: "http://evil.com" },
    });
    expect(r.status).toBe(403);
  });

  it("路径越界 → 403", async () => {
    const r = await req("/api/v1/notes/detail?path=../../etc/passwd");
    expect(r.status).toBe(403);
  });

  it(".kb/（secrets 所在地）→ 403", async () => {
    const r = await req("/api/v1/notes/detail?path=.kb/secrets.json");
    expect(r.status).toBe(403);
  });

  it("config 响应永不包含秘密字段", async () => {
    const r = await req("/api/v1/config");
    const text = await r.text();
    expect(text).not.toMatch(/secret|apiKey"/i);
    expect(JSON.parse(text)).toHaveProperty("embeddingKeyConfigured");
  });
});

describe("信号纪律：kb_ui 不续命", () => {
  it("详情浏览记 kb_ui 而非 kb_read；法医照杀", async () => {
    const r = await req(`/api/v1/notes/detail?path=alpha.md`);
    expect(r.status).toBe(200);

    const log = fs.readFileSync(path.join(root, ".kb", "access.log.jsonl"), "utf8");
    const tools = log
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .filter((s) => s.path === "alpha.md")
      .map((s) => s.tool);
    expect(tools).toContain("kb_ui");
    expect(tools).not.toContain("kb_read");

    // 即便被界面看过，超窗零反链的笔记依旧上榜——观察 ≠ 使用
    ageFile("alpha.md", 120);
    await runIndex(vault);
    const { candidates } = runCoroner(vault);
    expect(candidates.map((c) => c.path)).toContain("alpha.md");
  });

  it("检索记 kb_ui 带 query", async () => {
    const r = await req("/api/v1/search?q=alpha");
    expect(r.status).toBe(200);
    const log = fs.readFileSync(path.join(root, ".kb", "access.log.jsonl"), "utf8");
    expect(log).toMatch(/"tool":"kb_ui","query":"alpha"/);
  });
});

describe("判决工作流", () => {
  it("分诊入口税：L1 无 use_when → 400", async () => {
    const r = await req("/api/v1/triage", {
      method: "POST",
      headers: JSON_H,
      body: JSON.stringify({ decisions: [{ path: "untriaged.md", tier: "L1" }] }),
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/入口税/);
  });

  it("分诊成功写层", async () => {
    const r = await req("/api/v1/triage", {
      method: "POST",
      headers: JSON_H,
      body: JSON.stringify({
        decisions: [{ path: "untriaged.md", tier: "L1", useWhen: "测契约时" }],
      }),
    });
    expect(r.status).toBe(200);
    expect(fs.readFileSync(path.join(root, "untriaged.md"), "utf8")).toContain("kb_tier: L1");
  });

  it("digest → 过堂 approve → execute 掩埋（可反悔的唯一删除路径）", async () => {
    const digest = await req("/api/v1/digest", { method: "POST", headers: JSON_H });
    expect(digest.status).toBe(200);
    const { report, candidates } = await digest.json();
    expect(candidates.map((c: { path: string }) => c.path)).toContain("alpha.md");

    const detail = await req(`/api/v1/reports/detail?file=${report}`);
    const { items } = await detail.json();
    const target = items.find((i: { path: string }) => i.path === "alpha.md");

    await req("/api/v1/review/approve", {
      method: "POST",
      headers: JSON_H,
      body: JSON.stringify({ file: report, lines: [target.line] }),
    });
    const exec = await req("/api/v1/review/execute", {
      method: "POST",
      headers: JSON_H,
      body: JSON.stringify({ file: report }),
    });
    expect(exec.status).toBe(200);
    expect((await exec.json()).moved).toContain("alpha.md");
    expect(fs.existsSync(path.join(root, "_graveyard", "alpha.md"))).toBe(true);

    // 还魂
    const restore = await req("/api/v1/graveyard/restore", {
      method: "POST",
      headers: JSON_H,
      body: JSON.stringify({ file: "alpha.md" }),
    });
    expect(restore.status).toBe(200);
    expect(fs.existsSync(path.join(root, "alpha.md"))).toBe(true);
  });

  it("config 白名单：未知字段 → 400", async () => {
    const r = await req("/api/v1/config", {
      method: "PUT",
      headers: JSON_H,
      body: JSON.stringify({ evil: true }),
    });
    expect(r.status).toBe(400);
  });
});
