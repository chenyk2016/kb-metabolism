import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { newId } from "./identity.js";
import type { Vault } from "./types.js";

export type AddOptions = {
  title: string;
  content: string;
  tier?: "L0" | "L1" | "inbox";
  useWhen?: string;
  dir?: string;
};

function slugify(title: string): string {
  // keep CJK and word chars, collapse everything else to hyphens
  return (
    title
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "note"
  );
}

/**
 * Capture with the entry tax built in: a note that cannot state when it will
 * be needed again (`useWhen`) is only allowed into the inbox tier, where it
 * expires in `inboxDays` unless promoted.
 */
export function addNote(vault: Vault, opts: AddOptions): string {
  let tier = opts.tier ?? (opts.useWhen ? "L1" : "inbox");
  if ((tier === "L0" || tier === "L1") && !opts.useWhen) {
    throw new Error(
      `${tier} 层必须提供 use_when（"什么时候会再用到？"）——入口税：写不出用途只能进 inbox`
    );
  }

  const data: Record<string, unknown> = {
    kb_id: newId(), // 出生即有身份——信号认领与路径解耦
    kb_tier: tier,
    kb_triaged: new Date().toISOString().slice(0, 10),
  };
  if (opts.useWhen) data.kb_use_when = opts.useWhen;
  if (tier === "inbox") {
    data.kb_expires = new Date(Date.now() + vault.config.inboxDays * 86400000)
      .toISOString()
      .slice(0, 10);
  }

  const dir = path.resolve(vault.root, opts.dir ?? vault.config.captureDir);
  if (path.relative(vault.root, dir).startsWith("..")) {
    throw new Error("目录越界：只能写入知识库内部");
  }
  fs.mkdirSync(dir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  let file = path.join(dir, `${date}-${slugify(opts.title)}.md`);
  for (let i = 2; fs.existsSync(file); i++) {
    file = path.join(dir, `${date}-${slugify(opts.title)}-${i}.md`);
  }

  const body = `# ${opts.title}\n\n${opts.content.trim()}\n`;
  fs.writeFileSync(file, matter.stringify(body, data));
  return path.relative(vault.root, file);
}
