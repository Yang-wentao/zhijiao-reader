#!/usr/bin/env node
// Preprocesses resources/icons/icon-source.png into icon-source-prepared.png:
//   - Adds an alpha channel
//   - Makes near-black pixels (the AI-generated squircle background fill) transparent
//   - Preserves the original artwork colors inside the squircle
//
// Why: AI image generators often emit a 1024x1024 RGB PNG with the rounded-corner
// background area filled with black. macOS Dock does not apply its own squircle
// mask to ad-hoc-signed Electron apps, so the black ring shows up as a "border"
// around the icon. This script turns those black pixels transparent so the
// existing squircle becomes the visible shape.
//
// The original icon-source.png is left untouched so the AI/manual master stays
// authoritative; downstream icon generation reads the prepared file first.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const sourcePath = join(projectRoot, "resources", "icons", "icon-source.png");
const preparedPath = join(projectRoot, "resources", "icons", "icon-source-prepared.png");

if (!existsSync(sourcePath)) {
  console.error(`Missing source PNG: ${sourcePath}`);
  process.exit(1);
}

// Threshold: pixels with R+G+B below this are treated as background fill.
// The AI fill is ~0-5; the darkest real content (book outline shadow) is well above 30.
const BLACK_SUM_THRESHOLD = 30;
// Soft transition: pixels in [THRESHOLD, SOFT_MAX) get proportional alpha
// to anti-alias the squircle boundary.
const SOFT_MAX_SUM = 90;
// macOS app-icon canvas convention (Big Sur / Sonoma / Sequoia):
//   total canvas:  1024 × 1024
//   visible squircle (artwork bounds): 824 × 824 centered (~10% transparent margin)
// This matches the Apple App Icon Template grid; without this margin our icon
// looks ~24% larger than peer apps in the Dock.
const TARGET_CANVAS = 1024;
const TARGET_INNER = 824;

const pythonScript = `
import sys
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
threshold = int(sys.argv[3])
soft_max = int(sys.argv[4])
canvas_size = int(sys.argv[5])
inner_size = int(sys.argv[6])

# Step 1: open as RGBA and color-key the black background fill to transparent.
img = Image.open(src).convert("RGBA")
px = img.load()
w, h = img.size
made_transparent = 0
soft_count = 0
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        s = r + g + b
        if s < threshold:
            px[x, y] = (r, g, b, 0)
            made_transparent += 1
        elif s < soft_max:
            t = (s - threshold) / (soft_max - threshold)
            px[x, y] = (r, g, b, int(255 * t))
            soft_count += 1

# Step 2: shrink to inner_size and place centered on a transparent canvas_size canvas.
# This applies the macOS Big Sur+/Sequoia app-icon margin convention so our icon
# matches the visual size of stock apps in the Dock.
shrunk = img.resize((inner_size, inner_size), Image.LANCZOS)
canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
offset = (canvas_size - inner_size) // 2
canvas.paste(shrunk, (offset, offset))
canvas.save(dst, "PNG")

total = w * h
print(f"transparent={made_transparent} ({100*made_transparent/total:.1f}%), soft={soft_count}, "
      f"shrunk to {inner_size}px centered in {canvas_size}px canvas", flush=True)
`;

const result = spawnSync(
  "python3",
  [
    "-c",
    pythonScript,
    sourcePath,
    preparedPath,
    String(BLACK_SUM_THRESHOLD),
    String(SOFT_MAX_SUM),
    String(TARGET_CANVAS),
    String(TARGET_INNER),
  ],
  { stdio: ["ignore", "inherit", "inherit"] },
);

if (result.status !== 0) {
  console.error("Failed to preprocess icon. Ensure python3 + Pillow are installed:");
  console.error("  pip3 install --user Pillow");
  process.exit(1);
}

console.log(`Wrote: ${preparedPath}`);
