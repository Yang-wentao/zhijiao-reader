// Open two PDFs in tabs, scroll the first to a non-zero position, switch to
// the second, switch back. Verify scroll position is preserved (no flicker /
// no reset to top). Captures any console errors throughout.

import { chromium } from "playwright";
import { resolve } from "node:path";

const pdfA = resolve(process.argv[2] || "");
const pdfB = resolve(process.argv[3] || "");
if (!pdfA || !pdfB) {
  console.error("Usage: node scripts/debug-tab-switch.mjs <pdf-a> <pdf-b>");
  process.exit(1);
}

const APP_URL = "http://localhost:5173/";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

const events = [];
page.on("console", (msg) => {
  const t = msg.type();
  const text = msg.text();
  if (t === "error" || t === "warning") events.push(`[console.${t}] ${text}`);
  if (text.includes("PdfTabViewer")) events.push(`[log] ${text}`);
});
page.on("pageerror", (err) => events.push(`[pageerror] ${err.message}`));

await page.goto(APP_URL, { waitUntil: "load" });
await page.waitForSelector('input[type="file"][accept="application/pdf"]');

// In a fresh user profile the app pops a "setup required" connection settings
// modal that blocks all clicks. Dismiss it.
const closeBtn = page.getByRole("button", { name: "关闭" });
if (await closeBtn.isVisible().catch(() => false)) {
  await closeBtn.click();
  await page.waitForTimeout(200);
}

// Upload pdfA
console.log(`→ Open tab A: ${pdfA}`);
await page.locator('input[type="file"][accept="application/pdf"]').first().setInputFiles(pdfA);
await page.waitForSelector('[data-testid="core__inner-pages"]', { timeout: 15000 });
await page.waitForTimeout(1000);

// Scroll tab A's inner-pages to a known offset so we have something to verify
// preservation against.
await page.evaluate(() => {
  const el = document.querySelector('[data-testid="core__inner-pages"]');
  if (el) el.scrollTop = 1200;
});
await page.waitForTimeout(400);

const scrollAfterScroll = await page.evaluate(() => {
  const visibleViewer = Array.from(document.querySelectorAll('.pdf-tab-viewer')).find(
    v => v.style.visibility !== 'hidden'
  );
  const el = visibleViewer?.querySelector('[data-testid="core__inner-pages"]');
  return el ? el.scrollTop : null;
});
console.log(`  tab A scrollTop after manual scroll: ${scrollAfterScroll}`);

// Upload pdfB (opens as second tab AND becomes active per handleFileSelected)
console.log(`→ Open tab B: ${pdfB}`);
await page.locator('input[type="file"][accept="application/pdf"]').first().setInputFiles(pdfB);
await page.waitForTimeout(2500);

const tabViewerCount = await page.evaluate(() => document.querySelectorAll('.pdf-tab-viewer').length);
// First scroll evaluation uses the visible viewer based on visibility, not display.
const activeTabFile = await page.evaluate(() => {
  const active = document.querySelector('.pdf-tab.active button.pdf-tab-button');
  return active ? active.textContent : null;
});
console.log(`  total tab-viewers in DOM: ${tabViewerCount}`);
console.log(`  active tab: ${activeTabFile}`);

// Click back to tab A (find by aria-pressed or by filename)
console.log(`→ Click tab A`);
const tabAButton = page.locator('.pdf-tab-button').first();
await tabAButton.click();

async function readScrollTop() {
  return await page.evaluate(() => {
    const viewers = Array.from(document.querySelectorAll('.pdf-tab-viewer'));
    const visible = viewers.find(v => v.style.visibility !== 'hidden');
    if (!visible) return { found: false };
    const inner = visible.querySelector('[data-testid="core__inner-pages"]');
    return {
      scrollTop: inner ? inner.scrollTop : null,
      scrollHeight: inner ? inner.scrollHeight : null,
    };
  });
}

for (const delay of [50, 200, 500, 800, 1500, 3000]) {
  await page.waitForTimeout(delay - (delay === 50 ? 0 : [50, 200, 500, 800, 1500].slice(0, [50, 200, 500, 800, 1500, 3000].indexOf(delay)).pop()));
  console.log(`  t≈${delay}ms after click:`, JSON.stringify(await readScrollTop()));
}

await page.screenshot({ path: "/tmp/zhijiao-tab-switch.png", fullPage: false });

console.log("\n=== ERROR EVENTS ===");
if (events.length === 0) console.log("(none)");
else for (const e of events) console.log(e);

await browser.close();
