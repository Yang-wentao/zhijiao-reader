// Measure the perceived "switch time": how long does it take from clicking
// a tab button until the new tab's PDF pages are actually painted?
// Hypothesis: react-pdf-viewer's render queue prunes canvases when its
// container is display:none, so we have to wait for re-render on switch-back.

import { chromium } from "playwright";
import { resolve } from "node:path";

const pdfA = resolve(process.argv[2]);
const pdfB = resolve(process.argv[3]);

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));

await page.goto("http://localhost:5173/", { waitUntil: "load" });
await page.waitForSelector('input[type="file"][accept="application/pdf"]');
const closeBtn = page.getByRole("button", { name: "关闭" });
if (await closeBtn.isVisible().catch(() => false)) await closeBtn.click();

// Open tab A and wait until pages are RENDERED (canvases have non-zero size).
async function waitForPagesRendered() {
  await page.waitForFunction(() => {
    const visible = Array.from(document.querySelectorAll('.pdf-tab-viewer')).find(
      v => v.style.visibility !== 'hidden'
    );
    if (!visible) return false;
    const canvases = visible.querySelectorAll('canvas');
    if (canvases.length === 0) return false;
    // First canvas must have actual rendered content (width > 0)
    return canvases[0].width > 0;
  }, { timeout: 15000 });
}

console.log("→ Open tab A and wait for full render");
await page.locator('input[type="file"][accept="application/pdf"]').first().setInputFiles(pdfA);
await waitForPagesRendered();
const afterAReady = Date.now();
console.log(`  tab A ready @ ${Date.now() - afterAReady}ms baseline`);

await page.waitForTimeout(800);

console.log("→ Open tab B and wait for full render");
await page.locator('input[type="file"][accept="application/pdf"]').first().setInputFiles(pdfB);
await waitForPagesRendered();
console.log("  tab B ready");

await page.waitForTimeout(800);

// Now measure switch back to A.
console.log("→ Click tab A, measure time until pages painted in tab A");
const clickT = Date.now();

// Sample at various intervals to see what's visible / painted
const samples = [0, 50, 100, 200, 300, 500, 700, 1000, 1500];
let firstPaintAt = null;

await page.locator('.pdf-tab-button').first().click();

for (const t of samples) {
  if (t > 0) {
    const elapsed = Date.now() - clickT;
    if (elapsed < t) await page.waitForTimeout(t - elapsed);
  }
  const snapshot = await page.evaluate(() => {
    const visible = Array.from(document.querySelectorAll('.pdf-tab-viewer')).find(
      v => v.style.visibility !== 'hidden'
    );
    if (!visible) return { found: false };
    const canvases = visible.querySelectorAll('canvas');
    const firstNonZero = Array.from(canvases).find(c => c.width > 0 && c.height > 0);
    return {
      canvasCount: canvases.length,
      hasPaintedCanvas: !!firstNonZero,
      firstCanvasWH: firstNonZero ? `${firstNonZero.width}x${firstNonZero.height}` : null,
      innerPagesScrollTop: visible.querySelector('[data-testid="core__inner-pages"]')?.scrollTop ?? null,
    };
  });
  if (!firstPaintAt && snapshot.hasPaintedCanvas) firstPaintAt = t;
  console.log(`  t=${t}ms:`, JSON.stringify(snapshot));
}

console.log(`\n→ FIRST PAINT AFTER CLICK: ~${firstPaintAt ?? '>1500'}ms`);

await browser.close();
