import { cp, mkdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const iconsDir = join(projectRoot, "resources", "icons");
const masterPath = join(iconsDir, "icon-source.png");
const preparedPath = join(iconsDir, "icon-source-prepared.png");
const preprocessScript = join(__dirname, "preprocess-icon.mjs");
const iconsetDir = join(iconsDir, "AppIcon.iconset");
const icnsPath = join(iconsDir, "icon.icns");
const icoPath = join(iconsDir, "icon.ico");
const pngPath = join(iconsDir, "icon.png");

// macOS .icns requires these exact filenames in an .iconset bundle.
// Reference: https://developer.apple.com/library/archive/documentation/GraphicsAnimation/Conceptual/HighResolutionOSX/Optimizing/Optimizing.html
const iconsetEntries = [
  { size: 16, name: "icon_16x16.png" },
  { size: 32, name: "icon_16x16@2x.png" },
  { size: 32, name: "icon_32x32.png" },
  { size: 64, name: "icon_32x32@2x.png" },
  { size: 128, name: "icon_128x128.png" },
  { size: 256, name: "icon_128x128@2x.png" },
  { size: 256, name: "icon_256x256.png" },
  { size: 512, name: "icon_256x256@2x.png" },
  { size: 512, name: "icon_512x512.png" },
  { size: 1024, name: "icon_512x512@2x.png" },
];

if (process.platform !== "darwin") {
  console.error("This script requires macOS (uses sips and iconutil).");
  process.exit(1);
}

await assertMaster();

// Always re-run preprocessing so the prepared file stays in sync with the master.
console.log("Preprocessing icon source (black-fill -> transparent)...");
await execFileAsync("node", [preprocessScript], { stdio: "inherit" }).catch((err) => {
  console.error(err.stdout || "");
  console.error(err.stderr || err.message);
  process.exit(1);
});

const sourcePath = existsSync(preparedPath) ? preparedPath : masterPath;
console.log(`Using source: ${relativeToRoot(sourcePath)}\n`);

await rm(iconsetDir, { recursive: true, force: true });
await mkdir(iconsetDir, { recursive: true });

for (const { size, name } of iconsetEntries) {
  const outPath = join(iconsetDir, name);
  await execFileAsync("sips", [
    "-z", String(size), String(size),
    sourcePath,
    "--out", outPath,
  ]);
  console.log(`  ${name.padEnd(28)} ${size}x${size}`);
}

await execFileAsync("iconutil", ["-c", "icns", iconsetDir, "-o", icnsPath]);
console.log(`\nicns    -> ${relativeToRoot(icnsPath)}`);

await cp(sourcePath, pngPath);
console.log(`png     -> ${relativeToRoot(pngPath)}`);

// Windows .ico: a single file containing 16/32/48/64/128/256 PNG-encoded entries.
// Pillow handles this in one shot — no need for ImageMagick. The .ico file is
// referenced by electron-builder for both the runtime taskbar icon and the
// installer's setup wizard icon.
const icoPythonScript = `
import sys
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
img = Image.open(src).convert("RGBA")
img.save(dst, format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
`;
await execFileAsync("python3", ["-c", icoPythonScript, sourcePath, icoPath]);
console.log(`ico     -> ${relativeToRoot(icoPath)}`);

await rm(iconsetDir, { recursive: true, force: true });
console.log("\nDone. Commit resources/icons/icon.icns, icon.ico, and icon.png.");

async function assertMaster() {
  try {
    const info = await stat(masterPath);
    if (!info.isFile()) throw new Error("not a file");
  } catch {
    console.error(`Missing source: ${relativeToRoot(masterPath)}`);
    console.error("Save your 1024x1024 PNG master to that path, then re-run.");
    process.exit(1);
  }

  const { stdout } = await execFileAsync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", masterPath]);
  const width = Number(stdout.match(/pixelWidth: (\d+)/)?.[1]);
  const height = Number(stdout.match(/pixelHeight: (\d+)/)?.[1]);
  if (width !== 1024 || height !== 1024) {
    console.error(`Source must be exactly 1024x1024, got ${width}x${height}.`);
    process.exit(1);
  }
}

function relativeToRoot(abs) {
  return abs.startsWith(projectRoot) ? abs.slice(projectRoot.length + 1) : abs;
}
