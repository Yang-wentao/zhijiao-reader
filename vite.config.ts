import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// `--mode web` builds the browser-only bundle（网页版）: base /app/, output in
// site/app/ so the cloud/ gateway serves it at zhijiao-reader.com/app/ next
// to the landing page. In web dev, /v1 is proxied to the production gateway
// (there is no local gateway with an API key on dev machines).
export default defineConfig(({ mode }) => {
  const isWeb = mode === "web";
  const proxy: Record<string, { target: string; changeOrigin: boolean }> = isWeb
    ? { "/v1": { target: "https://api.zhijiao-reader.com", changeOrigin: true } }
    : { "/api": { target: "http://localhost:8787", changeOrigin: true } };
  return {
    plugins: [react()],
    base: isWeb ? "/app/" : "/",
    build: isWeb ? { outDir: "site/app", emptyOutDir: true } : {},
    server: {
      port: 5173,
      proxy,
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
  };
});
