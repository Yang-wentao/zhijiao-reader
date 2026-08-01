import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    // Only run the repo's own tests — stale project copies (agent worktrees,
    // manual backups) otherwise get picked up and double-count the suite.
    // cloud/ uses node:test (run with `npm test` inside cloud/), not vitest.
    exclude: [...configDefaults.exclude, "cloud/**", ".claude/**", "无关文件备用/**", "workspace-misc/**", "测试截图/**"],
  },
});
