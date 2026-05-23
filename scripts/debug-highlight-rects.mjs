// Diagnostic: open a PDF, select several lines of text on page 1, and dump
// the raw rectangles range.getClientRects() returns — so we can see whether
// adjacent-line rects overlap / duplicate (which would make the written PDF
// QuadPoints render with darker middle lines in WPS).
//
// Usage: node scripts/debug-highlight-rects.mjs /path/to/sample.pdf

import { chromium } from "playwright";
import { resolve } from "node:path";

const srcPdf = resolve(process.argv[2] || "");
if (!srcPdf) {
  console.error("Usage: node scripts/debug-highlight-rects.mjs <sample.pdf>");
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext()).newPage();

await page.goto("http://localhost:5173/", { waitUntil: "load" });
await page.waitForSelector('input[type="file"][accept="application/pdf"]');
const closeBtn = page.getByRole("button", { name: "关闭" });
if (await closeBtn.isVisible().catch(() => false)) await closeBtn.click();

await page.locator('input[type="file"][accept="application/pdf"]').first().setInputFiles(srcPdf);
await page.waitForSelector('[data-testid="core__text-layer-0"]', { timeout: 15000 });
await page.waitForTimeout(1000);

const dump = await page.evaluate(() => {
  const spans = Array.from(document.querySelectorAll('[data-testid="core__text-layer-0"] span'));
  const textSpans = spans.filter((s) => (s.textContent ?? "").trim().length > 0);
  if (textSpans.length < 6) return { error: `only ${textSpans.length} text spans` };

  // Select from the first span to a span ~40 spans later — spans several lines.
  const first = textSpans[0];
  const last = textSpans[Math.min(40, textSpans.length - 1)];
  const range = document.createRange();
  range.setStart(first.firstChild ?? first, 0);
  const lastNode = last.firstChild ?? last;
  range.setEnd(lastNode, lastNode.textContent ? lastNode.textContent.length : 0);

  const pageEl = document.querySelector('[data-testid="core__page-layer-0"]');
  const pageBox = pageEl.getBoundingClientRect();

  const round = (n) => Math.round(n * 10) / 10;
  const clientRects = Array.from(range.getClientRects())
    .filter((r) => r.width >= 1 && r.height >= 1)
    .map((r) => ({
      top: round(r.top - pageBox.top),
      bottom: round(r.bottom - pageBox.top),
      left: round(r.left - pageBox.left),
      right: round(r.right - pageBox.left),
      h: round(r.height),
    }));

  // Replicate computeHighlightRects' per-line merge so we can confirm the
  // duplicate overlapping bands collapse to one clean rect per line.
  const lines = [];
  for (const r of clientRects) {
    const rCenter = (r.top + r.bottom) / 2;
    const rHeight = r.bottom - r.top;
    const line = lines.find((l) => {
      const lCenter = (l.top + l.bottom) / 2;
      const tol = Math.max(rHeight, l.bottom - l.top) * 0.5;
      return Math.abs(lCenter - rCenter) <= tol;
    });
    if (line) {
      line.left = Math.min(line.left, r.left);
      line.right = Math.max(line.right, r.right);
      line.top = Math.min(line.top, r.top);
      line.bottom = Math.max(line.bottom, r.bottom);
    } else {
      lines.push({ ...r });
    }
  }
  lines.sort((a, b) => a.top - b.top);
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (lines[i].bottom > lines[i + 1].top) {
      const mid = (lines[i].bottom + lines[i + 1].top) / 2;
      lines[i].bottom = mid;
      lines[i + 1].top = mid;
    }
  }
  const merged = lines.map((l) => ({
    top: round(l.top),
    bottom: round(l.bottom),
    left: round(l.left),
    right: round(l.right),
    h: round(l.bottom - l.top),
  }));

  return {
    selectedText: range.toString().slice(0, 80),
    pageWidth: Math.round(pageBox.width),
    pageHeight: Math.round(pageBox.height),
    rectCount: clientRects.length,
    rects: clientRects,
    merged,
  };
});

if (dump.error) {
  console.log("ERROR:", dump.error);
} else {
  console.log(`selected: "${dump.selectedText}..."`);
  console.log(`page box: ${dump.pageWidth} x ${dump.pageHeight}`);
  console.log(`getClientRects() returned ${dump.rectCount} rects:\n`);
  // Sort by top, then left, to make line grouping visible.
  const sorted = [...dump.rects].sort((a, b) => a.top - b.top || a.left - b.left);
  for (const r of sorted) {
    console.log(
      `  top=${String(r.top).padStart(7)}  bottom=${String(r.bottom).padStart(7)}  ` +
        `h=${String(r.h).padStart(5)}  left=${String(r.left).padStart(7)}  right=${String(r.right).padStart(7)}`,
    );
  }
  // Highlight vertical overlaps between consecutive distinct top-bands.
  console.log("\ndistinct top values:", [...new Set(sorted.map((r) => r.top))].join(", "));

  console.log(`\n--- after per-line merge: ${dump.merged.length} rects ---\n`);
  for (const r of dump.merged) {
    console.log(
      `  top=${String(r.top).padStart(7)}  bottom=${String(r.bottom).padStart(7)}  ` +
        `h=${String(r.h).padStart(5)}  left=${String(r.left).padStart(7)}  right=${String(r.right).padStart(7)}`,
    );
  }
  // Verify merged rects never overlap vertically.
  let overlap = false;
  for (let i = 0; i < dump.merged.length - 1; i += 1) {
    if (dump.merged[i].bottom > dump.merged[i + 1].top + 0.05) overlap = true;
  }
  console.log(`\nmerged rects overlap vertically: ${overlap ? "YES (bug)" : "no ✓"}`);
}

await browser.close();
