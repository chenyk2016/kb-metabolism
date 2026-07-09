import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { "/api": "http://127.0.0.1:7317" },
  },
  build: {
    // 构建产物直接进 cli 包：发布物是单包，管理台随 kb 命令走
    outDir: path.resolve(here, "../../packages/cli/dist/web"),
    emptyOutDir: true,
  },
});
