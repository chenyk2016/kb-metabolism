import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VAULT_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), ".vault-path");

/**
 * 三条判决工作流的端到端：全部打真实文件系统（git mv / frontmatter / L0 落盘），
 * 外加把"kb_ui 不续命"的信号纪律锁死在管道级。
 */

const vault = () => fs.readFileSync(VAULT_FILE, "utf8").trim();

test.describe.configure({ mode: "serial" });

test("信号纪律：界面浏览记 kb_ui，绝不产生 kb_read", async ({ page }) => {
  await page.goto("/notes");
  await page.getByText("高频资料").click();
  await expect(page.getByText("此次浏览已记 kb_ui")).toBeVisible();

  const log = fs.readFileSync(path.join(vault(), ".kb", "access.log.jsonl"), "utf8");
  const uiSignals = log.match(/"tool":"kb_ui"/g) ?? [];
  expect(uiSignals.length).toBeGreaterThan(0);
  // fixture 里只有 setup 时 CLI 读过 2 次——界面浏览不得增加 kb_read
  const readSignals = log.match(/"tool":"kb_read"/g) ?? [];
  expect(readSignals.length).toBe(2);
});

test("过堂：盖处决章 → 执行 → git 掩埋进墓地", async ({ page }) => {
  await page.goto("/review");
  await expect(page.getByText("expired.md")).toBeVisible();

  await page.getByRole("button", { name: "处决", exact: true }).click();
  await expect(page.locator(".stamp")).toHaveText("处决");

  await page.getByRole("button", { name: "执行判决" }).click();
  await page.getByRole("button", { name: "确认掩埋" }).click();
  await expect(page.getByText(/已掩埋 1 篇/)).toBeVisible();

  expect(fs.existsSync(path.join(vault(), "_graveyard", "expired.md"))).toBe(true);
  expect(fs.existsSync(path.join(vault(), "expired.md"))).toBe(false);
});

test("分诊：入口税禁用 L0/L1，填用途后定层落 frontmatter", async ({ page }) => {
  await page.goto("/triage");
  await expect(page.getByText("未分诊笔记")).toBeVisible();

  const l1 = page.getByRole("button", { name: "L1 资料级" });
  await expect(l1).toBeDisabled();

  await page.getByPlaceholder(/写周报/).fill("E2E 验证入口税时");
  await expect(l1).toBeEnabled();
  await l1.click();

  await expect(page.getByText(/没有未分诊的笔记|这一批分诊完了/)).toBeVisible();
  const raw = fs.readFileSync(path.join(vault(), "fresh.md"), "utf8");
  expect(raw).toContain("kb_tier: L1");
  expect(raw).toContain("E2E 验证入口税时");
});

test("消化：人写判断 → L0 落盘 + 源标 kb_digested", async ({ page }) => {
  await page.goto("/chew");
  await page.getByRole("button", { name: /高频资料/ }).click();

  await page.locator("textarea").fill("高频资料的结论一句话版");
  await page.locator('input:not([placeholder])').last().fill("E2E 回归时");
  await page.getByRole("button", { name: "落成 L0 判断" }).click();
  await expect(page.getByText(/L0 已生成/)).toBeVisible();

  const files = fs.readdirSync(vault());
  const l0 = files.find((f) => f.includes("高频资料的结论一句话版"));
  expect(l0).toBeTruthy();
  expect(fs.readFileSync(path.join(vault(), "hot-l1.md"), "utf8")).toContain("kb_digested: true");
});
