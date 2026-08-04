import { createReadStream, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { configDefaults, defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SAMPLE_PDF = "/deepseek-v4-report.pdf";

// In production the gateway serves site/ at the root, so the web app can just
// fetch /deepseek-v4-report.pdf. The dev server has no such root, so hand the
// same file over from disk — otherwise "试读示例" only works once deployed.
const serveSamplePdf: Plugin = {
  name: "serve-sample-pdf",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use(SAMPLE_PDF, (_req, res) => {
      const file = join(ROOT, "site", SAMPLE_PDF.slice(1));
      try {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Length", statSync(file).size);
        createReadStream(file).pipe(res);
      } catch {
        res.statusCode = 404;
        res.end();
      }
    });
  },
};

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
    plugins: isWeb ? [react(), serveSamplePdf] : [react()],
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
