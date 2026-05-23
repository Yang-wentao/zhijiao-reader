// Verify the *written PDF* for a multi-line highlight: select several lines,
// mark a color, Cmd+S, then read the Highlight annotation's QuadPoints back
// and confirm there is exactly one quad per visual line with NO vertical
// overlap — the data-level fix for WPS rendering darker middle lines.
//
// Usage: node scripts/debug-highlight-quads.mjs /path/to/sample.pdf

import { chromium } from "playwright";
import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFNumber } from "pdf-lib";

const srcPdf = resolve(process.argv[2] || "");
if (!srcPdf) {
  console.error("Usage: node scripts/debug-highlight-quads.mjs <sample.pdf>");
  process.exit(1);
}

const dir = await mkdtemp(join(tmpdir(), "zhijiao-quads-"));
const testPdf = join(dir, "quads-test.pdf");
await copyFile(srcPdf, testPdf);
console.log(`→ Test copy: ${testPdf}`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
await page.addInitScript((path) => {
  window.desktopShell = { isElectron: true, getPathForFile: () => path };
}, testPdf);

await page.goto("http://localhost:5173/", { waitUntil: "load" });
await page.waitForSelector('input[type="file"][accept="application/pdf"]');
const closeBtn = page.getByRole("button", { name: "关闭" });
if (await closeBtn.isVisible().catch(() => false)) await closeBtn.click();

console.log("→ Upload PDF");
await page.locator('input[type="file"][accept="application/pdf"]').first().setInputFiles(testPdf);
await page.waitForSelector('[data-testid="core__text-layer-0"]', { timeout: 15000 });
await page.waitForTimeout(800);

console.log("→ Select ~40 spans (several lines) and open the context menu");
await page.evaluate(() => {
  const spans = Array.from(
    document.querySelectorAll('[data-testid="core__text-layer-0"] span'),
  ).filter((s) => (s.textContent ?? "").trim().length > 0);
  const first = spans[0];
  const last = spans[Math.min(40, spans.length - 1)];
  const range = document.createRange();
  range.setStart(first.firstChild ?? first, 0);
  const lastNode = last.firstChild ?? last;
  range.setEnd(lastNode, lastNode.textContent ? lastNode.textContent.length : 0);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  const rect = last.getBoundingClientRect();
  last.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + 2,
      clientY: rect.top + 2,
    }),
  );
});
await page.waitForTimeout(300);

console.log("→ Click the first color swatch, then Cmd+S");
await page.locator(".pdf-context-color-swatch").first().click();
await page.waitForTimeout(500);
await page.keyboard.press("Meta+s");
await page.waitForTimeout(1200);

const pdfDoc = await PDFDocument.load(new Uint8Array(await readFile(testPdf)));
const quadGroups = [];
pdfDoc.getPages().forEach((pg) => {
  const annots = pg.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (!annots) return;
  for (let i = 0; i < annots.size(); i += 1) {
    const a = pdfDoc.context.lookupMaybe(annots.get(i), PDFDict);
    const sub = a ? a.lookupMaybe(PDFName.of("Subtype"), PDFName) : null;
    if (!sub || sub.decodeText() !== "Highlight") continue;
    const qp = a.lookupMaybe(PDFName.of("QuadPoints"), PDFArray);
    if (!qp) continue;
    const nums = [];
    for (let j = 0; j < qp.size(); j += 1) {
      const n = qp.get(j);
      nums.push(n instanceof PDFNumber ? n.asNumber() : Number(n));
    }
    quadGroups.push(nums);
  }
});

if (quadGroups.length === 0) {
  console.log("✗ no Highlight annotation found in saved PDF");
  await browser.close();
  process.exit(1);
}

// Each quad = 8 numbers: x1 y1 x2 y2 x3 y3 x4 y4 (TL TR BL BR).
const nums = quadGroups[0];
const quads = [];
for (let i = 0; i + 7 < nums.length; i += 8) {
  const ys = [nums[i + 1], nums[i + 3], nums[i + 5], nums[i + 7]];
  const xs = [nums[i], nums[i + 2], nums[i + 4], nums[i + 6]];
  quads.push({
    top: Math.max(...ys),
    bottom: Math.min(...ys),
    left: Math.min(...xs),
    right: Math.max(...xs),
  });
}
quads.sort((a, b) => b.top - a.top); // PDF Y grows upward → top first

console.log(`\nHighlight annotation has ${quads.length} quad(s):\n`);
const r = (n) => Math.round(n * 10) / 10;
for (const q of quads) {
  console.log(
    `  top=${String(r(q.top)).padStart(7)}  bottom=${String(r(q.bottom)).padStart(7)}  ` +
      `h=${String(r(q.top - q.bottom)).padStart(5)}  left=${String(r(q.left)).padStart(7)}  right=${String(r(q.right)).padStart(7)}`,
  );
}

let overlap = false;
for (let i = 0; i < quads.length - 1; i += 1) {
  // sorted top→bottom: quad[i] is above quad[i+1]; bottom of i should be
  // >= top of i+1 (no vertical overlap).
  if (quads[i].bottom < quads[i + 1].top - 0.05) overlap = true;
}
let dup = false;
for (let i = 0; i < quads.length; i += 1) {
  for (let j = i + 1; j < quads.length; j += 1) {
    if (
      Math.abs(quads[i].top - quads[j].top) < 1 &&
      Math.abs(quads[i].bottom - quads[j].bottom) < 1
    ) {
      dup = true;
    }
  }
}

console.log("\n=== RESULT ===");
console.log(`${!dup ? "✓" : "✗"} no duplicate quads on the same line`);
console.log(`${!overlap ? "✓" : "✗"} quads do not overlap vertically`);

await browser.close();
process.exit(!dup && !overlap ? 0 : 1);
