import fs from "node:fs";
import path from "node:path";
import type { Context, Hono } from "hono";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

/** 管理台静态资源 + SPA fallback（构建产物随包分发，不依赖任何 CDN） */
export function mountStatic(app: Hono, webRoot: string): void {
  const serve = (c: Context, abs: string) => {
    const ext = path.extname(abs);
    return c.body(fs.readFileSync(abs), 200, {
      "content-type": MIME[ext] ?? "application/octet-stream",
      // hash 命名的静态资源可以放心长缓存；index.html 永远新鲜
      "cache-control": abs.endsWith("index.html") ? "no-cache" : "public, max-age=86400",
    });
  };

  app.get("*", (c) => {
    const rel = path.normalize(decodeURIComponent(new URL(c.req.url).pathname)).replace(/^\/+/, "");
    const abs = path.join(webRoot, rel);
    if (!abs.startsWith(webRoot + path.sep) && abs !== webRoot) {
      return c.text("forbidden", 403);
    }
    if (rel && fs.existsSync(abs) && fs.statSync(abs).isFile()) return serve(c, abs);
    const index = path.join(webRoot, "index.html");
    if (fs.existsSync(index)) return serve(c, index);
    return c.text("管理台静态资源缺失——请重新构建（pnpm build）", 404);
  });
}
