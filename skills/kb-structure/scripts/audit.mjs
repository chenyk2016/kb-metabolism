#!/usr/bin/env node
/**
 * 知识库结构体检（kb-structure 六检）——零依赖，报告即提案清单。
 *
 * 用法: node audit.mjs --vault <库根> [--json]
 * 参数来源: 库内 90-system/目录规范.md 的 kb-structure:params 注释块（缺省用默认值）
 * 退出码: 有 fail 级违规时为 1（方便 cron/CI 判断），否则 0
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// ---------- 参数 ----------
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const argVal = (n) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};

let root = argVal("--vault");
if (!root) {
  // 向上找 .kb/config.json
  let dir = process.cwd();
  for (;;) {
    if (fs.existsSync(path.join(dir, ".kb", "config.json"))) { root = dir; break; }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}
if (!root) {
  console.error("找不到库根：用 --vault <目录> 指定，或在库内运行");
  process.exit(2);
}
root = path.resolve(root);

// 宪法机读参数（<!-- kb-structure:params ... --> 内的 key: value 行）
const params = {
  topLevelMax: 10,
  maxDepth: 2,
  datePrefix: "^\\d{4}-\\d{2}-\\d{2}-",
  topLevelExempt: ["daily", "assets"],
  exemptZones: [], // 深度/命名/副本检查豁免的顶层区（如自治的人格库、创作区）
};
const constitutionFile = path.join(root, "90-system", "目录规范.md");
let constitutionFound = false;
if (fs.existsSync(constitutionFile)) {
  constitutionFound = true;
  const m = fs.readFileSync(constitutionFile, "utf8").match(/<!--\s*kb-structure:params([\s\S]*?)-->/);
  if (m) {
    for (const line of m[1].split("\n")) {
      const kv = line.match(/^\s*(\w+)\s*:\s*(.+?)\s*$/);
      if (!kv) continue;
      const [, k, v] = kv;
      if (k === "topLevelMax" || k === "maxDepth") params[k] = parseInt(v, 10);
      else if (k === "datePrefix") params.datePrefix = v;
      else if (k === "topLevelExempt" || k === "exemptZones")
        params[k] = v.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
}
const dateRe = new RegExp(params.datePrefix);

// kb 配置（managed 前缀 + captureDir）；解析失败不阻断体检
let managedPrefixes = null; // null = 全库视为 managed
let captureDir = null;
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, ".kb", "config.json"), "utf8"));
  captureDir = cfg.captureDir && cfg.captureDir !== "." ? cfg.captureDir : null;
  if (Array.isArray(cfg.managed) && !cfg.managed.includes("**/*.md")) {
    // 简化匹配：只识别 "dir/**" 形式为前缀（覆盖常见配置；复杂 glob 视为前缀截断到首个 *）
    managedPrefixes = cfg.managed.map((g) => g.split("*")[0].replace(/\/+$/, "") + "/");
  }
} catch { /* 无配置照样体检结构 */ }
const isManaged = (rel) =>
  managedPrefixes == null || managedPrefixes.some((p) => (rel + "/").startsWith(p) || rel.startsWith(p));

// ---------- 扫描 ----------
const ALWAYS_SKIP = new Set([".kb", ".git", ".obsidian", "node_modules", "_graveyard"]);
const topSeg = (rel) => rel.split(path.sep)[0];
// 豁免区支持顶层名或任意路径前缀（如 "00-my-inbox/50-归档"）
const inExemptZone = (rel) =>
  params.exemptZones.some((z) => (rel + "/").startsWith(z.replace(/\/+$/, "") + "/"));

const mdFiles = [];   // {rel, depth}
const dirs = [];      // rel
const assetFiles = []; // rel（位于任意 assets/ 之下的文件）
(function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith(".") || ALWAYS_SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    const rel = path.relative(root, full);
    if (e.isDirectory()) {
      dirs.push(rel);
      walk(full);
    } else if (e.isFile()) {
      if (rel.split(path.sep).includes("assets")) assetFiles.push(rel);
      else if (e.name.endsWith(".md")) mdFiles.push({ rel, depth: rel.split(path.sep).length - 1 });
    }
  }
})(root);

// 全部 md 正文只读一遍（撞名/assets/副本三检共用）
const mdContent = new Map();
for (const { rel } of mdFiles) {
  try { mdContent.set(rel, fs.readFileSync(path.join(root, rel), "utf8")); } catch { /* 跳过读不了的 */ }
}

// ---------- 六检 ----------
const checks = [];
const check = (id, title, status, count, details, hint) =>
  checks.push({ id, title, status, count, details: details.slice(0, 12), hint });
