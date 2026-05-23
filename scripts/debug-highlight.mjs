// End-to-end check for the highlight + explicit-save model:
//   select text → pick a color  → overlay appears, PDF file NOT yet changed
//   Cmd+S                       → highlight written into the PDF file
//   Cmd+Z (undo)                → overlay gone, file unchanged until save
//   Cmd+S                       → file reflects the undo
//   Cmd+Shift+Z (redo)          → overlay back
//
// Usage: node scripts/debug-highlight.mjs /path/to/sample.pdf

import { chromium } from "playwright";
import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PDFDocument, PDFName, PDFArray, PDFDict } from "pdf-lib";

const srcPdf = resolve(process.argv[2] || "");
if (!srcPdf) {
  console.error("Usage: node scripts/debug-highlight.mjs <sample.pdf>");
  process.exit(1);
}

const dir = await mkdtemp(join(tmpdir(), "zhijiao-hl-"));
const testPdf = join(dir, "highlight-test.pdf");
await copyFile(srcPdf, testPdf);
console.log(`→ Test copy: ${testPdf}`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`[console.error] ${m.text()}`);
});

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

async function countHighlightAnnots() {
  const pdfDoc = await PDFDocument.load(new Uint8Array(await readFile(testPdf)));
  let n = 0;
  pdfDoc.getPages().forEach((pg) => {
    const annots = pg.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) return;
    for (let i = 0; i < annots.size(); i += 1) {
      const a = pdfDoc.context.lookupMaybe(annots.get(i), PDFDict);
      const sub = a ? a.lookupMaybe(PDFName.of("Subtype"), PDFName) : null;
      if (sub && sub.decodeText() === "Highlight") n += 1;
    }
  });
  return n;
}
const overlayCount = () => page.locator(".zhijiao-highlight-group").count();

console.log("→ Select text on page 1 and open the context menu");
await page.evaluate(() => {
  const span = Array.from(
    document.querySelectorAll('[data-testid="core__text-layer-0"] span'),
  ).find((s) => (s.textContent ?? "").trim().length > 2);
  const range = document.createRange();
  range.selectNodeContents(span);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  const rect = span.getBoundingClientRect();
  span.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + 2,
      clientY: rect.top + 2,
    }),
  );
});
await page.waitForTimeout(300);

console.log("→ Click the first color swatch");
await page.locator(".pdf-context-color-swatch").first().click();
await page.waitForTimeout(800);
const overlayAfterMark = await overlayCount();
const annotsAfterMark = await countHighlightAnnots();
console.log(`  overlay=${overlayAfterMark}  PDF annots=${annotsAfterMark}  (expect overlay=1, annots=0)`);

console.log("→ Cmd+S to save");
await page.keyboard.press("Meta+s");
await page.waitForTimeout(1200);
const annotsAfterSave = await countHighlightAnnots();
console.log(`  PDF annots after save=${annotsAfterSave}  (expect 1)`);

console.log("→ Cmd+Z to undo");
await page.keyboard.press("Meta+z");
await page.waitForTimeout(500);
const overlayAfterUndo = await overlayCount();
const annotsAfterUndo = await countHighlightAnnots();
console.log(`  overlay=${overlayAfterUndo}  PDF annots=${annotsAfterUndo}  (expect overlay=0, annots=1 — not saved yet)`);

console.log("→ Cmd+S to save the undo");
await page.keyboard.press("Meta+s");
await page.waitForTimeout(1200);
const annotsAfterUndoSave = await countHighlightAnnots();
console.log(`  PDF annots=${annotsAfterUndoSave}  (expect 0)`);

console.log("→ Cmd+Shift+Z to redo");
await page.keyboard.press("Meta+Shift+z");
await page.waitForTimeout(500);
const overlayAfterRedo = await overlayCount();
console.log(`  overlay=${overlayAfterRedo}  (expect 1)`);

const checks = {
  "mark shows overlay": overlayAfterMark === 1,
  "mark does NOT touch file": annotsAfterMark === 0,
  "Cmd+S writes to file": annotsAfterSave === 1,
  "undo clears overlay": overlayAfterUndo === 0,
  "undo does NOT touch file": annotsAfterUndo === 1,
  "Cmd+S after undo clears file": annotsAfterUndoSave === 0,
  "redo restores overlay": overlayAfterRedo === 1,
};

console.log("\n=== RESULT ===");
let allPass = true;
for (const [name, ok] of Object.entries(checks)) {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) allPass = false;
}
console.log(`console errors: ${errors.length === 0 ? "none" : errors.join("; ")}`);

await browser.close();
process.exit(allPass ? 0 : 1);
