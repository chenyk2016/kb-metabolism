import { spawn } from "node:child_process";
import { serve, type ServerType } from "@hono/node-server";
import { createApp } from "./app.js";
import { mountStatic } from "./static.js";

export type UiOptions = {
  root: string;
  port?: number;
  /** 管理台构建产物目录；不给则只起 API（开发模式配 vite dev 用） */
  webRoot?: string;
  open?: boolean;
};

export const DEFAULT_PORT = 7317;

/** 只绑 127.0.0.1——管理台是单人本地判决台，远程访问是蓝图 Phase C 的事 */
export function startUi(opts: UiOptions): Promise<{ server: ServerType; url: string }> {
  const app = createApp({ root: opts.root });
  if (opts.webRoot) mountStatic(app, opts.webRoot);
  const port = opts.port ?? DEFAULT_PORT;

  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
      const url = `http://127.0.0.1:${info.port}`;
      if (opts.open) openBrowser(url);
      resolve({ server, url });
    });
    server.on("error", reject);
  });
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { detached: true, stdio: "ignore", shell: process.platform === "win32" }).unref();
  } catch {
    // 打不开浏览器不是错误——URL 已经打印给用户
  }
}
