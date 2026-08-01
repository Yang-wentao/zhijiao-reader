// Minimal .env loader — reads cloud/.env (KEY=VALUE lines) without adding a
// dependency. Values already present in process.env win, so launchd / shell
// overrides behave as expected.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cloudDir = dirname(fileURLToPath(import.meta.url));

export function loadEnv(filePath = join(cloudDir, ".env")) {
  if (!existsSync(filePath)) {
    return;
  }
  for (const rawLine of readFileSync(filePath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

export const CLOUD_DIR = cloudDir;