const groupCount = (items, keyFn) => {
  const m = new Map();
  for (const it of items) m.set(keyFn(it), (m.get(keyFn(it)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

// 1. 顶层膨胀
{
  const top = fs.readdirSync(root).filter((n) => !n.startsWith(".") && !n.startsWith("_"));
  const over = top.length > params.topLevelMax;
  check("top-level", `顶层条目 ${top.length}/${params.topLevelMax}`, over ? "fail" : "ok",
    top.length, over ? top : [],
    over ? "顶层收编：按行动性归入现有区（参见宪法目标形态）" : null);
}

// 2. 深度超限
{
  const bad = mdFiles.filter((f) => f.depth > params.maxDepth && !inExemptZone(f.rel));
  const byTop = groupCount(bad, (f) => topSeg(f.rel));
  const deepest = [...bad].sort((a, b) => b.depth - a.depth).slice(0, 5).map((f) => `${f.depth} 层: ${f.rel}`);
  check("depth", `深度 > ${params.maxDepth} 层的笔记`, bad.length ? "fail" : "ok", bad.length,
    [...byTop.map(([k, c]) => `${k}: ${c} 篇`), ...deepest],
    bad.length ? "压平或整目录归档；第三层导航改用 MOC 索引笔记" : null);
}

// 3. 命名违规
{
  const illegal = /[\\:*?"<>|]|\s/;
  const badNames = [...mdFiles.map((f) => f.rel), ...dirs]
    .filter((rel) => !inExemptZone(rel) && illegal.test(path.basename(rel)));
  const topDirsNoPrefix = fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("_"))
    .filter((e) => !/^\d{2}-/.test(e.name) && !params.topLevelExempt.includes(e.name))
    .map((e) => e.name + "/");
  const capBad = captureDir
    ? mdFiles.filter((f) => path.dirname(f.rel) === captureDir && !dateRe.test(path.basename(f.rel))).map((f) => f.rel)
    : [];
  const all = [...badNames.map((r) => `非法字符/空格: ${r}`),
               ...topDirsNoPrefix.map((r) => `顶层目录无数字前缀: ${r}`),
               ...capBad.map((r) => `捕捉区缺日期前缀: ${r}`)];
  check("naming", "命名违规", all.length ? "warn" : "ok", all.length, all,
    all.length ? "改名属高危动作（动 basename 即动链接解析），走整理流程附引用改写" : null);
}

// 4. basename 撞名（managed 内，反链按 basename 解析会错乱）
{
  const byBase = new Map();
  for (const { rel } of mdFiles) {
    if (!isManaged(rel)) continue;
    const b = path.basename(rel, ".md");
    (byBase.get(b) ?? byBase.set(b, []).get(b)).push(rel);
  }
  const dupGroups = [...byBase.entries()].filter(([, v]) => v.length > 1);
  check("basename", "managed 内同名笔记（反链错乱源）", dupGroups.length ? "fail" : "ok",
    dupGroups.length, dupGroups.map(([b, v]) => `${b}: ${v.join(" ↔ ")}`),
    dupGroups.length ? "改名其一（附引用改写），或合并为一篇" : null);
}

// 5. assets：孤儿与断链
{
  const assetBases = new Map(assetFiles.map((r) => [path.basename(r), r]));
  const referenced = new Set();
  const broken = [];
  const linkRe = /!\[[^\]]*\]\(([^)]+)\)|!\[\[([^\]]+)\]\]/g;
  for (const [rel, content] of mdContent) {
    for (const m of content.matchAll(linkRe)) {
      const target = m[1] ?? m[2];
      if (!target || /^https?:/.test(target)) continue;
      let name;
      try { name = path.basename(decodeURIComponent(target.split("#")[0].split("|")[0].trim())); }
      catch { name = path.basename(target); }
      if (assetBases.has(name)) referenced.add(name);
      else if (/assets\//.test(target)) broken.push(`${rel} → ${target}`);
    }
  }
  const orphans = [...assetBases.entries()].filter(([b]) => !referenced.has(b)).map(([, r]) => r);
  check("assets", "assets 孤儿/断链", orphans.length + broken.length ? "warn" : "ok",
    orphans.length + broken.length,
    [...orphans.slice(0, 6).map((r) => `孤儿: ${r}`), ...broken.slice(0, 6).map((r) => `断链: ${r}`)],
    orphans.length + broken.length ? `孤儿 ${orphans.length}（笔记处决后遗留可陪葬）；断链 ${broken.length}（引用改写遗漏）` : null);
}

// 6. 内容副本（全库 md，按 sha1；豁免区除外）
{
  const byHash = new Map();
  for (const [rel, content] of mdContent) {
    if (inExemptZone(rel)) continue;
    const h = crypto.createHash("sha1").update(content).digest("hex");
    (byHash.get(h) ?? byHash.set(h, []).get(h)).push(rel);
  }
  const dups = [...byHash.values()].filter((v) => v.length > 1);
  const byPair = groupCount(dups, (v) => `${topSeg(v[0])} ↔ ${topSeg(v[1])}`);
  check("duplicates", "内容完全相同的副本组", dups.length ? "fail" : "ok", dups.length,
    [...byPair.map(([k, c]) => `${k}: ${c} 组`), ...dups.slice(0, 5).map((v) => v.join(" ↔ "))],
    dups.length ? "一篇笔记一个路径：保留一份，其余列处决候选（删除走 kb 名单，人判决）" : null);
}

// ---------- 输出 ----------
const failed = checks.some((c) => c.status === "fail");
if (asJson) {
  console.log(JSON.stringify({ root, constitutionFound, params, checks }, null, 2));
} else {
  const icon = { ok: "✅", warn: "⚠️", fail: "❌" };
  console.log(`# 结构体检报告 ${new Date().toISOString().slice(0, 10)}\n`);
  console.log(`库根: ${root}`);
  console.log(`宪法: ${constitutionFound ? "90-system/目录规范.md" : "未找到（使用默认参数）"}｜豁免区: ${params.exemptZones.join(", ") || "无"}\n`);
  console.log(`| 检查 | 状态 | 数量 |\n|---|---|---|`);
  for (const c of checks) console.log(`| ${c.title} | ${icon[c.status]} | ${c.count} |`);
  for (const c of checks) {
    if (c.status === "ok") continue;
    console.log(`\n## ${icon[c.status]} ${c.title}（${c.count}）`);
    for (const d of c.details) console.log(`- ${d}`);
    if (c.count > c.details.length) console.log(`- …等共 ${c.count} 项（--json 看全量）`);
    if (c.hint) console.log(`\n> 提案方向：${c.hint}`);
  }
  console.log(`\n> 本报告即提案清单——执行任何移动/改名/删除前须经人批准（AI 提案，人是法官）。`);
}
process.exit(failed ? 1 : 0);
