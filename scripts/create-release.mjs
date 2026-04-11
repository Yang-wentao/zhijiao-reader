import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const releaseDir = join(projectRoot, "release");

await mkdir(releaseDir, { recursive: true });

const shortCommit = await git(["rev-parse", "--short", "HEAD"]);
const fullCommit = await git(["rev-parse", "HEAD"]);
const subject = await git(["log", "-1", "--pretty=%s"]);
const timestamp = createTimestamp();
const fileName = `zhijiao-reader-${shortCommit}-${timestamp}.zip`;
const outputPath = join(releaseDir, fileName);

await execFileAsync("git", ["archive", "--format=zip", "--output", outputPath, "HEAD"], {
  cwd: projectRoot,
});

const manifestPath = join(releaseDir, "manifest.json");
const existingManifest = await loadManifest(manifestPath);
existingManifest.unshift({
  file: fileName,
  commit: fullCommit,
  shortCommit,
  subject,
  createdAt: new Date().toISOString(),
});
await writeFile(manifestPath, JSON.stringify(existingManifest, null, 2) + "\n", "utf8");

console.log(outputPath);

async function git(args) {
  const { stdout } = await execFileAsync("git", args, { cwd: projectRoot });
  return stdout.trim();
}

function createTimestamp() {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

async function loadManifest(manifestPath) {
  try {
    return JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    return [];
  }
}
